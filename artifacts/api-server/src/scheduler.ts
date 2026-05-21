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
import { sendMailTemplate, getAppName } from "./lib/mailer";
import { spawn } from "child_process";
import { resolve as pathResolve } from "path";

const CONSECUTIVE_FAILURE_THRESHOLD = 3;

// ── Live pipeline progress (in-memory, keyed by pipelineId) ─────────────────
export interface JobProgress {
  jobId: number;
  pipelineId: number;
  step: string;
  stepNum: number;
  rowsRead: number;
  rowsWritten: number;
  batchNum: number;
  pct: number;
  done: boolean;
  error?: string;
}

const activeProgress = new Map<number, JobProgress>();

export function getJobProgress(pipelineId: number): JobProgress | null {
  return activeProgress.get(pipelineId) ?? null;
}

function parseProgressLine(line: string, p: JobProgress): void {
  const msg = line.replace(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\]\s*/, "");
  if (!msg) return;
  if (msg.includes("[PRE-SQL]") && !msg.includes("Skipped")) {
    p.step = "Running pre-SQL"; p.stepNum = 1; p.pct = Math.max(p.pct, 5);
  } else if (msg.includes("[REFLECT]")) {
    p.step = "Reflecting schema"; p.stepNum = 2; p.pct = Math.max(p.pct, 12);
  } else if (msg.includes("[DEST] Opening")) {
    p.step = "Connecting to destination"; p.stepNum = 3; p.pct = Math.max(p.pct, 20);
  } else if (
    msg.includes("[SRC]") &&
    (msg.includes("Oracle") || msg.includes("Executing") || msg.includes("Streaming") || msg.includes("server-side"))
  ) {
    p.step = "Reading source data"; p.stepNum = 4; p.pct = Math.max(p.pct, 26);
  } else if (/Batch #\d+:/.test(msg)) {
    const m = msg.match(/Batch #(\d+):[^(]*\(totals src=([\d,]+)[^d]*dst=([\d,]+)\)/);
    if (m) {
      p.batchNum   = parseInt(m[1]);
      p.rowsRead   = parseInt(m[2].replace(/,/g, ""));
      p.rowsWritten = parseInt(m[3].replace(/,/g, ""));
      p.step = "Transferring data"; p.stepNum = 5;
      p.pct = Math.min(26 + p.batchNum * 4, 88);
    }
  } else if (msg.includes("[POST-SQL]") && !msg.includes("Skipped")) {
    p.step = "Running post-SQL"; p.stepNum = 5; p.pct = Math.max(p.pct, 92);
  } else if (msg.includes("cursor closed") || msg.includes("[SRC] Source")) {
    p.pct = Math.max(p.pct, 90);
  } else if (msg.startsWith("FATAL:")) {
    p.step = "Failed"; p.error = msg.replace("FATAL: ", ""); p.done = true;
  }
}

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

/** Strip raw SQL, parameter lists and stack traces from error strings. */
function sanitizeErrMsg(msg: string): string {
  const lines = msg.split(/\r?\n/).filter(l => {
    const t = l.trim();
    if (t.startsWith("[SQL:") || t.startsWith("[parameters:") ||
        t.startsWith("(Background on this error") || t.startsWith("DETAIL:") ||
        t.startsWith("HINT:") || t.startsWith("CONTEXT:")) return false;
    return true;
  });
  const joined = lines.join(" ").replace(/\s+/g, " ").trim();
  return joined.length > 500 ? joined.slice(0, 500) + "…" : joined;
}

async function sendFailureAlert(
  pipelineName: string, pipelineId: number, failures: number, lastError: string
): Promise<void> {
  const emails = await getAdminEmails();
  if (!emails.length) return;
  const ts = toIst(new Date());
  const appName = await getAppName().catch(() => "Ashika Platform");
  for (const email of emails) {
    try {
      await sendMailTemplate(email, "pipeline_failure_admin", {
        pipelineName, pipelineId: String(pipelineId),
        failures: String(failures), errorMessage: lastError, timestamp: ts, appName,
      }, {
        subject: `Alert: Pipeline "${pipelineName}" failed ${failures} times in a row`,
        html: buildFailureHtml(pipelineName, pipelineId, failures, lastError, ""),
      });
    } catch { /* non-fatal */ }
  }
}

