import cron from "node-cron";
import { CronExpressionParser } from "cron-parser";
import pg from "pg";
import { eq, and, sql } from "drizzle-orm";
import { db, dbConnectionsTable, dataJobsTable, dataStagingTable, auditLogsTable, usersTable, rolesTable } from "@workspace/db";
import { decrypt, loadEncryptionKey } from "./lib/crypto";
import { logger } from "./lib/logger";
import { sendMail } from "./lib/mailer";

const { Pool } = pg;

const CONSECUTIVE_FAILURE_THRESHOLD = 3;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DML_PATTERN =
  /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|EXECUTE|EXEC|CALL|MERGE)\b/i;

function validateSelectQuery(query: string): string | null {
  const q = query.trim();
  if (!q) return "Query cannot be empty";
  if (!/^SELECT\b/i.test(q)) return "Query must start with SELECT";
  if (q.includes(";")) return "Query must not contain semicolons";
  const match = q.match(DML_PATTERN);
  if (match) return `Query must not contain ${match[0].toUpperCase()} statements`;
  return null;
}

function computeNextRunAt(cronExpression: string): Date | null {
  try {
    const interval = CronExpressionParser.parse(cronExpression);
    return interval.next().toDate();
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
  } catch (err) {
    logger.error({ err }, "Failed to fetch admin emails for alert");
    return [];
  }
}

async function sendFailureAlertEmail(
  connectionName: string,
  connectionId: number,
  consecutiveFailures: number,
  lastError: string
): Promise<void> {
  const adminEmails = await getAdminEmails();
  if (adminEmails.length === 0) {
    logger.warn({ connectionId }, "No admin emails found — skipping failure alert");
    return;
  }

  const safeName = escapeHtml(connectionName);
  const safeError = escapeHtml(lastError);
  const subject = `Alert: Scheduled fetch for "${connectionName}" has failed ${consecutiveFailures} times in a row`;
  const html = `
    <div style="font-family: sans-serif; max-width: 600px;">
      <h2 style="color: #dc2626;">Scheduled Fetch Alert</h2>
      <p>The scheduled data fetch for connection <strong>${safeName}</strong> (ID: ${connectionId}) has failed <strong>${consecutiveFailures} consecutive time${consecutiveFailures !== 1 ? "s" : ""}</strong>.</p>
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
        <tr>
          <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold; background: #f9fafb;">Connection</td>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">${safeName} (ID: ${connectionId})</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold; background: #f9fafb;">Consecutive Failures</td>
          <td style="padding: 8px; border: 1px solid #e5e7eb; color: #dc2626;">${consecutiveFailures}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold; background: #f9fafb;">Last Error</td>
          <td style="padding: 8px; border: 1px solid #e5e7eb; font-family: monospace; font-size: 13px;">${safeError}</td>
        </tr>
        <tr>
          <td style="padding: 8px; border: 1px solid #e5e7eb; font-weight: bold; background: #f9fafb;">Time</td>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">${new Date().toISOString()}</td>
        </tr>
      </table>
      <p style="color: #6b7280; font-size: 14px;">Please investigate the connection and resolve the underlying issue. This alert is sent every time the failure count reaches a multiple of ${CONSECUTIVE_FAILURE_THRESHOLD}.</p>
    </div>
  `;

  for (const email of adminEmails) {
    try {
      await sendMail(email, subject, html);
      logger.info({ connectionId, email }, "Sent failure alert email to admin");
    } catch (err) {
      logger.error({ connectionId, email, err }, "Failed to send failure alert email");
    }
  }
}

export interface FetchResult {
  success: boolean;
  recordCount?: number;
  error?: string;
}

