/**
 * RPA Run Notifier
 * Polls completed bot runs every minute, sends email notifications,
 * and writes audit log entries for all run completions.
 */

import { and, eq, isNull, inArray } from "drizzle-orm";
import { db, rpaBotsTable, rpaBotRunsTable, auditLogsTable } from "@workspace/db";
import { sendMail } from "./lib/mailer";
import { logger } from "./lib/logger";

function durationStr(startedAt: Date | null, finishedAt: Date | null): string {
  if (!startedAt || !finishedAt) return "unknown";
  const ms = finishedAt.getTime() - startedAt.getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function buildRunEmail(opts: {
  botName: string;
  runId: number;
  status: string;
  triggeredByEmail: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorMessage: string | null;
}): { subject: string; html: string } {
  const { botName, runId, status, triggeredByEmail, startedAt, finishedAt, errorMessage } = opts;
  const isSuccess = status === "success";
  const statusLabel = isSuccess ? "✅ Completed" : "❌ Failed";
  const statusColor = isSuccess ? "#16a34a" : "#dc2626";
  const trigger = triggeredByEmail === "scheduler" ? "Scheduled (auto)" : (triggeredByEmail ?? "Unknown");
  const duration = durationStr(startedAt, finishedAt);
  const started = startedAt ? startedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—";
  const finished = finishedAt ? finishedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—";

  const subject = `[Bot] ${botName} — Run #${runId} ${isSuccess ? "completed" : "failed"}`;

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#f9fafb;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
  <div style="background:${statusColor};padding:16px 24px;">
    <h2 style="color:#fff;margin:0;font-size:18px;">${statusLabel} — ${botName}</h2>
  </div>
  <div style="padding:24px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:6px 0;color:#6b7280;width:140px;">Run ID</td><td style="padding:6px 0;font-weight:600;">#${runId}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Status</td><td style="padding:6px 0;font-weight:600;color:${statusColor};">${status.toUpperCase()}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Triggered by</td><td style="padding:6px 0;">${trigger}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Started</td><td style="padding:6px 0;">${started}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Finished</td><td style="padding:6px 0;">${finished}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Duration</td><td style="padding:6px 0;">${duration}</td></tr>
      ${errorMessage ? `<tr><td style="padding:6px 0;color:#6b7280;vertical-align:top;">Error</td><td style="padding:6px 0;color:#dc2626;">${errorMessage}</td></tr>` : ""}
    </table>
    <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">This is an automated notification from Ashika Platform RPA.</p>
  </div>
</div>
</body>
</html>`;

  return { subject, html };
}

async function processCompletedRuns(): Promise<void> {
  const runs = await db
    .select({
      runId: rpaBotRunsTable.id,
      botId: rpaBotRunsTable.botId,
      botName: rpaBotsTable.name,
      status: rpaBotRunsTable.status,
      triggeredBy: rpaBotRunsTable.triggeredBy,
      triggeredByEmail: rpaBotRunsTable.triggeredByEmail,
      startedAt: rpaBotRunsTable.startedAt,
      finishedAt: rpaBotRunsTable.finishedAt,
      errorMessage: rpaBotRunsTable.errorMessage,
      notifyEmail: rpaBotsTable.notifyEmail,
      notifyOn: rpaBotsTable.notifyOn,
    })
    .from(rpaBotRunsTable)
    .innerJoin(rpaBotsTable, eq(rpaBotRunsTable.botId, rpaBotsTable.id))
    .where(
      and(
        inArray(rpaBotRunsTable.status, ["success", "failed"]),
        isNull(rpaBotRunsTable.notifiedAt),
      )
    );

  if (runs.length === 0) return;

  for (const run of runs) {
    const trigger = run.triggeredByEmail === "scheduler"
      ? "Scheduled (auto)"
      : (run.triggeredByEmail ?? "manual");

    const details = JSON.stringify({
      botId: run.botId,
      botName: run.botName,
      status: run.status,
      triggeredBy: trigger,
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      duration: durationStr(run.startedAt, run.finishedAt),
      errorMessage: run.errorMessage ?? null,
    });

    db.insert(auditLogsTable).values({
      userId: run.triggeredBy ?? null,
      userEmail: run.triggeredByEmail === "scheduler" ? null : (run.triggeredByEmail ?? null),
      action: run.status === "success" ? "RPA_RUN_COMPLETED" : "RPA_RUN_FAILED",
      details,
      resourceType: "rpa_run",
      resourceId: String(run.runId),
    }).catch((e) => logger.error({ err: e }, "RPA audit log insert failed"));

    const shouldNotify =
      run.notifyEmail &&
      (run.notifyOn === "always" ||
        (run.notifyOn === "on_failure" && run.status === "failed"));

    if (shouldNotify && run.notifyEmail) {
      try {
        const { subject, html } = buildRunEmail({
          botName: run.botName,
          runId: run.runId,
          status: run.status,
          triggeredByEmail: run.triggeredByEmail,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          errorMessage: run.errorMessage,
        });
        await sendMail(run.notifyEmail, subject, html);
        logger.info({ runId: run.runId, to: run.notifyEmail }, "RPA run notification sent");
      } catch (e) {
        logger.warn({ runId: run.runId, err: e }, "Failed to send RPA run notification email");
      }
    }

    await db
      .update(rpaBotRunsTable)
      .set({ notifiedAt: new Date() })
      .where(eq(rpaBotRunsTable.id, run.runId))
      .catch(() => {});
  }
}

let _timer: ReturnType<typeof setInterval> | null = null;

export function startRpaNotifier(): void {
  if (_timer) return;
  _timer = setInterval(() => {
    processCompletedRuns().catch((e) =>
      logger.error({ err: e }, "RPA notifier poll error")
    );
  }, 60_000);
  processCompletedRuns().catch(() => {});
  logger.info("RPA run notifier started (60s interval)");
}

export function stopRpaNotifier(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
