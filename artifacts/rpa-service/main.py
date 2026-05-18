"""
RPA Service — FastAPI microservice for bot execution.

Routes:
  POST /internal/runs/{run_id}/execute  — trigger execution (called by Node)
  GET  /internal/runs/{run_id}/stream   — SSE live log stream (proxied by Node)
  GET  /health                          — health check
"""
import asyncio
import json
import os
from contextlib import asynccontextmanager

import asyncpg
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

load_dotenv()

import runner  # noqa: E402 — must be after dotenv


@asynccontextmanager
async def lifespan(app: FastAPI):
    dsn = os.environ.get("DATABASE_URL") or os.environ.get("CUSTOM_DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL or CUSTOM_DATABASE_URL env var required")
    app.state.pool = await asyncpg.create_pool(dsn=dsn, min_size=2, max_size=10)
    yield
    await app.state.pool.close()


app = FastAPI(title="RPA Service", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "rpa"}


@app.post("/internal/runs/{run_id}/execute")
async def trigger_run(run_id: int):
    """
    Called by the Node API server after it creates the run record.
    Spawns background task and returns immediately.
    """
    pool: asyncpg.Pool = app.state.pool

    run_row = await pool.fetchrow("SELECT id, status FROM rpa_bot_runs WHERE id=$1", run_id)
    if not run_row:
        raise HTTPException(status_code=404, detail="Run not found")
    if run_row["status"] not in ("pending",):
        raise HTTPException(status_code=409, detail=f"Run is already {run_row['status']}")

    # Create a queue for SSE streaming
    q: asyncio.Queue = asyncio.Queue()
    runner.run_queues[run_id] = q

    asyncio.create_task(runner.execute_bot_run(pool, run_id))
    return {"run_id": run_id, "status": "running"}


@app.get("/internal/runs/{run_id}/stream")
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
        # Stream stored logs for completed run
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
            yield "data: {\"done\": true}\n\n"

        return StreamingResponse(completed_stream(), media_type="text/event-stream")

    # Live stream via queue
    async def live_stream():
        q = runner.run_queues.get(run_id)
        if not q:
            # Queue gone — stream whatever is in DB
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
            yield "data: {\"done\": true}\n\n"
            return

        while True:
            try:
                item = await asyncio.wait_for(q.get(), timeout=30.0)
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                continue
            if item is None:
                yield "data: {\"done\": true}\n\n"
                break
            payload = json.dumps(item, default=str)
            yield f"data: {payload}\n\n"

    return StreamingResponse(live_stream(), media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8090))
    uvicorn.run(app, host="0.0.0.0", port=port)
