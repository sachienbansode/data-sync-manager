import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import pg from "pg";
import { db, dbConnectionsTable, auditLogsTable, dataJobsTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";
import { encrypt, decrypt, loadEncryptionKey } from "../lib/crypto";

const { Pool } = pg;
const router: IRouter = Router();

function getIp(req: import("express").Request): string | null {
  return Array.isArray(req.ip) ? (req.ip[0] ?? null) : (req.ip ?? null);
}

function safeRow(r: typeof dbConnectionsTable.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    dbEngine: r.dbEngine,
    host: r.host,
    port: r.port,
    dbName: r.dbName,
    schemaName: r.schemaName,
    extraParams: r.extraParams,
    fetchQuery: r.fetchQuery,
    outputFilePath: r.outputFilePath,
    createdBy: r.createdBy,
    lastTestedAt: r.lastTestedAt,
    lastTestSuccess: r.lastTestSuccess,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const FILE_ENGINES = ["s3", "sftp", "csv"] as const;
function isFileEngine(engine: string) { return (FILE_ENGINES as readonly string[]).includes(engine); }

// GET /api/admin/db-connections
router.get("/admin/db-connections", authenticate, requireRole("Admin"), async (_req, res) => {
  const rows = await db.select().from(dbConnectionsTable).orderBy(desc(dbConnectionsTable.createdAt));
  res.json(rows.map(safeRow));
});

// GET /api/admin/db-connections/:id/tables — list tables in the connected DB (PostgreSQL only)
router.get("/admin/db-connections/:id/tables", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [conn] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, id));
  if (!conn) { res.status(404).json({ error: "Connection not found" }); return; }

  if (isFileEngine(conn.dbEngine)) {
    res.json({ tables: [] });
    return;
  }

  loadEncryptionKey();
  let username: string;
  let password: string;
  try {
    username = decrypt(conn.usernameEnc ?? "");
    password = decrypt(conn.passwordEnc ?? "");
  } catch {
    res.status(500).json({ error: "Failed to decrypt credentials" });
    return;
  }

  const pool = new Pool({
    host: conn.host ?? undefined,
    port: conn.port ?? 5432,
    database: conn.dbName ?? undefined,
    user: username,
    password,
    connectionTimeoutMillis: 8000,
    max: 1,
  });

  try {
    const schema = conn.schemaName ?? "public";
    // Works for PostgreSQL; for other engines falls back to information_schema
    let tables: string[] = [];
    if (conn.dbEngine === "postgresql") {
      const result = await pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE'
         ORDER BY table_name`,
        [schema]
      );
      tables = result.rows.map((r: { table_name: string }) => r.table_name);
    } else {
      // MySQL / MSSQL / Oracle — generic information_schema fallback
      const result = await pool.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = DATABASE()
         ORDER BY table_name`
      );
      tables = result.rows.map((r: { table_name: string }) => r.table_name);
    }
    res.json({ tables, schema });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to list tables";
    res.status(500).json({ error: msg });
  } finally {
    await pool.end().catch(() => {});
  }
});

// POST /api/admin/db-connections
router.post("/admin/db-connections", authenticate, requireRole("Admin"), async (req, res) => {
  const {
    name, type, dbEngine, host, port, dbName, schemaName, username, password, extraParams,
    fetchQuery, outputFilePath,
  } = req.body as {
    name: string; type: string; dbEngine?: string; host?: string; port?: number;
    dbName?: string; schemaName?: string; username?: string; password?: string;
    extraParams?: Record<string, string>; fetchQuery?: string; outputFilePath?: string;
  };

  if (!name || !type) {
    res.status(400).json({ error: "name and type are required" });
    return;
  }
  if (!["backoffice", "trading"].includes(type)) {
    res.status(400).json({ error: "type must be 'backoffice' or 'trading'" });
    return;
  }
  const engine = dbEngine ?? "postgresql";
  if (!isFileEngine(engine) && (!host || !dbName || !username || !password)) {
    res.status(400).json({ error: "host, dbName, username, and password are required for database connections" });
    return;
  }
  if (isFileEngine(engine) && engine === "s3" && !extraParams?.bucket) {
    res.status(400).json({ error: "bucket is required for S3 connections" });
    return;
  }

  loadEncryptionKey();
  const [row] = await db.insert(dbConnectionsTable).values({
    name,
    type: type as "backoffice" | "trading",
    dbEngine: engine as typeof dbConnectionsTable.$inferInsert["dbEngine"],
    host: host ?? null,
    port: port ?? (isFileEngine(engine) ? null : 5432),
    dbName: dbName ?? null,
    schemaName: schemaName ?? "public",
    usernameEnc: username ? encrypt(username) : null,
    passwordEnc: password ? encrypt(password) : null,
    extraParams: extraParams ?? null,
    fetchQuery: fetchQuery ?? null,
    outputFilePath: outputFilePath ?? null,
    createdBy: req.user!.sub,
  }).returning();

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "DB_CONNECTION_CREATED",
    details: `Created DB connection: ${name} (${type}) engine=${engine}`,
    resourceType: "db_connection",
    resourceId: String(row.id),
    ipAddress: getIp(req),
  });

  res.status(201).json(safeRow(row));
});

