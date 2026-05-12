import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import pg from "pg";
import cron from "node-cron";
import { db, dbConnectionsTable, auditLogsTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";
import { encrypt, decrypt, loadEncryptionKey } from "../lib/crypto";
import { registerSchedule, cancelSchedule } from "../scheduler";

const { Pool } = pg;
const router: IRouter = Router();

function safeRow(r: typeof dbConnectionsTable.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    host: r.host,
    port: r.port,
    dbName: r.dbName,
    schemaName: r.schemaName,
    outputFilePath: r.outputFilePath,
    fetchQuery: r.fetchQuery,
    scheduleEnabled: r.scheduleEnabled,
    scheduleCron: r.scheduleCron,
    scheduleLastRunAt: r.scheduleLastRunAt,
    scheduleNextRunAt: r.scheduleNextRunAt,
    createdBy: r.createdBy,
    lastTestedAt: r.lastTestedAt,
    lastTestSuccess: r.lastTestSuccess,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// GET /api/admin/db-connections
router.get("/admin/db-connections", authenticate, requireRole("Admin"), async (_req, res) => {
  const rows = await db.select().from(dbConnectionsTable).orderBy(desc(dbConnectionsTable.createdAt));
  res.json(rows.map(safeRow));
});

// POST /api/admin/db-connections
router.post("/admin/db-connections", authenticate, requireRole("Admin"), async (req, res) => {
  const { name, type, host, port, dbName, schemaName, username, password, outputFilePath, fetchQuery, scheduleCron, scheduleEnabled } = req.body as {
    name: string; type: string; host: string; port?: number;
    dbName: string; schemaName?: string; username: string; password: string;
    outputFilePath?: string; fetchQuery?: string; scheduleCron?: string; scheduleEnabled?: boolean;
  };

  if (!name || !type || !host || !dbName || !username || !password) {
    res.status(400).json({ error: "name, type, host, dbName, username, and password are required" });
    return;
  }
  if (!["backoffice", "trading"].includes(type)) {
    res.status(400).json({ error: "type must be 'backoffice' or 'trading'" });
    return;
  }
  if (scheduleCron && !cron.validate(scheduleCron)) {
    res.status(400).json({ error: "Invalid cron expression" });
    return;
  }
  if (scheduleEnabled && !scheduleCron) {
    res.status(400).json({ error: "scheduleCron is required when scheduleEnabled is true" });
    return;
  }
  if ((scheduleCron || scheduleEnabled) && type !== "backoffice") {
    res.status(400).json({ error: "Schedule settings are only supported for backoffice connections" });
    return;
  }

  loadEncryptionKey();
  const [row] = await db.insert(dbConnectionsTable).values({
    name,
    type: type as "backoffice" | "trading",
    host,
    port: port ?? 5432,
    dbName,
    schemaName: schemaName ?? "public",
    usernameEnc: encrypt(username),
    passwordEnc: encrypt(password),
    outputFilePath: outputFilePath ?? null,
    fetchQuery: fetchQuery ?? null,
    scheduleCron: scheduleCron ?? null,
    scheduleEnabled: scheduleEnabled ?? false,
    createdBy: req.user!.sub,
  }).returning();

  if (row.scheduleEnabled && row.scheduleCron && row.type === "backoffice") {
    await registerSchedule(row.id, row.scheduleCron);
  }

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "DB_CONNECTION_CREATED",
    details: `Created DB connection: ${name} (${type}) → ${host}/${dbName}`,
    resourceType: "db_connection",
    resourceId: String(row.id),
    ipAddress: req.ip ?? null,
  });

  res.status(201).json(safeRow(row));
});

// PUT /api/admin/db-connections/:id
router.put("/admin/db-connections/:id", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, type, host, port, dbName, schemaName, username, password, outputFilePath, fetchQuery, scheduleCron, scheduleEnabled } = req.body as {
    name?: string; type?: string; host?: string; port?: number;
    dbName?: string; schemaName?: string; username?: string; password?: string;
    outputFilePath?: string; fetchQuery?: string; scheduleCron?: string; scheduleEnabled?: boolean;
  };

  const [existing] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Connection not found" }); return; }

  if (type && !["backoffice", "trading"].includes(type)) {
    res.status(400).json({ error: "type must be 'backoffice' or 'trading'" });
    return;
  }
  if (scheduleCron && !cron.validate(scheduleCron)) {
    res.status(400).json({ error: "Invalid cron expression" });
    return;
  }
  if (scheduleEnabled && !scheduleCron) {
    const effectiveCron = scheduleCron ?? existing.scheduleCron;
    if (!effectiveCron) {
      res.status(400).json({ error: "scheduleCron is required when scheduleEnabled is true" });
      return;
    }
  }
  const effectiveType = (type ?? existing.type) as "backoffice" | "trading";
  if ((scheduleCron !== undefined || scheduleEnabled !== undefined) && effectiveType !== "backoffice") {
    res.status(400).json({ error: "Schedule settings are only supported for backoffice connections" });
    return;
  }

  loadEncryptionKey();
  const updates: Partial<typeof dbConnectionsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (name) updates.name = name;
  if (type) updates.type = type as "backoffice" | "trading";
  if (host) updates.host = host;
  if (port) updates.port = port;
  if (dbName) updates.dbName = dbName;
  if (schemaName !== undefined) updates.schemaName = schemaName;
  if (username) updates.usernameEnc = encrypt(username);
  if (password) updates.passwordEnc = encrypt(password);
  if (outputFilePath !== undefined) updates.outputFilePath = outputFilePath;
  if (fetchQuery !== undefined) updates.fetchQuery = fetchQuery || null;
  if (scheduleCron !== undefined) updates.scheduleCron = scheduleCron || null;
  if (scheduleEnabled !== undefined) updates.scheduleEnabled = scheduleEnabled;

  const [updated] = await db.update(dbConnectionsTable).set(updates).where(eq(dbConnectionsTable.id, id)).returning();

  if (updated.type === "backoffice" && updated.scheduleEnabled && updated.scheduleCron) {
    await registerSchedule(updated.id, updated.scheduleCron);
  } else {
    cancelSchedule(updated.id);
  }

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "DB_CONNECTION_UPDATED",
    details: `Updated DB connection: ${updated.name} (id=${id})`,
    resourceType: "db_connection",
    resourceId: String(id),
    ipAddress: req.ip ?? null,
  });

  res.json(safeRow(updated));
});

