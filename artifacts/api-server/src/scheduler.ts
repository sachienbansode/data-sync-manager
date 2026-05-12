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
  dataJobsTable, auditLogsTable, usersTable, rolesTable, connectionObjectsTable,
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

function toIst(d: Date): string {
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

async function sendFailureAlert(
  pipelineName: string, pipelineId: number, failures: number, lastError: string
): Promise<void> {
  const emails = await getAdminEmails();
  if (!emails.length) return;
  const subject = `Alert: Pipeline "${pipelineName}" failed ${failures} times in a row`;
  const html = buildFailureHtml(pipelineName, pipelineId, failures, lastError, "");
  for (const email of emails) {
    try { await sendMail(email, subject, html); } catch { /* non-fatal */ }
  }
}

function buildFailureHtml(
  pipelineName: string, pipelineId: number, failures: number, lastError: string, workerLog: string
): string {
  const safe = (s: string) => escapeHtml(s);
  const ts = toIst(new Date());
  return `
    <div style="font-family:sans-serif;max-width:700px">
      <h2 style="color:#dc2626">Pipeline Failure Alert</h2>
      <p>Pipeline <strong>${safe(pipelineName)}</strong> (ID: ${pipelineId}) has failed
         <strong>${failures} consecutive time${failures !== 1 ? "s" : ""}</strong>.</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold;width:140px">Pipeline</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${safe(pipelineName)} (ID: ${pipelineId})</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Failures</td>
            <td style="padding:8px;border:1px solid #e5e7eb;color:#dc2626">${failures}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Time (IST)</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${ts}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Technical Error</td>
            <td style="padding:8px;border:1px solid #e5e7eb;font-family:monospace;font-size:13px;color:#dc2626">${safe(lastError)}</td></tr>
      </table>
      <p style="color:#374151"><strong>Functional impact:</strong> Data transfer from source to destination was not completed for this run. Downstream systems relying on this pipeline may have stale or missing data. Please investigate the source connection, query, and destination table configuration.</p>
      ${workerLog ? `<h3 style="margin-top:20px">Worker Log</h3><pre style="background:#f3f4f6;padding:12px;border-radius:6px;font-size:12px;overflow:auto;max-height:300px">${safe(workerLog)}</pre>` : ""}
    </div>
  `;
}

function buildSuccessHtml(
  pipelineName: string, pipelineId: number, recordCount: number
): string {
  const safe = (s: string) => escapeHtml(s);
  const ts = toIst(new Date());
  return `
    <div style="font-family:sans-serif;max-width:600px">
      <h2 style="color:#16a34a">Pipeline Run Successful</h2>
      <p>Pipeline <strong>${safe(pipelineName)}</strong> completed successfully.</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold;width:140px">Pipeline</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${safe(pipelineName)} (ID: ${pipelineId})</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Records</td>
            <td style="padding:8px;border:1px solid #e5e7eb;color:#16a34a">${recordCount.toLocaleString()} row${recordCount !== 1 ? "s" : ""} transferred</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Completed (IST)</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${ts}</td></tr>
      </table>
    </div>
  `;
}

async function sendPipelineNotification(emails: string, subject: string, html: string): Promise<void> {
  const list = emails.split(",").map(e => e.trim()).filter(Boolean);
  for (const email of list) {
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
  conflict?: boolean;
}

/** Inner implementation — called only when the lock is already held. */
async function _executePipeline(pipelineId: number, triggeredBySchedule: boolean): Promise<PipelineRunResult> {
  const [pipeline] = await db.select().from(dataPipelinesTable).where(eq(dataPipelinesTable.id, pipelineId));
  if (!pipeline) return { success: false, error: "Pipeline not found" };

  // ── Resolve source connection + query ───────────────────────────────────
  let srcConnId: number | null = pipeline.sourceConnectionId;
  let sourceQuery = pipeline.sourceQuery?.trim() || "";
  let legacySourceTable = pipeline.sourceTable;

  if (pipeline.sourceObjectId) {
    const [srcObj] = await db.select().from(connectionObjectsTable).where(eq(connectionObjectsTable.id, pipeline.sourceObjectId));
    if (!srcObj) return { success: false, error: "Source data object not found" };
    srcConnId = srcObj.connectionId;
    if (srcObj.objectType === "query") {
      sourceQuery = srcObj.objectValue;
    } else {
      legacySourceTable = srcObj.objectValue;
      sourceQuery = "";
    }
  }

  // ── Resolve destination connection + target ──────────────────────────────
  let dstConnId: number | null = pipeline.destConnectionId;
  let destTarget = pipeline.destTarget ?? null;
  let destObjectType: string | null = null;
  let destObjectValue: string | null = null;

  if (pipeline.destObjectId) {
    const [dstObj] = await db.select().from(connectionObjectsTable).where(eq(connectionObjectsTable.id, pipeline.destObjectId));
    if (!dstObj) return { success: false, error: "Destination data object not found" };
    if (dstObj.objectType === "query") {
      return { success: false, error: "Destination data object must be a table type, not a SQL query object. Please select a table-type data object as the destination." };
    }
    dstConnId = dstObj.connectionId;
    destObjectType = dstObj.objectType;
    destObjectValue = dstObj.objectValue;
    // destTarget will be qualified with schema after dstConn is loaded below
  }

  if (!srcConnId) return { success: false, error: "No source connection configured" };
  if (!dstConnId) return { success: false, error: "No destination connection configured" };

  const [[srcConn], [dstConn]] = await Promise.all([
    db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, srcConnId)),
    db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, dstConnId)),
  ]);
  if (!srcConn) return { success: false, error: "Source connection not found" };
  if (!dstConn) return { success: false, error: "Destination connection not found" };

  // Build effective source query (object-resolved or legacy)
  if (!sourceQuery && legacySourceTable) {
    const schema = srcConn.schemaName ?? "public";
    sourceQuery = `SELECT * FROM "${schema}"."${legacySourceTable}"`;
  }
  if (!sourceQuery) return { success: false, error: "No source table or query configured" };

  // Build schema-qualified destTarget so the Python worker always receives "schema.table"
  if (destObjectValue !== null) {
    // Object-based: qualify plain table name with the destination connection's schema
    const schema = dstConn.schemaName ?? "public";
    destTarget = `${schema}.${destObjectValue}`;
  } else if (destTarget && !destTarget.includes(".")) {
    // Legacy plain table name: qualify with connection schema
    const schema = dstConn.schemaName ?? "public";
    destTarget = `${schema}.${destTarget}`;
  }

  if (!destTarget) return { success: false, error: "Destination table not configured" };

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
    destTarget,
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
        const rc = result.recordCount ?? 0;
        await db.update(dataJobsTable).set({
          status: "success",
          recordCount: rc,
          finishedAt: new Date(),
        }).where(eq(dataJobsTable.id, job.id));

        await db.update(dataPipelinesTable).set({
          scheduleConsecutiveFailures: 0,
          scheduleLastRunAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(dataPipelinesTable.id, pipelineId));

        await db.insert(auditLogsTable).values({
          action: "PIPELINE_RUN_COMPLETED",
          details: `Pipeline "${pipeline.name}" — ${rc} row(s) transferred (job=${job.id})`,
          resourceType: "pipeline", resourceId: String(pipelineId),
        });

        // Pipeline-level success notification
        if (pipeline.notifyOnSuccess?.trim()) {
          const subject = `Pipeline "${pipeline.name}" completed successfully`;
          const html = buildSuccessHtml(pipeline.name, pipelineId, rc);
          sendPipelineNotification(pipeline.notifyOnSuccess, subject, html).catch(() => {});
        }

        logger.info({ pipelineId, jobId: job.id, recordCount: rc }, "Pipeline run completed");
        resolvePromise({ success: true, recordCount: rc, jobId: job.id });
      } else {
        const errMsg = result.error ?? "Unknown error";
        await db.update(dataJobsTable).set({ status: "failed", errorMessage: errMsg, finishedAt: new Date() }).where(eq(dataJobsTable.id, job.id));

        const [updated] = await db.update(dataPipelinesTable).set({
          scheduleConsecutiveFailures: sql`${dataPipelinesTable.scheduleConsecutiveFailures} + 1`,
          scheduleLastRunAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(dataPipelinesTable.id, pipelineId)).returning({ f: dataPipelinesTable.scheduleConsecutiveFailures });

        const failures = updated?.f ?? 1;

        // Admin threshold alert
        if (failures % CONSECUTIVE_FAILURE_THRESHOLD === 0) {
          await sendFailureAlert(pipeline.name, pipelineId, failures, errMsg);
        }

        // Pipeline-level failure notification (always, with worker log)
        if (pipeline.notifyOnFailure?.trim()) {
          const subject = `Pipeline "${pipeline.name}" failed`;
          const html = buildFailureHtml(pipeline.name, pipelineId, failures, errMsg, stderr);
          sendPipelineNotification(pipeline.notifyOnFailure, subject, html).catch(() => {});
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

/** Run a pipeline by ID. Used by both the scheduler and the /run endpoint. */
export async function runPipelineById(pipelineId: number, triggeredBySchedule = false): Promise<PipelineRunResult> {
  if (runningPipelineIds.has(pipelineId)) {
    return { success: false, conflict: true, error: "A run is already in progress for this pipeline" };
  }
  runningPipelineIds.add(pipelineId);
  try {
    return await _executePipeline(pipelineId, triggeredBySchedule);
  } finally {
    runningPipelineIds.delete(pipelineId);
  }
}

// ─── In-memory concurrency lock ────────────────────────────────────────────

const runningPipelineIds = new Set<number>();

/** Returns true if a run is already in progress for this pipeline. */
export function isPipelineRunning(pipelineId: number): boolean {
  return runningPipelineIds.has(pipelineId);
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