// PUT /api/admin/db-connections/:id
router.put("/admin/db-connections/:id", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const { name, type, dbEngine, host, port, dbName, schemaName, username, password, extraParams, fetchQuery, outputFilePath } = req.body as {
    name?: string; type?: string; dbEngine?: string; host?: string; port?: number;
    dbName?: string; schemaName?: string; username?: string; password?: string;
    extraParams?: Record<string, string>; fetchQuery?: string | null; outputFilePath?: string | null;
  };

  const [existing] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Connection not found" }); return; }

  if (type && !["backoffice", "trading"].includes(type)) {
    res.status(400).json({ error: "type must be 'backoffice' or 'trading'" });
    return;
  }

  loadEncryptionKey();
  const updates: Partial<typeof dbConnectionsTable.$inferInsert> = { updatedAt: new Date() };
  if (name) updates.name = name;
  if (type) updates.type = type as "backoffice" | "trading";
  if (dbEngine) updates.dbEngine = dbEngine as typeof dbConnectionsTable.$inferInsert["dbEngine"];
  if (host !== undefined) updates.host = host || null;
  if (port) updates.port = port;
  if (dbName !== undefined) updates.dbName = dbName || null;
  if (schemaName !== undefined) updates.schemaName = schemaName;
  if (username) updates.usernameEnc = encrypt(username);
  if (password) updates.passwordEnc = encrypt(password);
  if (extraParams !== undefined) updates.extraParams = extraParams;
  if (fetchQuery !== undefined) updates.fetchQuery = fetchQuery ?? null;
  if (outputFilePath !== undefined) updates.outputFilePath = outputFilePath ?? null;

  const [updated] = await db.update(dbConnectionsTable).set(updates).where(eq(dbConnectionsTable.id, id)).returning();

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "DB_CONNECTION_UPDATED",
    details: `Updated DB connection: ${updated.name} (id=${id})`,
    resourceType: "db_connection",
    resourceId: String(id),
    ipAddress: getIp(req),
  });

  res.json(safeRow(updated));
});

// DELETE /api/admin/db-connections/:id
router.delete("/admin/db-connections/:id", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [existing] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Connection not found" }); return; }

  await db.delete(dbConnectionsTable).where(eq(dbConnectionsTable.id, id));

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "DB_CONNECTION_DELETED",
    details: `Deleted DB connection: ${existing.name} (id=${id})`,
    resourceType: "db_connection",
    resourceId: String(id),
    ipAddress: getIp(req),
  });

  res.status(204).send();
});

// POST /api/admin/db-connections/:id/test — verify connectivity
router.post("/admin/db-connections/:id/test", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [conn] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, id));
  if (!conn) { res.status(404).json({ error: "Connection not found" }); return; }

  if (isFileEngine(conn.dbEngine)) {
    // File/cloud engines: just mark as tested (no live connectivity check here)
    await db.update(dbConnectionsTable).set({ lastTestedAt: new Date(), lastTestSuccess: true, updatedAt: new Date() }).where(eq(dbConnectionsTable.id, id));
    res.json({ success: true, message: "File/cloud connection saved (live connectivity check not available)" });
    return;
  }

  loadEncryptionKey();
  let username: string;
  let password: string;
  try {
    username = decrypt(conn.usernameEnc ?? "");
    password = decrypt(conn.passwordEnc ?? "");
  } catch {
    res.status(500).json({ success: false, error: "Failed to decrypt credentials" });
    return;
  }

  const testPool = new Pool({
    host: conn.host ?? undefined,
    port: conn.port ?? undefined,
    database: conn.dbName ?? undefined,
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
    details: `Tested connection: ${conn.name} — ${success ? "SUCCESS" : `FAILED: ${error}`}`,
    resourceType: "db_connection",
    resourceId: String(id),
    ipAddress: getIp(req),
  });

  if (success) {
    res.json({ success: true, message: "Connection successful" });
  } else {
    res.status(400).json({ success: false, error });
  }
});

// GET /api/admin/db-connections/:id/runs — last 50 data jobs for this connection
router.get("/admin/db-connections/:id/runs", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [conn] = await db.select({ id: dbConnectionsTable.id }).from(dbConnectionsTable).where(eq(dbConnectionsTable.id, id));
  if (!conn) { res.status(404).json({ error: "Connection not found" }); return; }

  const runs = await db
    .select()
    .from(dataJobsTable)
    .where(eq(dataJobsTable.connectionId, id))
    .orderBy(desc(dataJobsTable.createdAt))
    .limit(50);

  res.json(runs);
});

export default router;
