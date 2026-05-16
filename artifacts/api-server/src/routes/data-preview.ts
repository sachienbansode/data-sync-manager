import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import pg from "pg";
import { db, connectionObjectsTable, dbConnectionsTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";
import { decrypt, loadEncryptionKey } from "../lib/crypto";

const { Pool } = pg;
const router: IRouter = Router();

function buildPreviewQuery(objectType: string, objectValue: string, engine: string, limit = 50): string {
  if (engine === "mssql" || engine === "sqlserver") {
    return objectType === "table"
      ? `SELECT TOP ${limit} * FROM ${objectValue}`
      : `SELECT TOP ${limit} * FROM (${objectValue}) AS _pv`;
  }
  if (engine === "oracle" || engine === "oracledb") {
    return objectType === "table"
      ? `SELECT * FROM ${objectValue} WHERE ROWNUM <= ${limit}`
      : `SELECT * FROM (${objectValue}) WHERE ROWNUM <= ${limit}`;
  }
  return objectType === "table"
    ? `SELECT * FROM ${objectValue} LIMIT ${limit}`
    : `SELECT * FROM (${objectValue}) AS _pv LIMIT ${limit}`;
}

// POST /api/admin/data-preview
router.post("/admin/data-preview", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const { objectId } = req.body as { objectId?: number };
  if (!objectId) { res.status(400).json({ error: "objectId is required" }); return; }

  const [obj] = await db
    .select({
      id: connectionObjectsTable.id,
      name: connectionObjectsTable.name,
      objectType: connectionObjectsTable.objectType,
      objectValue: connectionObjectsTable.objectValue,
      connectionId: connectionObjectsTable.connectionId,
    })
    .from(connectionObjectsTable)
    .where(eq(connectionObjectsTable.id, objectId));

  if (!obj) { res.status(404).json({ error: "Object not found" }); return; }

  const [conn] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, obj.connectionId));
  if (!conn) { res.status(404).json({ error: "Connection not found" }); return; }

  loadEncryptionKey();
  let username: string, password: string;
  try {
    username = decrypt(conn.usernameEnc ?? "");
    password = decrypt(conn.passwordEnc ?? "");
  } catch {
    res.status(500).json({ error: "Failed to decrypt credentials" }); return;
  }

  const engine = conn.dbEngine;
  const query = buildPreviewQuery(obj.objectType, obj.objectValue, engine);

  try {
    if (engine === "postgresql" || engine === "postgres") {
      const useSSL = conn.extraParams?.ssl === "true";
      const pool = new Pool({
        host: conn.host ?? undefined,
        port: conn.port ?? 5432,
        database: conn.dbName ?? undefined,
        user: username,
        password,
        connectionTimeoutMillis: 15000,
        max: 1,
        ...(useSSL ? { ssl: { rejectUnauthorized: false } } : {}),
      });
      try {
        const result = await pool.query(query);
        const columns = result.fields.map(f => f.name);
        res.json({ columns, rows: result.rows, rowCount: result.rows.length });
      } finally {
        await pool.end().catch(() => {});
      }
    } else if (engine === "mysql") {
      const mysql2 = await import("mysql2/promise");
      const mysqlConn = await mysql2.createConnection({
        host: conn.host ?? "localhost",
        port: conn.port ?? 3306,
        database: conn.dbName ?? undefined,
        user: username,
        password,
        connectTimeout: 15000,
      });
      try {
        const [rows, fields] = await mysqlConn.execute(query);
        const columns = (fields as { name: string }[]).map(f => f.name);
        res.json({ columns, rows, rowCount: (rows as unknown[]).length });
      } finally {
        await mysqlConn.end().catch(() => {});
      }
    } else if (engine === "mssql" || engine === "sqlserver") {
      const mssql = await import("mssql");
      const sqlConfig = {
        server: conn.host ?? "localhost",
        port: conn.port ?? 1433,
        database: conn.dbName ?? undefined,
        user: username,
        password,
        options: { trustServerCertificate: true, connectTimeout: 15000 },
      };
      const pool = await mssql.connect(sqlConfig as Parameters<typeof mssql.connect>[0]);
      try {
        const result = await pool.request().query(query);
        const rows = result.recordset as Record<string, unknown>[];
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        res.json({ columns, rows, rowCount: rows.length });
      } finally {
        await pool.close().catch(() => {});
      }
    } else if (engine === "oracle" || engine === "oracledb") {
      const oracledb = await import("oracledb");
      const connection = await oracledb.getConnection({
        user: username,
        password,
        connectString: `${conn.host}:${conn.port ?? 1521}/${conn.dbName ?? "ORCL"}`,
      });
      try {
        const result = await connection.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const columns = (result.metaData ?? []).map((m: { name: string }) => m.name);
        const rows = (result.rows ?? []) as Record<string, unknown>[];
        res.json({ columns, rows, rowCount: rows.length });
      } finally {
        await connection.close().catch(() => {});
      }
    } else {
      res.status(400).json({ error: `Engine "${engine}" is not supported for data preview` });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Preview failed: ${msg}` });
  }
});

export default router;