function formatDuration(startedAt: Date, finishedAt: Date): string {
  const secs = Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function buildFailureHtml(
  pipelineName: string, pipelineId: number, failures: number, lastError: string, workerLog: string,
  startedAt?: Date
): string {
  const safe = (s: string) => escapeHtml(s);
  const finishedAt = new Date();
  const ts = toIst(finishedAt);
  const timingRows = startedAt ? `
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Started (IST)</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${toIst(startedAt)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Duration</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${formatDuration(startedAt, finishedAt)}</td></tr>` : "";
  return `
    <div style="font-family:sans-serif;max-width:700px">
      <h2 style="color:#dc2626">Pipeline Failure Alert</h2>
      <p>Pipeline <strong>${safe(pipelineName)}</strong> (ID: ${pipelineId}) has failed
         <strong>${failures} consecutive time${failures !== 1 ? "s" : ""}</strong>.</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold;width:180px">Pipeline</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${safe(pipelineName)} (ID: ${pipelineId})</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Failures</td>
            <td style="padding:8px;border:1px solid #e5e7eb;color:#dc2626">${failures}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Failed At (IST)</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${ts}</td></tr>
        ${timingRows}
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Technical Error</td>
            <td style="padding:8px;border:1px solid #e5e7eb;font-family:monospace;font-size:13px;color:#dc2626">${safe(lastError)}</td></tr>
      </table>
      <p style="color:#374151"><strong>Functional impact:</strong> Data transfer from source to destination was not completed for this run. Downstream systems relying on this pipeline may have stale or missing data. Please investigate the source connection, query, and destination table configuration.</p>
      ${workerLog ? `<h3 style="margin-top:20px">Worker Log</h3><pre style="background:#f3f4f6;padding:12px;border-radius:6px;font-size:12px;overflow:auto;max-height:300px">${safe(workerLog)}</pre>` : ""}
    </div>
  `;
}

function buildSuccessHtml(
  pipelineName: string, pipelineId: number,
  sourceRecordCount: number, recordCount: number,
  startedAt: Date, finishedAt: Date
): string {
  const safe = (s: string) => escapeHtml(s);
  return `
    <div style="font-family:sans-serif;max-width:650px">
      <h2 style="color:#16a34a">Pipeline Run Successful</h2>
      <p>Pipeline <strong>${safe(pipelineName)}</strong> completed successfully.</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold;width:180px">Pipeline</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${safe(pipelineName)} (ID: ${pipelineId})</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Source Records</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${sourceRecordCount.toLocaleString()} row${sourceRecordCount !== 1 ? "s" : ""} read</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Records Transferred</td>
            <td style="padding:8px;border:1px solid #e5e7eb;color:#16a34a">${recordCount.toLocaleString()} row${recordCount !== 1 ? "s" : ""} written</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Started (IST)</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${toIst(startedAt)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Completed (IST)</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${toIst(finishedAt)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:bold">Duration</td>
            <td style="padding:8px;border:1px solid #e5e7eb">${formatDuration(startedAt, finishedAt)}</td></tr>
      </table>
    </div>
  `;
}


/** Resolve the pipeline_worker.py path at runtime.
 *  Uses __dirname (injected by the build banner) so the path is always correct
 *  regardless of the working directory PM2 uses to launch the process.
 *  __dirname = .../artifacts/api-server/dist/  →  lib/pipeline_worker.py sits beside it. */
function getWorkerPath(): string {
  return pathResolve(__dirname, "lib", "pipeline_worker.py");
}

export interface PipelineRunResult {
  success: boolean;
  recordCount?: number;
  sourceRecordCount?: number;
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

  // Decrypt credentials early — Oracle schema defaulting requires the username
  loadEncryptionKey();
  let srcUser = "", srcPass = "", dstUser = "", dstPass = "";
  try {
    srcUser = srcConn.usernameEnc ? decrypt(srcConn.usernameEnc) : "";
    srcPass = srcConn.passwordEnc ? decrypt(srcConn.passwordEnc) : "";
    dstUser = dstConn.usernameEnc ? decrypt(dstConn.usernameEnc) : "";
    dstPass = dstConn.passwordEnc ? decrypt(dstConn.passwordEnc) : "";
  } catch {
    return { success: false, error: "Failed to decrypt credentials" };
  }

  // Build effective source query (object-resolved or legacy)
  if (!sourceQuery && legacySourceTable) {
    const isOracleSrc = srcConn.dbEngine === "oracle";
    // For Oracle: both schema AND table must be uppercased — double-quoted identifiers are case-sensitive
    const schema = isOracleSrc
      ? (srcConn.schemaName ?? srcUser).toUpperCase()
      : (srcConn.schemaName ?? "public");
    const table  = isOracleSrc ? legacySourceTable.toUpperCase() : legacySourceTable;
    sourceQuery = `SELECT * FROM "${schema}"."${table}"`;
  }
  if (!sourceQuery) return { success: false, error: "No source table or query configured" };

  process.stdout.write(`[SCHEDULER-SRC] pipeline=${pipelineId} sourceObjectId=${pipeline.sourceObjectId ?? null} legacySourceTable=${JSON.stringify(legacySourceTable)} sourceQuery=${JSON.stringify(sourceQuery)} srcEngine=${srcConn.dbEngine} srcSchemaName=${JSON.stringify(srcConn.schemaName)} srcUser=${JSON.stringify(srcUser)}\n`);

  // Build schema-qualified destTarget so the Python worker always receives "schema.table"
  const isDstOracle = dstConn.dbEngine === "oracle";

  const qualifyDest = (raw: string): string => {
    if (raw.includes(".")) {
      // Already schema-qualified — just uppercase both parts for Oracle, leave as-is for PG
      const dotIdx = raw.indexOf(".");
      const s = raw.slice(0, dotIdx);
      const t = raw.slice(dotIdx + 1);
      return isDstOracle ? `${s.toUpperCase()}.${t.toUpperCase()}` : raw;
    } else {
      // Plain table name — use connection schemaName if set, else username for Oracle, else "public"
      const schema = dstConn.schemaName
        ? (isDstOracle ? dstConn.schemaName.toUpperCase() : dstConn.schemaName)
        : (isDstOracle ? dstUser.toUpperCase() : "public");
      const table  = isDstOracle ? raw.toUpperCase() : raw;
      return `${schema}.${table}`;
    }
  };

  if (destObjectValue !== null) {
    destTarget = qualifyDest(destObjectValue);
  } else if (destTarget) {
    destTarget = qualifyDest(destTarget);
  }

  process.stdout.write(`[SCHEDULER] pipeline=${pipelineId} destObjectValue=${JSON.stringify(destObjectValue)} destTarget=${JSON.stringify(destTarget)} dstSchemaName=${JSON.stringify(dstConn.schemaName)} dstUser=${JSON.stringify(dstUser)} isDstOracle=${isDstOracle}\n`);

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

  const mappings = await db
    .select().from(pipelineFieldMappingsTable)
    .where(eq(pipelineFieldMappingsTable.pipelineId, pipelineId))
    .orderBy(asc(pipelineFieldMappingsTable.sortOrder));

  const workerConfig = {
    pipelineId: pipelineId,
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
    loadType:         pipeline.loadType         ?? "full_load",
    preSqlCommand:    pipeline.preSqlCommand?.trim()    || null,
    postSqlCommand:   pipeline.postSqlCommand?.trim()   || null,
    conflictColumns:  pipeline.conflictColumns?.trim()  || null,
    watermarkColumn:  pipeline.watermarkColumn?.trim()  || null,
    currentWatermark: pipeline.lastWatermarkValue?.trim() || null,
  };

  const workerPath = getWorkerPath();

  // Initialise in-memory progress record
  const progress: JobProgress = {
    jobId: job.id, pipelineId,
    step: "Initializing", stepNum: 1,
    rowsRead: 0, rowsWritten: 0, batchNum: 0,
    pct: 2, done: false,
  };
  activeProgress.set(pipelineId, progress);

  return new Promise((resolvePromise) => {
    const child = spawn(process.env["PYTHON_BIN"] ?? "/home/ubuntu/etl_env/bin/python3", [workerPath], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.write(JSON.stringify(workerConfig));
    child.stdin.end();

    let stdout = "";
    let stderr = "";
    let stderrLineBuf = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => {
      const chunk = d.toString();
      stderr += chunk;
      stderrLineBuf += chunk;
      let nl: number;
      while ((nl = stderrLineBuf.indexOf("\n")) !== -1) {
        const line = stderrLineBuf.slice(0, nl);
        stderrLineBuf = stderrLineBuf.slice(nl + 1);
        parseProgressLine(line, progress);
      }
    });

    child.on("close", async (code) => {
      let result: { success: boolean; recordCount?: number; sourceRecordCount?: number; error?: string };
      try {
        result = JSON.parse(stdout.trim());
      } catch {
        result = { success: false, error: stderr.trim() || `Worker exited with code ${code}` };
      }

      if (result.success) {
        const rc = result.recordCount ?? 0;
        const srcRc = result.sourceRecordCount ?? rc;
        const finishedAt = new Date();
        await db.update(dataJobsTable).set({
          status: "success",
          recordCount: rc,
          sourceRecordCount: srcRc,
          finishedAt,
        }).where(eq(dataJobsTable.id, job.id));

        // Update pipeline stats; persist new watermark if worker returned one
        const pipelineUpdates: Record<string, unknown> = {
          scheduleConsecutiveFailures: 0,
          scheduleLastRunAt: new Date(),
          updatedAt: new Date(),
        };
        if (result.newWatermark) {
          pipelineUpdates.lastWatermarkValue = String(result.newWatermark);
        }
        await db.update(dataPipelinesTable).set(pipelineUpdates).where(eq(dataPipelinesTable.id, pipelineId));

        await db.insert(auditLogsTable).values({
          action: "PIPELINE_RUN_COMPLETED",
          details: `Pipeline "${pipeline.name}" — ${rc} row(s) transferred (job=${job.id})`,
          resourceType: "pipeline", resourceId: String(pipelineId),
        });

        // Pipeline-level success notification
        if (pipeline.notifyOnSuccess?.trim()) {
          const appName = await getAppName().catch(() => "Ashika Platform");
          const list = pipeline.notifyOnSuccess.split(",").map(e => e.trim()).filter(Boolean);
          for (const email of list) {
            sendMailTemplate(email, "pipeline_success", {
              pipelineName: pipeline.name, pipelineId: String(pipelineId),
              sourceRecordCount: srcRc.toLocaleString(), recordCount: rc.toLocaleString(),
              completedAt: toIst(finishedAt), appName,
            }, {
              subject: `Pipeline "${pipeline.name}" completed successfully`,
              html: buildSuccessHtml(pipeline.name, pipelineId, srcRc, rc, job.startedAt!, finishedAt),
            }).catch(() => {});
          }
        }

        logger.info({ pipelineId, jobId: job.id, recordCount: rc, sourceRecordCount: srcRc }, "Pipeline run completed");
        progress.step = "Complete"; progress.stepNum = 6; progress.pct = 100;
        progress.rowsWritten = rc; progress.rowsRead = srcRc; progress.done = true;
        setTimeout(() => activeProgress.delete(pipelineId), 30_000);
        resolvePromise({ success: true, recordCount: rc, sourceRecordCount: srcRc, jobId: job.id });
      } else {
        const rawErr  = result.error ?? "Unknown error";
        const errMsg  = sanitizeErrMsg(rawErr);
        await db.update(dataJobsTable).set({ status: "failed", errorMessage: errMsg, finishedAt: new Date() }).where(eq(dataJobsTable.id, job.id));
        const jobStartedAt = job.startedAt ?? undefined;

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

        // Pipeline-level failure notification
        if (pipeline.notifyOnFailure?.trim()) {
          const ts = toIst(new Date());
          const appName = await getAppName().catch(() => "Ashika Platform");
          const list = pipeline.notifyOnFailure.split(",").map(e => e.trim()).filter(Boolean);
          for (const email of list) {
            sendMailTemplate(email, "pipeline_failure", {
              pipelineName: pipeline.name, pipelineId: String(pipelineId),
              failures: String(failures), errorMessage: errMsg, timestamp: ts, appName,
            }, {
              subject: `Pipeline "${pipeline.name}" failed`,
              html: buildFailureHtml(pipeline.name, pipelineId, failures, errMsg, "", jobStartedAt),
            }).catch(() => {});
          }
        }

        logger.error({ pipelineId, jobId: job.id, errMsg }, "Pipeline run failed");
        progress.step = "Failed"; progress.done = true; progress.error = errMsg;
        setTimeout(() => activeProgress.delete(pipelineId), 30_000);
        resolvePromise({ success: false, error: errMsg, jobId: job.id });
      }
    });

    child.on("error", async (err) => {
      const msg = err.message;
      await db.update(dataJobsTable).set({ status: "failed", errorMessage: msg, finishedAt: new Date() }).where(eq(dataJobsTable.id, job.id));
      progress.step = "Failed"; progress.done = true; progress.error = msg;
      setTimeout(() => activeProgress.delete(pipelineId), 30_000);
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