// PUT /api/admin/db-connections/:id/schedule — Enable or disable schedule without editing the whole connection
router.put("/admin/db-connections/:id/schedule", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(req.params.id);
  const { enabled } = req.body as { enabled: boolean };

  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled (boolean) is required" });
    return;
  }

  const [existing] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Connection not found" }); return; }

  if (existing.type !== "backoffice") {
    res.status(400).json({ error: "Schedules are only supported for BackOffice connections" });
    return;
  }

  if (enabled && !existing.scheduleCron) {
    res.status(400).json({ error: "Cannot enable schedule: no cron expression configured" });
    return;
  }

  const [updated] = await db
    .update(dbConnectionsTable)
    .set({ scheduleEnabled: enabled, updatedAt: new Date() })
    .where(eq(dbConnectionsTable.id, id))
    .returning();

  if (enabled && updated.scheduleCron) {
    await registerSchedule(updated.id, updated.scheduleCron);
  } else {
    cancelSchedule(updated.id);
    await db
      .update(dbConnectionsTable)
      .set({ scheduleNextRunAt: null, updatedAt: new Date() })
      .where(eq(dbConnectionsTable.id, id));
  }

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: enabled ? "DB_CONNECTION_SCHEDULE_ENABLED" : "DB_CONNECTION_SCHEDULE_DISABLED",
    details: `${enabled ? "Enabled" : "Disabled"} schedule for connection: ${updated.name} (id=${id})`,
    resourceType: "db_connection",
    resourceId: String(id),
    ipAddress: req.ip ?? null,
  });

  res.json(safeRow(updated));
});

// DELETE /api/admin/db-connections/:id
router.delete("/admin/db-connections/:id", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Connection not found" }); return; }

  cancelSchedule(id);
  await db.delete(dbConnectionsTable).where(eq(dbConnectionsTable.id, id));

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "DB_CONNECTION_DELETED",
    details: `Deleted DB connection: ${existing.name} (id=${id})`,
    resourceType: "db_connection",
    resourceId: String(id),
    ipAddress: req.ip ?? null,
  });

  res.status(204).send();
});

// POST /api/admin/db-connections/:id/test
router.post("/admin/db-connections/:id/test", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(req.params.id);
  const [conn] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, id));
  if (!conn) { res.status(404).json({ error: "Connection not found" }); return; }

  loadEncryptionKey();
  let username: string;
  let password: string;
  try {
    username = decrypt(conn.usernameEnc);
    password = decrypt(conn.passwordEnc);
  } catch {
    res.status(500).json({ success: false, error: "Failed to decrypt credentials" });
    return;
  }

  const testPool = new Pool({
    host: conn.host,
    port: conn.port,
    database: conn.dbName,
    user: username,
    password,
    connectionTimeoutMillis: 5000,
    max: 1,
  });

  let success = false;
  let error: string | null = null;

  try {
    await testPool.query("SELECT 1");
    success = true;
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : "Connection failed";
  } finally {
    await testPool.end().catch(() => {});
  }

  await db.update(dbConnectionsTable).set({
    lastTestedAt: new Date(),
    lastTestSuccess: success,
    updatedAt: new Date(),
  }).where(eq(dbConnectionsTable.id, id));

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "DB_CONNECTION_TESTED",
    details: `Tested DB connection: ${conn.name} — ${success ? "SUCCESS" : `FAILED: ${error}`}`,
    resourceType: "db_connection",
    resourceId: String(id),
    ipAddress: req.ip ?? null,
  });

  if (success) {
    res.json({ success: true, message: "Connection successful" });
  } else {
    res.status(400).json({ success: false, error });
  }
});

export default router;
