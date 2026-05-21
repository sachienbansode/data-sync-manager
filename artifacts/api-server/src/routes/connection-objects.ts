import { Router, type IRouter } from "express";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import pg from "pg";
import { db, connectionObjectsTable, dbConnectionsTable, usersTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";
import { decrypt, loadEncryptionKey } from "../lib/crypto";

const { Pool } = pg;
const router: IRouter = Router();

// GET /api/admin/connection-objects  (optionally ?connectionId=N)
router.get("/admin/connection-objects", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const connectionId = req.query.connectionId ? parseInt(String(req.query.connectionId)) : undefined;

  const rows = await db
    .select({
      id: connectionObjectsTable.id,
      name: connectionObjectsTable.name,
      connectionId: connectionObjectsTable.connectionId,
      connectionName: dbConnectionsTable.name,
      connectionEngine: dbConnectionsTable.dbEngine,
      objectType: connectionObjectsTable.objectType,
      objectValue: connectionObjectsTable.objectValue,
      description: connectionObjectsTable.description,
      createdAt: connectionObjectsTable.createdAt,
      updatedAt: connectionObjectsTable.updatedAt,
      createdByEmail: usersTable.email,
    })
    .from(connectionObjectsTable)
    .innerJoin(dbConnectionsTable, eq(connectionObjectsTable.connectionId, dbConnectionsTable.id))
    .leftJoin(usersTable, eq(connectionObjectsTable.createdBy, usersTable.id))
    .where(connectionId ? eq(connectionObjectsTable.connectionId, connectionId) : undefined)
    .orderBy(desc(connectionObjectsTable.createdAt));

  res.json(rows);
});

// GET /api/admin/connection-objects/:id
router.get("/admin/connection-objects/:id", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id));
  const [row] = await db
    .select({
      id: connectionObjectsTable.id,
      name: connectionObjectsTable.name,
      connectionId: connectionObjectsTable.connectionId,
      connectionName: dbConnectionsTable.name,
      connectionEngine: dbConnectionsTable.dbEngine,
      objectType: connectionObjectsTable.objectType,
      objectValue: connectionObjectsTable.objectValue,
      description: connectionObjectsTable.description,
      createdAt: connectionObjectsTable.createdAt,
      updatedAt: connectionObjectsTable.updatedAt,
    })
    .from(connectionObjectsTable)
    .innerJoin(dbConnectionsTable, eq(connectionObjectsTable.connectionId, dbConnectionsTable.id))
    .where(eq(connectionObjectsTable.id, id));

  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// POST /api/admin/connection-objects
router.post("/admin/connection-objects", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const { name, connectionId, objectType, objectValue, description } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  if (!connectionId) { res.status(400).json({ error: "connectionId is required" }); return; }
  if (!objectValue?.trim()) { res.status(400).json({ error: "objectValue is required" }); return; }

  const userId = (req as unknown as { user?: { id: number } }).user?.id ?? null;
  const [created] = await db
    .insert(connectionObjectsTable)
    .values({
      name: name.trim(),
      connectionId: parseInt(String(connectionId)),
      objectType: objectType ?? "table",
      objectValue: objectValue.trim(),
      description: description?.trim() || null,
      createdBy: userId,
    })
    .returning();
  res.status(201).json(created);
});

// PUT /api/admin/connection-objects/:id
router.put("/admin/connection-objects/:id", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id));
  const { name, connectionId, objectType, objectValue, description } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  if (!objectValue?.trim()) { res.status(400).json({ error: "objectValue is required" }); return; }

  const [updated] = await db
    .update(connectionObjectsTable)
    .set({
      name: name.trim(),
      connectionId: connectionId ? parseInt(String(connectionId)) : undefined,
      objectType: objectType ?? "table",
      objectValue: objectValue.trim(),
      description: description?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(connectionObjectsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// DELETE /api/admin/connection-objects/:id
router.delete("/admin/connection-objects/:id", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id));
  const [deleted] = await db
    .delete(connectionObjectsTable)
    .where(eq(connectionObjectsTable.id, id))
    .returning({ id: connectionObjectsTable.id });

  if (!deleted) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).send();
});

