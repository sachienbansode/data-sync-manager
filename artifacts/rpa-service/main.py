"""
RPA Service — FastAPI microservice for bot execution.

Public routes (called via Node proxy):
  POST /bots/{bot_id}/run          — create run record + trigger execution
  GET  /bots/{bot_id}/runs         — list run history
  GET  /runs/{run_id}/logs         — get stored log lines
  GET  /runs/{run_id}/stream       — SSE live log stream
  GET  /health                     — health check

Internal routes (also available directly):
  POST /internal/runs/{run_id}/execute  — execute an existing pending run
"""
import asyncio
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime

import asyncpg
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

load_dotenv()

import runner  # noqa: E402 — must be after dotenv


# ── Serialisation helpers ─────────────────────────────────────────────────────

def _ser(v):
    if isinstance(v, datetime):
        return v.isoformat()
    return v


def _serialize(row: dict) -> dict:
    return {k: _ser(v) for k, v in row.items()}


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    dsn = os.environ.get("DATABASE_URL") or os.environ.get("CUSTOM_DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL or CUSTOM_DATABASE_URL env var required")
    app.state.pool = await asyncpg.create_pool(dsn=dsn, min_size=2, max_size=10)
    yield
    await app.state.pool.close()


app = FastAPI(title="RPA Service", lifespan=lifespan)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "rpa"}


# ── Public: trigger a run ─────────────────────────────────────────────────────

@app.post("/bots/{bot_id}/run")
async def trigger_bot_run(bot_id: int, request: Request):
    """
    Create a new run record and spawn execution.
    Expects JSON body: { triggeredBy?: int, triggeredByEmail?: str }
    Called by Node proxy after auth check.
    """
    pool: asyncpg.Pool = app.state.pool

    body: dict = {}
    try:
        body = await request.json()
    except Exception:
        pass

    triggered_by = body.get("triggeredBy")
    triggered_by_email = body.get("triggeredByEmail")

    bot_row = await pool.fetchrow("SELECT id, is_active FROM rpa_bots WHERE id=$1", bot_id)
    if not bot_row:
        raise HTTPException(status_code=404, detail="Bot not found")
    if not bot_row["is_active"]:
        raise HTTPException(status_code=400, detail="Bot is inactive")

    # Enforce sequential execution per bot — reject if an active run already exists
    active = await pool.fetchrow(
        "SELECT id FROM rpa_bot_runs WHERE bot_id=$1 AND status IN ('pending', 'running') LIMIT 1",
        bot_id,
    )
    if active:
        raise HTTPException(
            status_code=409,
            detail=f"Bot already has an active run (id={active['id']}). Wait for it to finish before triggering a new run.",
        )

    run_id = await pool.fetchval(
        """INSERT INTO rpa_bot_runs (bot_id, status, triggered_by, triggered_by_email)
           VALUES ($1, 'pending', $2, $3) RETURNING id""",
        bot_id, triggered_by, triggered_by_email,
    )

    q: asyncio.Queue = asyncio.Queue()
    runner.run_queues[run_id] = q
    asyncio.create_task(runner.execute_bot_run(pool, run_id))

    run_row = await pool.fetchrow("SELECT * FROM rpa_bot_runs WHERE id=$1", run_id)
    return _serialize(dict(run_row))


# ── Public: run history ───────────────────────────────────────────────────────

@app.get("/bots/{bot_id}/runs")
async def list_bot_runs(bot_id: int):
    pool: asyncpg.Pool = app.state.pool
    rows = await pool.fetch(
        "SELECT * FROM rpa_bot_runs WHERE bot_id=$1 ORDER BY created_at DESC LIMIT 50",
        bot_id,
    )
    return [_serialize(dict(r)) for r in rows]


# ── Public: log lines ─────────────────────────────────────────────────────────

@app.get("/runs/{run_id}/logs")
async def get_run_logs(run_id: int):
    pool: asyncpg.Pool = app.state.pool
    rows = await pool.fetch(
        "SELECT id, run_id, ts, level, message FROM rpa_bot_logs WHERE run_id=$1 ORDER BY ts ASC",
        run_id,
    )
    return [_serialize(dict(r)) for r in rows]


# ── Public: SSE live log stream ───────────────────────────────────────────────

@app.get("/runs/{run_id}/stream")
async def stream_logs(run_id: int):
    """
    SSE endpoint — streams log lines for a running bot.
    If the bot has already finished, streams the stored logs from DB.
    """
    pool: asyncpg.Pool = app.state.pool

    run_row = await pool.fetchrow("SELECT id, status FROM rpa_bot_runs WHERE id=$1", run_id)
    if not run_row:
        raise HTTPException(status_code=404, detail="Run not found")

    if run_row["status"] in ("success", "failed"):
        async def completed_stream():
            logs = await pool.fetch(
                "SELECT ts, level, message FROM rpa_bot_logs WHERE run_id=$1 ORDER BY ts ASC",
                run_id,
            )
            for log in logs:
                payload = json.dumps({
                    "ts": log["ts"].isoformat(),
                    "level": log["level"],
                    "message": log["message"],
                })
                yield f"data: {payload}\n\n"
            yield 'data: {"done": true}\n\n'

        return StreamingResponse(completed_stream(), media_type="text/event-stream")

    async def live_stream():
        q = runner.run_queues.get(run_id)
        if not q:
            logs = await pool.fetch(
                "SELECT ts, level, message FROM rpa_bot_logs WHERE run_id=$1 ORDER BY ts ASC",
                run_id,
            )
            for log in logs:
                payload = json.dumps({
                    "ts": log["ts"].isoformat(),
                    "level": log["level"],
                    "message": log["message"],
                })
                yield f"data: {payload}\n\n"
            yield 'data: {"done": true}\n\n'
            return

        while True:
            try:
                item = await asyncio.wait_for(q.get(), timeout=30.0)
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                continue
            if item is None:
                yield 'data: {"done": true}\n\n'
                break
            payload = json.dumps(item, default=str)
            yield f"data: {payload}\n\n"

    return StreamingResponse(live_stream(), media_type="text/event-stream")


# ── Internal: execute an existing pending run ─────────────────────────────────

@app.post("/internal/runs/{run_id}/execute")
async def execute_existing_run(run_id: int):
    """Execute a run record that was already created (backward-compat route)."""
    pool: asyncpg.Pool = app.state.pool

    run_row = await pool.fetchrow("SELECT id, status FROM rpa_bot_runs WHERE id=$1", run_id)
    if not run_row:
        raise HTTPException(status_code=404, detail="Run not found")
    if run_row["status"] not in ("pending",):
        raise HTTPException(status_code=409, detail=f"Run is already {run_row['status']}")

    q: asyncio.Queue = asyncio.Queue()
    runner.run_queues[run_id] = q
    asyncio.create_task(runner.execute_bot_run(pool, run_id))
    return {"run_id": run_id, "status": "running"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8090))
    uvicorn.run(app, host="0.0.0.0", port=port)
