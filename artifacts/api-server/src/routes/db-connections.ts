import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import pg from "pg";
import net from "net";
import { db, dbConnectionsTable, auditLogsTable, dataJobsTable, awsRegionsTable } from "@workspace/db";
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

  const useSSL = conn.extraParams?.ssl === "true";
  const pool = new Pool({
    host: conn.host ?? undefined,
    port: conn.port ?? 5432,
    database: conn.dbName ?? undefined,
    user: username,
    password,
    connectionTimeoutMillis: 12000,
    max: 1,
    ...(useSSL ? { ssl: { rejectUnauthorized: false } } : {}),
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

// GET /api/admin/aws-regions
router.get("/admin/aws-regions", authenticate, async (_req, res) => {
  const rows = await db.select().from(awsRegionsTable).orderBy(awsRegionsTable.sortOrder, awsRegionsTable.code);
  res.json(rows);
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
  const engine = dbEngine ?? "postgresql";
  if (!isFileEngine(engine) && (!host || !dbName || !username || !password)) {
    res.status(400).json({ error: "host, dbName, username, and password are required for database connections" });
    return;
  }
  if (isFileEngine(engine) && engine === "s3" && !extraParams?.bucket) {
    res.status(400).json({ error: "bucket is required for S3 connections" });
    return;
  }

  try { loadEncryptionKey(); } catch (e) {
    res.status(503).json({ error: "Encryption key not configured. Set PII_ENCRYPTION_KEY in Secrets and restart." });
    return;
  }
  const [row] = await db.insert(dbConnectionsTable).values({
    name,
    type,
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

  try { loadEncryptionKey(); } catch (e) {
    res.status(503).json({ error: "Encryption key not configured. Set PII_ENCRYPTION_KEY in Secrets and restart." });
    return;
  }
  const updates: Partial<typeof dbConnectionsTable.$inferInsert> = { updatedAt: new Date() };
  if (name) updates.name = name;
  if (type) updates.type = type;
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

interface TestStep {
  name: string;
  status: "success" | "fail" | "info" | "skip";
  detail: string;
}

// POST /api/admin/db-connections/:id/test — verify connectivity
router.post("/admin/db-connections/:id/test", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [conn] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, id));
  if (!conn) { res.status(404).json({ error: "Connection not found" }); return; }

  // S3: use AWS SDK for a real connectivity check
  if (conn.dbEngine === "s3") {
    const steps: TestStep[] = [];
    const bucket = conn.extraParams?.bucket ?? "";
    if (!bucket || !conn.usernameEnc || !conn.passwordEnc) {
      res.status(400).json({ success: false, error: "Bucket, Access Key ID and Secret Access Key are required to test an S3 connection", steps });
      return;
    }
    loadEncryptionKey();
    let accessKeyId: string;
    let secretAccessKey: string;
    try {
      accessKeyId = decrypt(conn.usernameEnc);
      secretAccessKey = decrypt(conn.passwordEnc);
    } catch {
      res.status(500).json({ success: false, error: "Failed to decrypt S3 credentials", steps });
      return;
    }
    const { S3Client, ListObjectsV2Command } = await import("@aws-sdk/client-s3");

    function makeS3Client(region: string, endpoint?: string) {
      return new S3Client({
        region,
        credentials: { accessKeyId, secretAccessKey },
        ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      });
    }

    const savedRegion = conn.extraParams?.region || "us-east-1";
    const savedEndpoint = conn.extraParams?.endpoint;
    const s3 = makeS3Client(savedRegion, savedEndpoint);

    steps.push({ name: "Credentials Decrypted", status: "success", detail: "Access Key ID and Secret Access Key loaded successfully" });

    let s3Success = false;
    let s3Error: string | null = null;
    let correctedEndpoint: string | null = null;

    try {
      await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
      s3Success = true;
      steps.push({ name: "S3 Bucket Access", status: "success", detail: `Bucket "${bucket}" in region "${savedRegion}" is accessible` });
    } catch (err: unknown) {
      const errAny = err as Record<string, unknown>;
      const isPermanentRedirect =
        errAny?.name === "PermanentRedirect" ||
        errAny?.Code === "PermanentRedirect" ||
        (typeof errAny?.message === "string" && errAny.message.includes("addressed using the specified endpoint"));

      if (isPermanentRedirect && !savedEndpoint) {
        const redirectEndpoint = errAny?.Endpoint as string | undefined;
        if (redirectEndpoint) {
          correctedEndpoint = `https://${redirectEndpoint}`;
          steps.push({ name: "Region Redirect", status: "info", detail: `Bucket is in a different region — retrying with corrected endpoint: ${correctedEndpoint}` });
          const s3Retry = makeS3Client(savedRegion, correctedEndpoint);
          try {
            await s3Retry.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }));
            s3Success = true;
            steps.push({ name: "S3 Bucket Access", status: "success", detail: `Bucket "${bucket}" accessible via corrected endpoint (saved automatically)` });
            const newParams = { ...(conn.extraParams ?? {}), endpoint: correctedEndpoint };
            await db.update(dbConnectionsTable).set({ extraParams: newParams, updatedAt: new Date() }).where(eq(dbConnectionsTable.id, id));
          } catch (retryErr: unknown) {
            s3Error = retryErr instanceof Error ? retryErr.message : "S3 retry failed";
            steps.push({ name: "S3 Bucket Access", status: "fail", detail: s3Error });
          }
        } else {
          s3Error = `${errAny?.message ?? "S3 connection failed"} — the bucket is in a different AWS region than configured. Update the Region field to match your bucket's region (e.g. ap-south-1, eu-west-1).`;
          steps.push({ name: "S3 Bucket Access", status: "fail", detail: s3Error });
        }
      } else {
        s3Error = err instanceof Error ? err.message : "S3 connection failed";
        steps.push({ name: "S3 Bucket Access", status: "fail", detail: s3Error });
      }
    }
    await db.update(dbConnectionsTable).set({ lastTestedAt: new Date(), lastTestSuccess: s3Success, updatedAt: new Date() }).where(eq(dbConnectionsTable.id, id));
    await db.insert(auditLogsTable).values({
      userId: req.user!.sub, userEmail: req.user!.email,
      action: "DB_CONNECTION_TESTED",
      details: `Tested S3 connection: ${conn.name} — ${s3Success ? "SUCCESS" : `FAILED: ${s3Error}`}`,
      resourceType: "db_connection", resourceId: String(id), ipAddress: getIp(req),
    });
    if (s3Success) {
      const note = correctedEndpoint ? ` (auto-corrected endpoint saved: ${correctedEndpoint})` : "";
      res.json({ success: true, message: `S3 bucket "${bucket}" is accessible${note}`, steps });
    } else {
      res.status(400).json({ success: false, error: s3Error, steps });
    }
    return;
  }

  // SFTP / CSV: no live connectivity check available
  if (isFileEngine(conn.dbEngine)) {
    await db.update(dbConnectionsTable).set({ lastTestedAt: new Date(), lastTestSuccess: true, updatedAt: new Date() }).where(eq(dbConnectionsTable.id, id));
    const steps: TestStep[] = [
      { name: "Connection Saved", status: "success", detail: "Connection details stored successfully" },
      { name: "Live Connectivity", status: "skip", detail: "Live connectivity check is not available for SFTP/CSV connections" },
    ];
    res.json({ success: true, message: "Connection saved (live connectivity check not available for this engine type)", steps });
    return;
  }

  loadEncryptionKey();
  let username: string;
  let password: string;
  try {
    username = decrypt(conn.usernameEnc ?? "");
    password = decrypt(conn.passwordEnc ?? "");
  } catch {
    res.status(500).json({ success: false, error: "Failed to decrypt credentials", steps: [] });
    return;
  }

  const host = conn.host ?? "";
  const port = conn.port ?? 5432;
  const savedSSL = conn.extraParams?.ssl === "true";
  const steps: TestStep[] = [];

  steps.push({ name: "Credentials Decrypted", status: "success", detail: `Credentials for user "${username}" loaded successfully` });

  // Step 1: raw TCP check
  const tcpReachable = await new Promise<boolean>(resolve => {
    const socket = new net.Socket();
    const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(6000);
    socket.once("connect", () => done(true));
    socket.once("error",   () => done(false));
    socket.once("timeout", () => done(false));
    socket.connect(port, host);
  });

  if (!tcpReachable) {
    const detail = `Cannot reach ${host}:${port} — the host is unreachable or the port is blocked. Check your firewall / security group rules allow inbound TCP on port ${port}.`;
    steps.push({ name: "TCP Connectivity", status: "fail", detail });
    await db.update(dbConnectionsTable).set({ lastTestedAt: new Date(), lastTestSuccess: false, updatedAt: new Date() }).where(eq(dbConnectionsTable.id, id));
    await db.insert(auditLogsTable).values({
      userId: req.user!.sub, userEmail: req.user!.email,
      action: "DB_CONNECTION_TESTED",
      details: `Tested connection: ${conn.name} — FAILED (TCP unreachable)`,
      resourceType: "db_connection", resourceId: String(id), ipAddress: getIp(req),
    });
    res.status(400).json({ success: false, error: detail, steps });
    return;
  }

  steps.push({ name: "TCP Connectivity", status: "success", detail: `Port ${port} on ${host} is reachable` });

  // Oracle: use oracledb thin mode (no Instant Client needed)
  if (conn.dbEngine === "oracle") {
    let oracleSuccess = false;
    let oracleError: string | null = null;
    try {
      const oracledb = (await import("oracledb")).default;
      // Thin mode works without Oracle Instant Client
      oracledb.initOracleClient = () => {}; // no-op guard — keep thin
      const connectString = `${host}:${port}/${conn.dbName ?? ""}`;
      const connection = await oracledb.getConnection({
        user: username,
        password,
        connectString,
        privilege: 0,
      });
      try {
        await connection.execute("SELECT 1 FROM DUAL");
        oracleSuccess = true;
        steps.push({ name: "Authentication", status: "success", detail: `Connected as "${username}" to ${connectString}` });
        steps.push({ name: "Query Test", status: "success", detail: "SELECT 1 FROM DUAL executed successfully — Oracle DB is responding" });
      } finally {
        await connection.close().catch(() => {});
      }
    } catch (e: unknown) {
      oracleError = e instanceof Error ? e.message : "Oracle connection failed";
      const isAuth = /ORA-01017|invalid username|password/i.test(oracleError);
      const isSvc  = /ORA-12514|ORA-12505|service.*not.*found|listener.*does not/i.test(oracleError);
      if (isAuth) {
        steps.push({ name: "Authentication", status: "fail", detail: `${oracleError} — check the username and password are correct.` });
      } else if (isSvc) {
        steps.push({ name: "Authentication", status: "fail", detail: `${oracleError} — check the Database Name field matches the Oracle service name or SID.` });
      } else {
        steps.push({ name: "Authentication", status: "fail", detail: oracleError });
      }
      steps.push({ name: "Query Test", status: "skip", detail: "Skipped — connection failed" });
    }
    await db.update(dbConnectionsTable).set({ lastTestedAt: new Date(), lastTestSuccess: oracleSuccess, updatedAt: new Date() }).where(eq(dbConnectionsTable.id, id));
    await db.insert(auditLogsTable).values({
      userId: req.user!.sub, userEmail: req.user!.email,
      action: "DB_CONNECTION_TESTED",
      details: `Tested Oracle connection: ${conn.name} — ${oracleSuccess ? "SUCCESS" : `FAILED: ${oracleError}`}`,
      resourceType: "db_connection", resourceId: String(id), ipAddress: getIp(req),
    });
    if (oracleSuccess) {
      res.json({ success: true, message: "Oracle connection successful", steps });
    } else {
      res.status(400).json({ success: false, error: oracleError, steps });
    }
    return;
  }

  // Step 2: DB protocol — try plain then SSL (or SSL then plain)
  async function tryConnect(withSSL: boolean): Promise<{ ok: boolean; err: string | null }> {
    const p = new Pool({
      host,
      port,
      database: conn.dbName ?? undefined,
      user: username,
      password,
      connectionTimeoutMillis: 10000,
      max: 1,
      ...(withSSL ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    try {
      await p.query("SELECT 1");
      return { ok: true, err: null };
    } catch (e: unknown) {
      return { ok: false, err: e instanceof Error ? e.message : "Unknown error" };
    } finally {
      await p.end().catch(() => {});
    }
  }

  let result = await tryConnect(savedSSL);
  let autoFixedSSL = false;

  if (!result.ok) {
    const retry = await tryConnect(!savedSSL);
    if (retry.ok) {
      const newParams = { ...(conn.extraParams ?? {}), ssl: String(!savedSSL) };
      await db.update(dbConnectionsTable).set({ extraParams: newParams, updatedAt: new Date() }).where(eq(dbConnectionsTable.id, id));
      result = retry;
      autoFixedSSL = true;
      steps.push({ name: "SSL Auto-Detect", status: "info", detail: `SSL mode switched to ${!savedSSL} and saved automatically` });
    }
  }

  const success = result.ok;
  let error: string | null = null;

  if (success) {
    const sslNote = autoFixedSSL ? ` (SSL=${!savedSSL}, auto-detected)` : savedSSL ? " (SSL enabled)" : " (SSL disabled)";
    steps.push({ name: "Authentication", status: "success", detail: `Connected as "${username}" to database "${conn.dbName}"${sslNote}` });
    steps.push({ name: "Query Test", status: "success", detail: "SELECT 1 executed successfully — database is responding" });
  } else {
    const raw = result.err ?? "Connection failed";
    const isAuth = /password|authentication|role.*does not exist|pg_hba/i.test(raw);
    const isSSL  = /ssl|tls|certificate/i.test(raw);
    if (isAuth) {
      error = `${raw} — check the username and password are correct.`;
      steps.push({ name: "Authentication", status: "fail", detail: error });
    } else if (isSSL) {
      error = `${raw} — try toggling the SSL/TLS option on this connection.`;
      steps.push({ name: "Authentication", status: "fail", detail: error });
    } else {
      error = raw;
      steps.push({ name: "Authentication", status: "fail", detail: error });
    }
    steps.push({ name: "Query Test", status: "skip", detail: "Skipped — authentication failed" });
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
    res.json({ success: true, message: "Connection successful", steps });
  } else {
    res.status(400).json({ success: false, error, steps });
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
