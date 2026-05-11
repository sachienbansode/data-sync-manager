import cron from "node-cron";
import pg from "pg";
import { eq, and } from "drizzle-orm";
import { db, dbConnectionsTable, dataJobsTable, dataStagingTable, auditLogsTable } from "@workspace/db";
import { decrypt, loadEncryptionKey } from "./lib/crypto";
import { logger } from "./lib/logger";

const { Pool } = pg;

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

export async function runScheduledFetch(connectionId: number): Promise<void> {
  const [conn] = await db
    .select()
    .from(dbConnectionsTable)
    .where(eq(dbConnectionsTable.id, connectionId));

  if (!conn) {
    logger.warn({ connectionId }, "Scheduled fetch: connection not found");
    return;
  }

  loadEncryptionKey();
  let username: string;
  let password: string;
  try {
    username = decrypt(conn.usernameEnc);
    password = decrypt(conn.passwordEnc);
  } catch (err) {
    logger.error({ connectionId, err }, "Scheduled fetch: failed to decrypt credentials");
    return;
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

  await db
    .update(dbConnectionsTable)
    .set({ scheduleLastRunAt: new Date(), updatedAt: new Date() })
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
      return;
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

    await db.insert(auditLogsTable).values({
      action: "WORKFLOW_FETCH_SCHEDULED",
      details: `Scheduled fetch: ${rows.length} rows from ${conn.name} (job id=${job.id})`,
      resourceType: "data_job",
      resourceId: String(job.id),
    });

    logger.info({ connectionId, jobId: job.id, rowCount: rows.length }, "Scheduled fetch completed");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Fetch failed";
    await db
      .update(dataJobsTable)
      .set({ status: "failed", errorMessage: msg, finishedAt: new Date() })
      .where(eq(dataJobsTable.id, job.id));
    logger.error({ connectionId, jobId: job.id, err }, "Scheduled fetch failed");
  } finally {
    await fetchPool.end().catch(() => {});
  }
}

type ScheduledTask = ReturnType<typeof cron.schedule>;
const activeTasks = new Map<number, ScheduledTask>();

export function registerSchedule(connectionId: number, cronExpression: string): void {
  cancelSchedule(connectionId);

  if (!cron.validate(cronExpression)) {
    logger.warn({ connectionId, cronExpression }, "Invalid cron expression — schedule not registered");
    return;
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
      registerSchedule(conn.id, conn.scheduleCron);
    }
  }

  logger.info({ count: connections.length }, "Scheduler initialised");
}
