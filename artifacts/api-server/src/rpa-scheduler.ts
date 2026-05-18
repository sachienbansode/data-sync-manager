/**
 * RPA Bot Scheduler
 * Registers cron jobs for active bot schedules and triggers runs via the
 * Python RPA service. Mirrors the pattern used by the pipeline scheduler.
 */

import cron from "node-cron";
import { CronExpressionParser } from "cron-parser";
import { eq, and } from "drizzle-orm";
import { db, rpaBotSchedulesTable, rpaBotsTable, auditLogsTable } from "@workspace/db";
import { logger } from "./lib/logger";

const RPA_SERVICE_URL = process.env.RPA_SERVICE_URL ?? "http://localhost:8090";

type ScheduledTask = ReturnType<typeof cron.schedule>;
const activeTasks = new Map<number, ScheduledTask>();

export function computeNextBotRunAt(cronExpr: string): Date | null {
  try {
    return CronExpressionParser.parse(cronExpr).next().toDate();
  } catch {
    return null;
  }
}

async function triggerBotRun(botId: number, scheduleId: number): Promise<void> {
  let runId: number | null = null;
  let triggerError: string | null = null;

  try {
    const resp = await fetch(`${RPA_SERVICE_URL}/bots/${botId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ triggeredBy: null, triggeredByEmail: "scheduler" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { detail?: string; error?: string };
      triggerError = err.detail ?? err.error ?? `HTTP ${resp.status}`;
      logger.error({ botId, scheduleId, status: resp.status, detail: triggerError }, "RPA scheduled run rejected by service");
    } else {
      const body = await resp.json().catch(() => ({})) as { id?: number };
      runId = body.id ?? null;
      logger.info({ botId, scheduleId, runId }, "RPA scheduled run triggered");
    }
  } catch (err) {
    triggerError = err instanceof Error ? err.message : "RPA service unreachable";
    logger.error({ botId, scheduleId, err }, "RPA service unreachable for scheduled run");
  }

  db.insert(auditLogsTable).values({
    userId: null,
    userEmail: null,
    action: triggerError ? "RPA_RUN_TRIGGER_FAILED" : "RPA_RUN_TRIGGERED",
    details: JSON.stringify({
      botId,
      scheduleId,
      runId,
      trigger: "scheduler",
      error: triggerError,
    }),
    resourceType: "rpa_bot",
    resourceId: String(botId),
  }).catch(() => {});

  await db
    .update(rpaBotSchedulesTable)
    .set({ lastRunAt: new Date(), updatedAt: new Date() })
    .where(eq(rpaBotSchedulesTable.id, scheduleId))
    .catch(() => {});
}

export function cancelBotSchedule(scheduleId: number): void {
  const existing = activeTasks.get(scheduleId);
  if (existing) {
    existing.stop();
    activeTasks.delete(scheduleId);
    logger.info({ scheduleId }, "Bot schedule cancelled");
  }
}

export function registerBotSchedule(scheduleId: number, botId: number, cronExpr: string): void {
  cancelBotSchedule(scheduleId);
  if (!cron.validate(cronExpr)) {
    logger.warn({ scheduleId, cronExpr }, "Invalid cron expression — bot schedule not registered");
    return;
  }
  const task = cron.schedule(cronExpr, () => {
    triggerBotRun(botId, scheduleId).catch((err) =>
      logger.error({ scheduleId, botId, err }, "Unhandled error in scheduled bot run")
    );
  });
  activeTasks.set(scheduleId, task);
  logger.info({ scheduleId, botId, cronExpr }, "Bot schedule registered");
}

export async function initRpaBotScheduler(): Promise<void> {
  const schedules = await db
    .select({
      id: rpaBotSchedulesTable.id,
      botId: rpaBotSchedulesTable.botId,
      cronExpr: rpaBotSchedulesTable.cronExpr,
    })
    .from(rpaBotSchedulesTable)
    .innerJoin(rpaBotsTable, eq(rpaBotSchedulesTable.botId, rpaBotsTable.id))
    .where(
      and(
        eq(rpaBotSchedulesTable.isActive, true),
        eq(rpaBotsTable.isActive, true),
      ),
    );

  for (const s of schedules) {
    registerBotSchedule(s.id, s.botId, s.cronExpr);
  }
  logger.info({ count: schedules.length }, "RPA bot scheduler initialised");
}
