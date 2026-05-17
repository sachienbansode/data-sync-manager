import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import pg from "pg";
import { db, dbConnectionsTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";
import { decrypt, loadEncryptionKey } from "../lib/crypto";

const { Pool } = pg;
const router: IRouter = Router();

const MAX_ROWS = 50;

// ── PII column detection by name pattern ─────────────────────────────────────
interface PiiPattern { re: RegExp; type: string; }
const PII_PATTERNS: PiiPattern[] = [
  { re: /\b(phone|mobile|mob|cell|contact_no|phone_no|phone_number|mob_no|telephone)\b/i, type: "phone" },
  { re: /\b(email|email_id|email_address|counterparty_email|mail)\b/i,                   type: "email" },
  { re: /\b(pan|pan_no|pan_number|pan_card)\b/i,                                         type: "pan" },
  { re: /\b(bank_account|account_no|account_number|acc_no|acct_no|bank_acc|ifsc)\b/i,    type: "bank_account" },
  { re: /\b(national_id|aadhar|aadhaar|aadhar_no|aadhaar_no|ssn|nid|voter_id)\b/i,      type: "national_id" },
  { re: /\b(address|addr|street|residence|city_addr)\b/i,                                type: "address" },
];

function detectPiiType(colName: string): string | null {
  for (const { re, type } of PII_PATTERNS) {
    if (re.test(colName)) return type;
  }
  return null;
}

function maskValue(raw: string, piiType: string): string {
  if (!raw) return raw;
  switch (piiType) {
    case "phone":
      return raw.slice(0, 3) + "•".repeat(Math.max(0, raw.length - 3));
    case "email": {
      const at = raw.indexOf("@");
      if (at < 0) return raw.slice(0, 2) + "•".repeat(Math.max(0, raw.length - 2));
      const local = raw.slice(0, at);
      const domain = raw.slice(at + 1);
      return (local.slice(0, 2) + "••••") + "@" + domain;
    }
    case "pan":
    case "bank_account":
    case "national_id":
      return "••••" + raw.slice(-4);
    case "address":
      return raw.length <= 8 ? "•".repeat(raw.length) : raw.slice(0, 6) + "•••";
    default:
      if (raw.length <= 4) return "•".repeat(raw.length);
      return raw.slice(0, 2) + "•".repeat(raw.length - 4) + raw.slice(-2);
  }
}

function applyMasking(
  rows: Record<string, unknown>[],
  piiMap: Record<string, string>,
): Record<string, unknown>[] {
  if (Object.keys(piiMap).length === 0) return rows;
  return rows.map(row => {
    const masked: Record<string, unknown> = { ...row };
    for (const [col, piiType] of Object.entries(piiMap)) {
      const val = row[col];
      if (val !== null && val !== undefined) {
        masked[col] = maskValue(String(val), piiType);
      }
    }
    return masked;
  });
}

// Wrap user query to enforce row limit per engine
function limitQuery(userQuery: string, engine: string, limit: number): string {
  const q = userQuery.trim().replace(/;+$/, "");
  if (engine === "mssql" || engine === "sqlserver") {
    return `SELECT TOP ${limit} * FROM (${q}) AS _dp`;
  }
  if (engine === "oracle" || engine === "oracledb") {
    return `SELECT * FROM (${q}) WHERE ROWNUM <= ${limit}`;
  }
  return `SELECT * FROM (${q}) AS _dp LIMIT ${limit}`;
}

// POST /api/admin/data-preview
router.post("/admin/data-preview", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const { connectionId, query } = req.body as { connectionId?: number; query?: string };
  if (!connectionId) { res.status(400).json({ error: "connectionId is required" }); return; }
  if (!query?.trim()) { res.status(400).json({ error: "query is required" }); return; }

  const [conn] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, connectionId));
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
  const limitedQuery = limitQuery(query.trim(), engine, MAX_ROWS);

  try {
    let columns: string[] = [];
    let rows: Record<string, unknown>[] = [];

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
        const result = await pool.query(limitedQuery);
        columns = result.fields.map(f => f.name);
        rows = result.rows;
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
        const [mysqlRows, fields] = await mysqlConn.execute(limitedQuery);
        columns = (fields as { name: string }[]).map(f => f.name);
        rows = mysqlRows as Record<string, unknown>[];
      } finally {
        await mysqlConn.end().catch(() => {});
      }

    } else if (engine === "mssql" || engine === "sqlserver") {
      const mssql = await import("mssql");
      const pool = await mssql.connect({
        server: conn.host ?? "localhost",
        port: conn.port ?? 1433,
        database: conn.dbName ?? undefined,
        user: username,
        password,
        options: { trustServerCertificate: true, connectTimeout: 15000 },
      } as Parameters<typeof mssql.connect>[0]);
      try {
        const result = await pool.request().query(limitedQuery);
        rows = result.recordset as Record<string, unknown>[];
        columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
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
        const result = await connection.execute(limitedQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        columns = (result.metaData ?? []).map((m: { name: string }) => m.name);
        rows = (result.rows ?? []) as Record<string, unknown>[];
      } finally {
        await connection.close().catch(() => {});
      }

    } else {
      res.status(400).json({ error: `Engine "${engine}" is not supported for data preview` }); return;
    }

    // Detect PII columns and apply partial masking
    const piiMap: Record<string, string> = {};
    for (const col of columns) {
      const t = detectPiiType(col);
      if (t) piiMap[col] = t;
    }
    const maskedRows = applyMasking(rows, piiMap);

    res.json({
      columns,
      rows: maskedRows,
      rowCount: maskedRows.length,
      piiColumns: Object.keys(piiMap),
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Preview failed: ${msg}` });
  }
});

export default router;
