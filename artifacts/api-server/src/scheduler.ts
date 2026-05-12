/**
 * Pipeline Scheduler
 * Schedules are attached to DATA PIPELINES (not connections).
 * On each tick the pipeline is executed end-to-end via runPipelineById().
 */

import cron from "node-cron";
import { CronExpressionParser } from "cron-parser";
import { eq, and, asc, sql } from "drizzle-orm";
import {
  db, dataPipelinesTable, pipelineFieldMappingsTable, dbConnectionsTable,
  dataJobsTable, auditLogsTable, usersTable, rolesTable,
} from "@workspace/db";
import { decrypt, loadEncryptionKey } from "./lib/crypto";
import { logger } from "./lib/logger";
import { sendMail } from "./lib/mailer";
import { spawn } from "child_process";
import { resolve as pathResolve } from "path";

const CONSECUTIVE_FAILURE_THRESHOLD = 3;

export function computeNextRunAt(cronExpression: string): Date | null {
  try {
    return CronExpressionParser.parse(cronExpression).next().toDate();
  } catch {
    return null;
  }
}

async function getAdminEmails(): Promise<string[]> {
  try {
    const admins = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .innerJoin(rolesTable, eq(usersTable.roleId, rolesTable.id))
      .where(and(eq(rolesTable.name, "Admin"), eq(usersTable.isActive, true)));
    return admins.map((a) => a.email);
  } catch {
    return [];
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function sendFailureAlert(
  pipelineName: string, pipelineId: number, failures: number, lastError: string
): Promise<void> {
  const emails = await getAdminEmails();
  if (!emails.length) return;
  const safe = (s: string) => escapeHtml(s);
  const subject = `Alert: Pipeline "${pipelineName}" failed ${failures} times in a row`;
  const html = `
    <div style="font-family:sans-serif;max-width:600px">
      <h2 style="color:#dc2626">Pipeline Failure Alert</h2>
      <p>Pipeline <strong>${safe(pipelineName)}</strong> (ID: ${pipelineId}) has failed
         <strong>${failures} consecutive time${failures !== 1 ? "s" : ""}</strong>.</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Pipeline</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${safe(pipelineName)} (ID: ${pipelineId})</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Failures</td>
            <td style="padding:8px;border:1px solid #e5e7eb;color:#dc2626">${failures}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Last Error</td>
            <td style="padding:8px;border:1px solid #e5e7eb;font-family:monospace;font-size:13px">${safe(lastError)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Time</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${new Date().toISOString()}</td></tr>
      </table>
    </div>
  `;
  for (const email of emails) {
    try { await sendMail(email, subject, html); } catch { /* non-fatal */ }
  }
}

/** Resolve the pipeline_worker.py path at runtime.
 *  The build script copies it to dist/lib/, and the server always runs from
 *  the artifacts/api-server directory, so process.cwd()/dist/lib/ is reliable. */
function getWorkerPath(): string {
  return pathResolve(process.cwd(), "dist", "lib", "pipeline_worker.py");
}

export interface PipelineRunResult {
  success: boolean;
  recordCount?: number;
  error?: string;
  jobId?: number;
}

/** Run a pipeline by ID. Used by both the scheduler and the /run endpoint. */
export async function runPipelineById(pipelineId: number, triggeredBySchedule = false): Promise<PipelineRunResult> {
  const [pipeline] = await db.select().from(dataPipelinesTable).where(eq(dataPipelinesTable.id, pipelineId));
  if (!pipeline) return { success: false, error: "Pipeline not found" };
  if (!pipeline.sourceConnectionId) return { success: false, error: "No source connection configured" };
  if (!pipeline.destConnectionId)   return { success: false, error: "No destination connection configured" };
  if (!pipeline.destTarget)         return { success: false, error: "Destination table not configured" };

  const [[srcConn], [dstConn]] = await Promise.all([
    db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, pipeline.sourceConnectionId)),
    db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, pipeline.destConnectionId)),
  ]);
  if (!srcConn) return { success: false, error: "Source connection not found" };
  if (!dstConn) return { success: false, error: "Destination connection not found" };

  // Build effective source query
  let sourceQuery = pipeline.sourceQuery?.trim() || "";
  if (!sourceQuery && pipeline.sourceTable) {
    const schema = srcConn.schemaName ?? "public";
    sourceQuery = `SELECT * FROM "${schema}"."${pipeline.sourceTable}"`;
  }
  if (!sourceQuery) return { success: false, error: "No source table or query configured" };

  // Create job record
  const [job] = await db.insert(dataJobsTable).values({
    type: "pipeline",
    status: "running",
    triggeredBySchedule,
    pipelineId,
    startedAt: new Date(),
  }).returning();

  // Update next scheduled run timestamp
  if (pipeline.scheduleCron) {
    const nextRunAt = computeNextRunAt(pipeline.scheduleCron);
    await db.update(dataPipelinesTable).set({
      scheduleLastRunAt: new Date(),
      scheduleNextRunAt: nextRunAt,
      updatedAt: new Date(),
    }).where(eq(dataPipelinesTable.id, pipelineId));
  }

  loadEncryptionKey();
  let srcUser = "", srcPass = "", dstUser = "", dstPass = "";
  try {
    srcUser = srcConn.usernameEnc ? decrypt(srcConn.usernameEnc) : "";
    srcPass = srcConn.passwordEnc ? decrypt(srcConn.passwordEnc) : "";
    dstUser = dstConn.usernameEnc ? decrypt(dstConn.usernameEnc) : "";
    dstPass = dstConn.passwordEnc ? decrypt(dstConn.passwordEnc) : "";
  } catch {
    await db.update(dataJobsTable).set({ status: "failed", errorMessage: "Failed to decrypt credentials", finishedAt: new Date() }).where(eq(dataJobsTable.id, job.id));
    return { success: false, error: "Failed to decrypt credentials", jobId: job.id };
  }

  const mappings = await db
    .select().from(pipelineFieldMappingsTable)
    .where(eq(pipelineFieldMappingsTable.pipelineId, pipelineId))
    .orderBy(asc(pipelineFieldMappingsTable.sortOrder));

  const workerConfig = {
    source: { engine: srcConn.dbEngine, host: srcConn.host, port: srcConn.port, database: srcConn.dbName, username: srcUser, password: srcPass },
    dest:   { engine: dstConn.dbEngine, host: dstConn.host, port: dstConn.port, database: dstConn.dbName, username: dstUser, password: dstPass },
    sourceQuery,
    destTarget: pipeline.destTarget,
    fieldMappings: mappings.map(m => ({
      sourceField: m.sourceField,
      destField: m.destField,
      transformType: m.transformType,
      transformParams: m.transformParams,
    })),
    chunkSize: 5000,
  };

  const workerPath = getWorkerPath();

  return new Promise((resolvePromise) => {
    const child = spawn("python3", [workerPath], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.write(JSON.stringify(workerConfig));
    child.stdin.end();

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    child.on("close", async (code) => {
      let result: { success: boolean; recordCount?: number; error?: string };
      try {
        result = JSON.parse(stdout.trim());
      } catch {
        result = { success: false, error: stderr.trim() || `Worker exited with code ${code}` };
      }

      if (result.success) {
        await db.update(dataJobsTable).set({
          status: "success",
          recordCount: result.recordCount ?? 0,
          finishedAt: new Date(),
        }).where(eq(dataJobsTable.id, job.id));

        await db.update(dataPipelinesTable).set({
          scheduleConsecutiveFailures: 0,
          scheduleLastRunAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(dataPipelinesTable.id, pipelineId));

        await db.insert(auditLogsTable).values({
          action: "PIPELINE_RUN_COMPLETED",
          details: `Pipeline "${pipeline.name}" — ${result.recordCount ?? 0} row(s) transferred (job=${job.id})`,
          resourceType: "pipeline", resourceId: String(pipelineId),
        });

        logger.info({ pipelineId, jobId: job.id, recordCount: result.recordCount }, "Pipeline run completed");
        resolvePromise({ success: true, recordCount: result.recordCount, jobId: job.id });
      } else {
        const errMsg = result.error ?? "Unknown error";
        await db.update(dataJobsTable).set({ status: "failed", errorMessage: errMsg, finishedAt: new Date() }).where(eq(dataJobsTable.id, job.id));

        const [updated] = await db.update(dataPipelinesTable).set({
          scheduleConsecutiveFailures: sql`${dataPipelinesTable.scheduleConsecutiveFailures} + 1`,
          scheduleLastRunAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(dataPipelinesTable.id, pipelineId)).returning({ f: dataPipelinesTable.scheduleConsecutiveFailures });

        const failures = updated?.f ?? 1;
        if (failures % CONSECUTIVE_FAILURE_THRESHOLD === 0) {
          await sendFailureAlert(pipeline.name, pipelineId, failures, errMsg);
        }

        logger.error({ pipelineId, jobId: job.id, errMsg }, "Pipeline run failed");
        resolvePromise({ success: false, error: errMsg, jobId: job.id });
      }
    });

    child.on("error", async (err) => {
      const msg = err.message;
      await db.update(dataJobsTable).set({ status: "failed", errorMessage: msg, finishedAt: new Date() }).where(eq(dataJobsTable.id, job.id));
      resolvePromise({ success: false, error: msg, jobId: job.id });
    });
  });
}

// ─── Cron task registry ────────────────────────────────────────────────────

type ScheduledTask = ReturnType<typeof cron.schedule>;
const activeTasks = new Map<number, ScheduledTask>();

export async function registerPipelineSchedule(pipelineId: number, cronExpression: string): Promise<void> {
  cancelPipelineSchedule(pipelineId);
  if (!cron.validate(cronExpression)) {
    logger.warn({ pipelineId, cronExpression }, "Invalid cron expression — schedule not registered");
    return;
  }
  const nextRunAt = computeNextRunAt(cronExpression);
  if (nextRunAt) {
    await db.update(dataPipelinesTable).set({ scheduleNextRunAt: nextRunAt, updatedAt: new Date() }).where(eq(dataPipelinesTable.id, pipelineId));
  }
  const task = cron.schedule(cronExpression, () => {
    runPipelineById(pipelineId, true).catch((err) =>
      logger.error({ pipelineId, err }, "Unhandled error in scheduled pipeline run")
    );
  });
  activeTasks.set(pipelineId, task);
  logger.info({ pipelineId, cronExpression }, "Pipeline schedule registered");
}

export function cancelPipelineSchedule(pipelineId: number): void {
  const existing = activeTasks.get(pipelineId);
  if (existing) {
    existing.stop();
    activeTasks.delete(pipelineId);
    logger.info({ pipelineId }, "Pipeline schedule cancelled");
  }
}

export async function initScheduler(): Promise<void> {
  const pipelines = await db
    .select()
    .from(dataPipelinesTable)
    .where(and(eq(dataPipelinesTable.scheduleEnabled, true), eq(dataPipelinesTable.status, "active")));

  for (const p of pipelines) {
    if (p.scheduleCron) {
      await registerPipelineSchedule(p.id, p.scheduleCron);
    }
  }
  logger.info({ count: pipelines.length }, "Pipeline scheduler initialised");
}
