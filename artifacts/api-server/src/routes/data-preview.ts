import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import pg from "pg";
import { db, dbConnectionsTable, appSettingsTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";
import { decrypt, loadEncryptionKey } from "../lib/crypto";

const { Pool } = pg;
const router: IRouter = Router();

const MAX_ROWS = 50;

// ── PII column detection by name pattern ─────────────────────────────────────
interface PiiPattern { re: RegExp; type: string; }
const PII_PATTERNS: PiiPattern[] = [
  { re: /\b(phone|mobile|mob|cell|contact_no|phone_no|phone_number|mob_no|telephone|contact)\b/i, type: "phone" },
  { re: /\b(email|email_id|email_address|counterparty_email|mail)\b/i,                            type: "email" },
  { re: /\b(pan|pan_no|pan_number|pan_card)\b/i,                                                  type: "pan" },
  { re: /\b(bank_account|account_no|account_number|acc_no|acct_no|bank_acc|ifsc)\b/i,             type: "bank_account" },
  { re: /\b(national_id|aadhar|aadhaar|aadhar_no|aadhaar_no|ssn|nid|voter_id)\b/i,               type: "national_id" },
  { re: /\b(address|addr|street|residence|city_addr)\b/i,                                         type: "address" },
  { re: /\b(name|full_name|first_name|last_name|fname|lname|customer_name|client_name)\b/i,       type: "name" },
  { re: /\b(dob|date_of_birth|birth_date|birthdate)\b/i,                                          type: "dob" },
];

function detectPiiType(colName: string): string | null {
  for (const { re, type } of PII_PATTERNS) {
    if (re.test(colName)) return type;
  }
  return null;
}

/**
 * Indian-standard PII masking — fixed-length 'X' mask, 30-40 % visible.
 */
function maskValue(raw: string, piiType: string): string {
  if (!raw || !raw.trim()) return raw;
  const s = raw.trim();
  const n = s.length;

  switch (piiType) {
    case "name": {
      if (n <= 4)  return s.slice(0, 1) + "XXXX" + s.slice(-1);
      if (n <= 7)  return s.slice(0, 2) + "XXXX" + s.slice(-1);
      return s.slice(0, 3) + "XXXX" + s.slice(-2);
    }
    case "email": {
      const at = s.indexOf("@");
      if (at < 0) return s.slice(0, 2) + "XXXX" + s.slice(-1);
      const local  = s.slice(0, at);
      const domain = s.slice(at + 1);
      const visible = Math.min(3, Math.max(1, Math.floor(local.length * 0.4)));
      return local.slice(0, visible) + "XXXX@" + domain;
    }
    case "phone": {
      const digits = s.replace(/\D/g, "");
      if (digits.length >= 10) return digits.slice(0, 3) + "XXXX" + digits.slice(-2);
      return s.slice(0, 2) + "XXXX" + s.slice(-1);
    }
    case "pan":
      if (n === 10) return s.slice(0, 5) + "XXXX" + s.slice(-1);
      return s.slice(0, 3) + "XXXX" + s.slice(-1);
    case "national_id": {
      const digits = s.replace(/\D/g, "");
      if (digits.length === 12) return "XXXX XXXX " + digits.slice(-4);
      if (digits.length >= 4)   return "XXXX" + digits.slice(-4);
      return "XXXX" + s.slice(-2);
    }
    case "bank_account":
      if (n >= 8) return s.slice(0, 2) + "XXXX" + s.slice(-4);
      return s.slice(0, 1) + "XXXX" + s.slice(-2);
    case "address":
      if (n <= 8) return s.slice(0, 3) + "XXXX";
      return s.slice(0, 6) + "XXXX";
    case "dob": {
      // ISO format: YYYY-MM-DD  (PostgreSQL default)
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 4) + "-XX-XX";
      // DD/MM/YYYY or DD-MM-YYYY
      if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}/.test(s)) {
        const sep = s[2];
        return `XX${sep}XX${sep}` + s.slice(-4);
      }
      // fallback: mask all but last 4 chars (year)
      return "XX-XX-" + s.slice(-4);
    }
    default: {
      const head = Math.max(2, Math.floor(n * 0.30));
      const tail = Math.max(1, Math.floor(n * 0.15));
      if (n <= 4) return s.slice(0, 1) + "XXXX";
      return s.slice(0, head) + "XXXX" + s.slice(-tail);
    }
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

function limitQuery(userQuery: string, engine: string, limit: number): string {
  const q = userQuery.trim().replace(/;+$/, "");
  if (engine === "mssql" || engine === "sqlserver") return `SELECT TOP ${limit} * FROM (${q}) AS _dp`;
  if (engine === "oracle" || engine === "oracledb") return `SELECT * FROM (${q}) WHERE ROWNUM <= ${limit}`;
  return `SELECT * FROM (${q}) AS _dp LIMIT ${limit}`;
}

function countQuery(userQuery: string, engine: string): string {
  const q = userQuery.trim().replace(/;+$/, "");
  if (engine === "oracle" || engine === "oracledb") return `SELECT COUNT(*) AS total FROM (${q})`;
  return `SELECT COUNT(*) AS total FROM (${q}) AS _cnt`;
}

