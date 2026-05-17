import app from "./app";
import { logger } from "./lib/logger";
import { initScheduler } from "./scheduler";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * Retry wrapper for scheduler init. The very first DB query on startup can
 * fail with ECONNRESET / "Connection terminated unexpectedly" if the pg pool
 * hasn't finished its TCP handshake yet (common when the DB host is remote).
 * We back off and retry rather than giving up entirely.
 */
async function startSchedulerWithRetry(
  maxAttempts = 6,
  initialDelayMs = 2_000,
): Promise<void> {
  let delayMs = initialDelayMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await initScheduler();
      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        logger.error({ err }, "Scheduler init failed after all retries — pipeline schedules will not run");
        return;
      }
      logger.warn(
        { err: err instanceof Error ? err.message : err, attempt, retryInMs: delayMs },
        "Scheduler init failed, retrying…",
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, 30_000);
    }
  }
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Small initial delay so the pool can establish its first connection
  // before the scheduler fires its first query.
  setTimeout(() => {
    startSchedulerWithRetry().catch((e) =>
      logger.error({ err: e }, "Unexpected error in scheduler startup"),
    );
  }, 1_000);
});