// POST /api/admin/connection-objects/:id/preview — fetch sample rows from the object's source
router.post("/admin/connection-objects/:id/preview", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id));
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "10"))));

  const [obj] = await db
    .select()
    .from(connectionObjectsTable)
    .where(eq(connectionObjectsTable.id, id));
  if (!obj) { res.status(404).json({ error: "Object not found" }); return; }

  const [conn] = await db
    .select()
    .from(dbConnectionsTable)
    .where(eq(dbConnectionsTable.id, obj.connectionId));
  if (!conn) { res.status(404).json({ error: "Connection not found" }); return; }
  if (!["postgresql", "mysql", "mssql", "oracle"].includes(conn.dbEngine)) {
    res.status(400).json({ error: `Preview not supported for ${conn.dbEngine}` });
    return;
  }

  const key = loadEncryptionKey();
  const username = conn.usernameEnc ? decrypt(conn.usernameEnc, key) : "";
  const password = conn.passwordEnc ? decrypt(conn.passwordEnc, key) : "";

  // Oracle — use oracledb thin mode
  if (conn.dbEngine === "oracle") {
    const oracledb = (await import("oracledb")).default;
    const connectString = `${conn.host}:${conn.port ?? 1521}/${conn.dbName ?? "ORCL"}`;
    let oraConn: import("oracledb").Connection | null = null;
    try {
      oraConn = await oracledb.getConnection({ user: username, password, connectString });
      const oraSchema = (conn.schemaName ?? username).toUpperCase();
      const oraTable  = obj.objectValue.toUpperCase();
      const query = obj.objectType === "query"
        ? `SELECT * FROM (${obj.objectValue}) WHERE ROWNUM <= ${limit}`
        : `SELECT * FROM "${oraSchema}"."${oraTable}" FETCH FIRST ${limit} ROWS ONLY`;
      const result = await oraConn.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const columns = (result.metaData ?? []).map((m: { name: string }) => m.name);
      const rows = (result.rows ?? []) as Record<string, unknown>[];
      res.json({ columns, rows, rowCount: rows.length });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Oracle query failed";
      console.error(`[Oracle preview] connId=${conn.id} objId=${obj.id} user=${conn.usernameEnc ? "(set)" : "(empty)"} schema=${conn.schemaName ?? "(null)"} obj=${obj.objectValue} error: ${msg}`);
      res.status(500).json({ error: msg });
    } finally {
      await oraConn?.close().catch(() => {});
    }
    return;
  }

  const buildQuery = () => {
    if (obj.objectType === "query") return `SELECT * FROM (${obj.objectValue}) _obj LIMIT ${limit}`;
    const schema = conn.schemaName ?? "public";
    return `SELECT * FROM ${schema}.${obj.objectValue} LIMIT ${limit}`;
  };

  const pool = new Pool({
    host: conn.host ?? undefined,
    port: conn.port ?? 5432,
    database: conn.dbName ?? undefined,
    user: username || undefined,
    password: password || undefined,
    connectionTimeoutMillis: 8000,
    query_timeout: 10000,
  });

  try {
    const client = await pool.connect();
    try {
      const result = await client.query(buildQuery());
      res.json({ columns: result.fields.map(f => f.name), rows: result.rows, rowCount: result.rowCount });
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Query failed" });
  } finally {
    await pool.end().catch(() => {});
  }
});

// POST /api/admin/connection-objects/:id/test — validate connectivity + query without fetching rows
router.post("/admin/connection-objects/:id/test", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id));

  const [obj] = await db.select().from(connectionObjectsTable).where(eq(connectionObjectsTable.id, id));
  if (!obj) { res.status(404).json({ error: "Object not found" }); return; }

  const [conn] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, obj.connectionId));
  if (!conn) { res.status(404).json({ error: "Connection not found" }); return; }
  if (!["postgresql", "mysql", "mssql"].includes(conn.dbEngine)) {
    res.json({ success: true, message: "Test not available for this engine type" });
    return;
  }

  const key = loadEncryptionKey();
  const username = conn.usernameEnc ? decrypt(conn.usernameEnc, key) : "";
  const password = conn.passwordEnc ? decrypt(conn.passwordEnc, key) : "";

  const query = obj.objectType === "query"
    ? `SELECT * FROM (${obj.objectValue}) _obj LIMIT 0`
    : `SELECT * FROM ${conn.schemaName ?? "public"}.${obj.objectValue} LIMIT 0`;

  const useSSL = (conn.extraParams as Record<string, string> | null)?.ssl === "true";
  const pool = new Pool({
    host: conn.host ?? undefined,
    port: conn.port ?? 5432,
    database: conn.dbName ?? undefined,
    user: username || undefined,
    password: password || undefined,
    connectionTimeoutMillis: 10000,
    ...(useSSL ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  try {
    const client = await pool.connect();
    try {
      const result = await client.query(query);
      const columns = result.fields.map((f: { name: string }) => f.name);
      res.json({ success: true, columns, columnCount: columns.length });
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    res.status(400).json({ success: false, error: err instanceof Error ? err.message : "Test failed" });
  } finally {
    await pool.end().catch(() => {});
  }
});

// GET /api/admin/connection-objects/by-connection/:connectionId — helper for pipeline form
router.get("/admin/connection-objects/by-connection/:connectionId", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const connectionId = parseInt(String(req.params.connectionId));
  const rows = await db
    .select()
    .from(connectionObjectsTable)
    .where(eq(connectionObjectsTable.connectionId, connectionId))
    .orderBy(asc(connectionObjectsTable.name));
  res.json(rows);
});

export default router;