// POST /api/admin/data-preview
router.post("/admin/data-preview", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const { connectionId, query } = req.body as { connectionId?: number; query?: string };
  if (!connectionId) { res.status(400).json({ error: "connectionId is required" }); return; }
  if (!query?.trim()) { res.status(400).json({ error: "query is required" }); return; }

  const [conn] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, connectionId));
  if (!conn) { res.status(404).json({ error: "Connection not found" }); return; }

  const [appCfg] = await db.select().from(appSettingsTable).limit(1);
  const piiMaskingEnabled = appCfg?.piiPreviewEnabled ?? true;

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
  const cntQuery     = countQuery(query.trim(), engine);

  try {
    let columns: string[] = [];
    let rows: Record<string, unknown>[] = [];
    let totalCount: number | null = null;

    if (engine === "postgresql" || engine === "postgres") {
      const useSSL = conn.extraParams?.ssl === "true";
      const pool = new Pool({
        host: conn.host ?? undefined, port: conn.port ?? 5432,
        database: conn.dbName ?? undefined, user: username, password,
        connectionTimeoutMillis: 15000, max: 1,
        ...(useSSL ? { ssl: { rejectUnauthorized: false } } : {}),
      });
      try {
        const [cntResult, dataResult] = await Promise.all([
          pool.query(cntQuery).catch(() => null),
          pool.query(limitedQuery),
        ]);
        columns = dataResult.fields.map(f => f.name);
        rows = dataResult.rows;
        totalCount = cntResult ? parseInt(String(cntResult.rows[0]?.total ?? "0"), 10) : null;
      } finally {
        await pool.end().catch(() => {});
      }

    } else if (engine === "mysql") {
      const mysql2 = await import("mysql2/promise");
      const mysqlConn = await mysql2.createConnection({
        host: conn.host ?? "localhost", port: conn.port ?? 3306,
        database: conn.dbName ?? undefined, user: username, password,
        connectTimeout: 15000,
      });
      try {
        const [[cntRows], [dataRows, fields]] = await Promise.all([
          mysqlConn.execute(cntQuery).catch(() => [[]] as unknown as [unknown[], unknown]),
          mysqlConn.execute(limitedQuery),
        ]);
        columns = (fields as { name: string }[]).map(f => f.name);
        rows = dataRows as Record<string, unknown>[];
        const cnt = (cntRows as Record<string, unknown>[])[0];
        totalCount = cnt ? parseInt(String(cnt.total ?? "0"), 10) : null;
      } finally {
        await mysqlConn.end().catch(() => {});
      }

    } else if (engine === "mssql" || engine === "sqlserver") {
      const mssql = await import("mssql");
      const pool = await mssql.connect({
        server: conn.host ?? "localhost", port: conn.port ?? 1433,
        database: conn.dbName ?? undefined, user: username, password,
        options: { trustServerCertificate: true, connectTimeout: 15000 },
      } as Parameters<typeof mssql.connect>[0]);
      try {
        const [cntResult, dataResult] = await Promise.all([
          pool.request().query(cntQuery).catch(() => null),
          pool.request().query(limitedQuery),
        ]);
        rows = dataResult.recordset as Record<string, unknown>[];
        columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
        totalCount = cntResult ? parseInt(String(cntResult.recordset[0]?.total ?? "0"), 10) : null;
      } finally {
        await pool.close().catch(() => {});
      }

    } else if (engine === "oracle" || engine === "oracledb") {
      const oracledb = (await import("oracledb")).default;
      const connection = await oracledb.getConnection({
        user: username, password,
        connectString: `${conn.host}:${conn.port ?? 1521}/${conn.dbName ?? "ORCL"}`,
      });
      try {
        const [cntResult, dataResult] = await Promise.all([
          connection.execute(cntQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }).catch(() => null),
          connection.execute(limitedQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT }),
        ]);
        columns = (dataResult.metaData ?? []).map((m: { name: string }) => m.name);
        rows    = (dataResult.rows ?? []) as Record<string, unknown>[];
        if (cntResult?.rows) {
          const r = (cntResult.rows as Record<string, unknown>[])[0];
          totalCount = r ? parseInt(String(r.TOTAL ?? r.total ?? "0"), 10) : null;
        }
      } finally {
        await connection.close().catch(() => {});
      }

    } else {
      res.status(400).json({ error: `Engine "${engine}" is not supported for data preview` }); return;
    }

    const piiMap: Record<string, string> = {};
    for (const col of columns) {
      const t = detectPiiType(col);
      if (t) piiMap[col] = t;
    }
    const finalRows = piiMaskingEnabled ? applyMasking(rows, piiMap) : rows;

    res.json({
      columns,
      rows: finalRows,
      rowCount: finalRows.length,
      totalCount,
      piiColumns: Object.keys(piiMap),
      piiMaskingEnabled,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Preview failed: ${msg}` });
  }
});

export default router;