export async function runScheduledFetch(connectionId: number): Promise<FetchResult> {
  const [conn] = await db
    .select()
    .from(dbConnectionsTable)
    .where(eq(dbConnectionsTable.id, connectionId));

  if (!conn) {
    logger.warn({ connectionId }, "Scheduled fetch: connection not found");
    return { success: false, error: "Connection not found" };
  }

  loadEncryptionKey();
  let username: string;
  let password: string;
  try {
    username = decrypt(conn.usernameEnc);
    password = decrypt(conn.passwordEnc);
  } catch (err) {
    logger.error({ connectionId, err }, "Scheduled fetch: failed to decrypt credentials");
    return { success: false, error: "Failed to decrypt credentials" };
  }

  const [job] = await db
    .insert(dataJobsTable)
    .values({
      type: "fetch",
      status: "running",
      triggeredBySchedule: true,
      connectionId: conn.id,
      connectionName: conn.name,
      startedAt: new Date(),
    })
    .returning();

  const nextRunAt = conn.scheduleCron ? computeNextRunAt(conn.scheduleCron) : null;
  await db
    .update(dbConnectionsTable)
    .set({
      scheduleLastRunAt: new Date(),
      scheduleNextRunAt: nextRunAt,
      updatedAt: new Date(),
    })
    .where(eq(dbConnectionsTable.id, connectionId));

  const fetchPool = new Pool({
    host: conn.host,
    port: conn.port,
    database: conn.dbName,
    user: username,
    password,
    connectionTimeoutMillis: 10000,
    max: 1,
  });

  try {
    const rawQuery = conn.fetchQuery?.trim() ?? "";
    const defaultQuery = `SELECT * FROM "${conn.schemaName}"."backoffice_data" LIMIT 1000`;
    const selectQuery = rawQuery || defaultQuery;

    const queryError = validateSelectQuery(selectQuery);
    if (queryError) {
      await db
        .update(dataJobsTable)
        .set({ status: "failed", errorMessage: queryError, finishedAt: new Date() })
        .where(eq(dataJobsTable.id, job.id));
      logger.warn({ connectionId, queryError }, "Scheduled fetch: invalid query");

      const [failureRow] = await db
        .update(dbConnectionsTable)
        .set({ scheduleConsecutiveFailures: sql`${dbConnectionsTable.scheduleConsecutiveFailures} + 1`, updatedAt: new Date() })
        .where(eq(dbConnectionsTable.id, connectionId))
        .returning({ scheduleConsecutiveFailures: dbConnectionsTable.scheduleConsecutiveFailures });
      const newFailures = failureRow?.scheduleConsecutiveFailures ?? 1;

      if (newFailures % CONSECUTIVE_FAILURE_THRESHOLD === 0) {
        await sendFailureAlertEmail(conn.name, connectionId, newFailures, queryError);
      }
      return { success: false, error: queryError };
    }

    const result = await fetchPool.query(selectQuery);
    const rows = result.rows as Record<string, unknown>[];

    if (rows.length > 0) {
      await db.insert(dataStagingTable).values(
        rows.map((row, i) => ({ jobId: job.id, rowIndex: i, rawData: row }))
      );
    }

    await db
      .update(dataJobsTable)
      .set({ status: "success", recordCount: rows.length, finishedAt: new Date() })
      .where(eq(dataJobsTable.id, job.id));

    await db
      .update(dbConnectionsTable)
      .set({ scheduleConsecutiveFailures: 0, updatedAt: new Date() })
      .where(eq(dbConnectionsTable.id, connectionId));

    await db.insert(auditLogsTable).values({
      action: "WORKFLOW_FETCH_SCHEDULED",
      details: `Scheduled fetch: ${rows.length} rows from ${conn.name} (job id=${job.id})`,
      resourceType: "data_job",
      resourceId: String(job.id),
    });

    logger.info({ connectionId, jobId: job.id, rowCount: rows.length }, "Scheduled fetch completed");
    return { success: true, recordCount: rows.length };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Fetch failed";
    await db
      .update(dataJobsTable)
      .set({ status: "failed", errorMessage: msg, finishedAt: new Date() })
      .where(eq(dataJobsTable.id, job.id));

    const [failureRow] = await db
      .update(dbConnectionsTable)
      .set({ scheduleConsecutiveFailures: sql`${dbConnectionsTable.scheduleConsecutiveFailures} + 1`, updatedAt: new Date() })
      .where(eq(dbConnectionsTable.id, connectionId))
      .returning({ scheduleConsecutiveFailures: dbConnectionsTable.scheduleConsecutiveFailures });
    const newFailures = failureRow?.scheduleConsecutiveFailures ?? 1;

    if (newFailures % CONSECUTIVE_FAILURE_THRESHOLD === 0) {
      await sendFailureAlertEmail(conn.name, connectionId, newFailures, msg);
    }

    logger.error({ connectionId, jobId: job.id, err }, "Scheduled fetch failed");
    return { success: false, error: msg };
  } finally {
    await fetchPool.end().catch(() => {});
  }
}

type ScheduledTask = ReturnType<typeof cron.schedule>;
const activeTasks = new Map<number, ScheduledTask>();

export async function registerSchedule(connectionId: number, cronExpression: string): Promise<void> {
  cancelSchedule(connectionId);

  if (!cron.validate(cronExpression)) {
    logger.warn({ connectionId, cronExpression }, "Invalid cron expression — schedule not registered");
    return;
  }

  const nextRunAt = computeNextRunAt(cronExpression);
  if (nextRunAt) {
    await db
      .update(dbConnectionsTable)
      .set({ scheduleNextRunAt: nextRunAt, updatedAt: new Date() })
      .where(eq(dbConnectionsTable.id, connectionId));
  }

  const task = cron.schedule(cronExpression, () => {
    runScheduledFetch(connectionId).catch((err) =>
      logger.error({ connectionId, err }, "Unhandled error in scheduled fetch")
    );
  });

  activeTasks.set(connectionId, task);
  logger.info({ connectionId, cronExpression }, "Scheduled fetch registered");
}

export function cancelSchedule(connectionId: number): void {
  const existing = activeTasks.get(connectionId);
  if (existing) {
    existing.stop();
    activeTasks.delete(connectionId);
    logger.info({ connectionId }, "Scheduled fetch cancelled");
  }
}

export async function initScheduler(): Promise<void> {
  const connections = await db
    .select()
    .from(dbConnectionsTable)
    .where(
      and(
        eq(dbConnectionsTable.scheduleEnabled, true),
        eq(dbConnectionsTable.type, "backoffice")
      )
    );

  for (const conn of connections) {
    if (conn.scheduleCron) {
      await registerSchedule(conn.id, conn.scheduleCron);
    }
  }

  logger.info({ count: connections.length }, "Scheduler initialised");
}
