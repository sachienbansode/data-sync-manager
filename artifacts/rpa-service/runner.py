"""
Bot runner — executes a single bot run using Playwright.
Writes logs to rpa_bot_logs table and updates rpa_bot_runs status.
Also pushes log lines to an in-memory asyncio.Queue for SSE streaming.
"""
import asyncio
import json
import os
import traceback
from datetime import datetime, timezone

import asyncpg

from crypto_util import decrypt

# Global registry: run_id -> asyncio.Queue  (populated by main.py)
run_queues: dict[int, asyncio.Queue] = {}

SCREENSHOTS_DIR = os.environ.get("SCREENSHOTS_DIR", "/tmp/rpa_screenshots")


async def write_log(pool: asyncpg.Pool, run_id: int, level: str, message: str):
    """Write a log line to DB and push to in-memory queue if active."""
    now = datetime.now(timezone.utc)
    await pool.execute(
        "INSERT INTO rpa_bot_logs (run_id, ts, level, message) VALUES ($1, $2, $3, $4)",
        run_id, now, level, message,
    )
    q = run_queues.get(run_id)
    if q:
        await q.put({"ts": now.isoformat(), "level": level, "message": message})


async def execute_bot_run(pool: asyncpg.Pool, run_id: int):
    """Main entry point called as a background task."""
    os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

    await pool.execute(
        "UPDATE rpa_bot_runs SET status='running', started_at=$1 WHERE id=$2",
        datetime.now(timezone.utc), run_id,
    )

    run_row = await pool.fetchrow("SELECT * FROM rpa_bot_runs WHERE id=$1", run_id)
    if not run_row:
        return

    bot_id = run_row["bot_id"]

    try:
        await _run_bot(pool, run_id, bot_id)
        await pool.execute(
            "UPDATE rpa_bot_runs SET status='success', finished_at=$1 WHERE id=$2",
            datetime.now(timezone.utc), run_id,
        )
        await write_log(pool, run_id, "info", "✅ Bot run completed successfully.")
    except Exception as exc:
        tb = traceback.format_exc()
        err_msg = f"{exc}"
        await write_log(pool, run_id, "error", f"❌ Run failed: {err_msg}")
        await write_log(pool, run_id, "debug", tb)
        await pool.execute(
            "UPDATE rpa_bot_runs SET status='failed', finished_at=$1, error_message=$2 WHERE id=$3",
            datetime.now(timezone.utc), err_msg[:1000], run_id,
        )
    finally:
        q = run_queues.pop(run_id, None)
        if q:
            await q.put(None)  # sentinel → close SSE stream


async def _run_bot(pool: asyncpg.Pool, run_id: int, bot_id: int):
    steps = await pool.fetch(
        "SELECT * FROM rpa_bot_steps WHERE bot_id=$1 ORDER BY step_order ASC",
        bot_id,
    )
    cred_rows = await pool.fetch(
        "SELECT * FROM rpa_bot_credentials WHERE bot_id=$1", bot_id
    )

    # Decrypt credentials
    creds: dict[str, dict] = {}
    for row in cred_rows:
        label = row["label"]
        try:
            username = decrypt(row["username_enc"] or "")
            password = decrypt(row["password_enc"] or "")
            creds[label] = {"username": username, "password": password}
        except Exception as e:
            await write_log(pool, run_id, "warn", f"Could not decrypt credential '{label}': {e}")

    await write_log(pool, run_id, "info", f"Starting bot with {len(steps)} step(s).")

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise RuntimeError("Playwright is not installed. Run: pip install playwright && playwright install chromium")

    import shutil
    chromium_path = shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
    launch_kwargs: dict = {
        "headless": True,
        "args": ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    }
    if chromium_path:
        launch_kwargs["executable_path"] = chromium_path

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(**launch_kwargs)
        context = await browser.new_context(ignore_https_errors=True)
        page = await context.new_page()

        screenshot_path: str | None = None

        for i, step in enumerate(steps):
            step_type = step["step_type"]
            raw_config = step["config"]
            config: dict = json.loads(raw_config) if isinstance(raw_config, str) else (raw_config or {})
            desc = step["description"] or f"Step {i + 1}"

            await write_log(pool, run_id, "info", f"[{i+1}/{len(steps)}] {step_type}: {desc}")

            try:
                await _execute_step(page, step_type, config, creds, SCREENSHOTS_DIR, run_id, pool)
                if step_type == "screenshot":
                    screenshot_path = config.get("path") or f"{SCREENSHOTS_DIR}/run_{run_id}_step_{i+1}.png"
            except Exception as e:
                raise RuntimeError(f"Step {i+1} ({step_type}) failed: {e}") from e

        await browser.close()

        if screenshot_path and os.path.exists(screenshot_path):
            await pool.execute(
                "UPDATE rpa_bot_runs SET screenshot_path=$1 WHERE id=$2",
                screenshot_path, run_id,
            )


async def _execute_step(page, step_type: str, config: dict, creds: dict, screenshots_dir: str, run_id: int, pool):
    timeout = int(config.get("timeout", 30000))

    if step_type == "navigate":
        url = config.get("url", "")
        await page.goto(url, timeout=timeout)

    elif step_type == "fill":
        selector = config.get("selector", "")
        value = config.get("value", "")
        cred_label = config.get("cred_label")
        cred_field = config.get("cred_field")
        if cred_label and cred_field and cred_label in creds:
            value = creds[cred_label].get(cred_field, value)
        await page.locator(selector).fill(value, timeout=timeout)

    elif step_type == "click":
        selector = config.get("selector", "")
        await page.locator(selector).click(timeout=timeout)

    elif step_type == "wait":
        selector = config.get("selector")
        wait_ms = int(config.get("ms", 1000))
        if selector:
            await page.locator(selector).wait_for(timeout=timeout)
        else:
            await asyncio.sleep(wait_ms / 1000)

    elif step_type == "screenshot":
        path = config.get("path") or f"{screenshots_dir}/run_{run_id}.png"
        full_page = config.get("full_page", False)
        await page.screenshot(path=path, full_page=full_page)

    elif step_type == "extract":
        selector = config.get("selector", "")
        attribute = config.get("attribute")
        if attribute:
            value = await page.locator(selector).get_attribute(attribute, timeout=timeout)
        else:
            value = await page.locator(selector).text_content(timeout=timeout)
        await write_log(pool, run_id, "info", f"Extracted: {value!r}")

    elif step_type == "select":
        selector = config.get("selector", "")
        value = config.get("value", "")
        await page.locator(selector).select_option(value, timeout=timeout)

    elif step_type == "key_press":
        key = config.get("key", "Enter")
        selector = config.get("selector")
        if selector:
            await page.locator(selector).press(key, timeout=timeout)
        else:
            await page.keyboard.press(key)

    elif step_type == "scroll":
        x = config.get("x", 0)
        y = config.get("y", 500)
        await page.mouse.wheel(x, y)

    elif step_type == "hover":
        selector = config.get("selector", "")
        await page.locator(selector).hover(timeout=timeout)

    else:
        raise ValueError(f"Unknown step type: {step_type}")
