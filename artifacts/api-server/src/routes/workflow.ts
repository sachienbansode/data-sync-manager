import { Router, type IRouter } from "express";
import { eq, desc, and, sql, or, like, gte, lte } from "drizzle-orm";
import fs from "fs";
import path from "path";
import pg from "pg";
import multer from "multer";
import { parse as csvParse } from "csv-parse";
import { Readable } from "stream";
import {
  db,
  dbConnectionsTable,
  dataJobsTable,
  dataStagingTable,
  fieldMappingsTable,
  auditLogsTable,
} from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";
import { decrypt, loadEncryptionKey } from "../lib/crypto";

const { Pool } = pg;
const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── Role helpers ────────────────────────────────────────────────────────────
function canFetch(roleName: string) {
  return ["Admin", "Manager", "Analyst"].includes(roleName);
}
function canPush(roleName: string) {
  return ["Admin", "Manager"].includes(roleName);
}

// ── SELECT-only query validation ────────────────────────────────────────────
const DML_PATTERN = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|EXECUTE|EXEC|CALL|MERGE)\b/i;

function validateSelectQuery(query: string): string | null {
  const q = query.trim();
  if (!q) return "Query cannot be empty";
  if (!/^SELECT\b/i.test(q)) return "Query must start with SELECT";
  if (q.includes(";")) return "Query must not contain semicolons (use a single statement)";
  const match = q.match(DML_PATTERN);
  if (match) return `Query must not contain ${match[0].toUpperCase()} statements`;
  return null;
}

// ── Streaming CSV parser (pipe-delimited, RFC 4180 quoted fields) ───────────
async function parsePipeDelimitedCsv(buffer: Buffer): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const rows: Record<string, string>[] = [];
  const parser = Readable.from(buffer).pipe(
    csvParse({ delimiter: "|", columns: true, skip_empty_lines: true, quote: '"', trim: true, relax_quotes: true })
  );
  for await (const record of parser) {
    rows.push(record as Record<string, string>);
  }
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

// ── Transformation engine ──────────────────────────────────────────────────
function applyTransform(value: unknown, type: string, params: string | null): string {
  const str = value == null ? "" : String(value);
  if (type === "number") {
    const n = parseFloat(str.replace(/,/g, ""));
    return isNaN(n) ? str : String(n);
  }
  if (type === "date-format" && params) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      if (params === "DD/MM/YYYY") {
        return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
      }
      if (params === "YYYY-MM-DD") {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
    }
    return str;
  }
  return str;
}

type MappingRow = { backofficeField: string; tradingField: string; transformType: string; transformParams: string | null; sortOrder: number };

async function transformRows(
  jobId: number,
  mappings: MappingRow[]
): Promise<{ tradingField: string; value: string }[][]> {
  if (mappings.length === 0) return [];
  const rows = await db
    .select({ rawData: dataStagingTable.rawData, rowIndex: dataStagingTable.rowIndex })
    .from(dataStagingTable)
    .where(eq(dataStagingTable.jobId, jobId))
    .orderBy(dataStagingTable.rowIndex);

  return rows.map((r) => {
    const raw = r.rawData as Record<string, unknown>;
    return mappings
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => ({
        tradingField: m.tradingField,
        value: applyTransform(raw[m.backofficeField], m.transformType, m.transformParams),
      }));
  });
}

// ── Pipe-delimited CSV serialization with proper RFC 4180 quoting ───────────
// A field is quoted when it contains a pipe, double-quote, CR, or LF.
// Double-quote chars inside quoted fields are escaped by doubling them.
function quotePipeCsvField(value: string): string {
  if (/[|"\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toPipeCsvRow(fields: string[]): string {
  return fields.map(quotePipeCsvField).join("|");
}

function toTradingCsv(rows: { tradingField: string; value: string }[][]): string {
  if (rows.length === 0) return "";
  const headers = toPipeCsvRow(rows[0].map((c) => c.tradingField));
  const dataLines = rows.map((r) => toPipeCsvRow(r.map((c) => c.value)));
  return [headers, ...dataLines].join("\n");
}

// ── GET /api/workflow/connections — BackOffice connections for fetch/push ───
// Accessible to Admin, Manager, Analyst. Returns only public-safe fields
// (no credentials, no outputFilePath) to populate the connection selector UI.
router.get("/workflow/connections", authenticate, async (req, res) => {
  const roleName = req.user!.roleName;
  if (!canFetch(roleName)) {
    res.status(403).json({ error: "Insufficient role to list connections" });
    return;
  }
  const rows = await db
    .select({
      id: dbConnectionsTable.id,
      name: dbConnectionsTable.name,
      type: dbConnectionsTable.type,
      host: dbConnectionsTable.host,
      dbName: dbConnectionsTable.dbName,
      schemaName: dbConnectionsTable.schemaName,
    })
    .from(dbConnectionsTable)
    .where(eq(dbConnectionsTable.type, "backoffice"));
  res.json(rows);
});

// ── GET /api/workflow/field-mappings ────────────────────────────────────────
router.get("/workflow/field-mappings", authenticate, async (_req, res) => {
  const mappings = await db.select().from(fieldMappingsTable).orderBy(fieldMappingsTable.sortOrder, fieldMappingsTable.id);
  res.json(mappings);
});

// ── PUT /api/workflow/field-mappings ────────────────────────────────────────
router.put("/workflow/field-mappings", authenticate, requireRole("Admin"), async (req, res) => {
  const { mappings } = req.body as {
    mappings: Array<{
      backofficeField: string;
      tradingField: string;
      transformType?: string;
      transformParams?: string;
      sortOrder?: number;
    }>;
  };

  if (!Array.isArray(mappings)) {
    res.status(400).json({ error: "mappings must be an array" });
    return;
  }

  await db.delete(fieldMappingsTable);
  if (mappings.length > 0) {
    await db.insert(fieldMappingsTable).values(
      mappings.map((m, i) => ({
        backofficeField: m.backofficeField,
        tradingField: m.tradingField,
        transformType: (m.transformType ?? "string") as "string" | "number" | "date-format",
        transformParams: m.transformParams ?? null,
        sortOrder: m.sortOrder ?? i,
      }))
    );
  }

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "FIELD_MAPPINGS_UPDATED",
    details: `Updated ${mappings.length} field mapping(s)`,
    resourceType: "field_mappings",
    ipAddress: Array.isArray(req.ip) ? (req.ip[0] ?? null) : (req.ip ?? null),
  });

  const updated = await db.select().from(fieldMappingsTable).orderBy(fieldMappingsTable.sortOrder, fieldMappingsTable.id);
  res.json(updated);
});

// ── GET /api/workflow/jobs ──────────────────────────────────────────────────
router.get("/workflow/jobs", authenticate, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, parseInt(req.query.pageSize as string) || 20);

  const statusFilter = req.query.status as string | undefined;
  const typeFilter   = req.query.type as string | undefined;
  const trigger      = req.query.trigger as string | undefined;   // "scheduled" | "manual"
  const search       = req.query.search as string | undefined;
  const dateFrom     = req.query.dateFrom as string | undefined;
  const dateTo       = req.query.dateTo as string | undefined;
  const pipelineId   = req.query.pipelineId ? parseInt(req.query.pipelineId as string) : undefined;

  const conditions = [];
  if (statusFilter)              conditions.push(eq(dataJobsTable.status, statusFilter as typeof dataJobsTable.status._.data));
  if (typeFilter)                conditions.push(eq(dataJobsTable.type, typeFilter as typeof dataJobsTable.type._.data));
  if (trigger === "scheduled")   conditions.push(eq(dataJobsTable.triggeredBySchedule, true));
  if (trigger === "manual")      conditions.push(eq(dataJobsTable.triggeredBySchedule, false));
  if (pipelineId && !isNaN(pipelineId)) conditions.push(eq(dataJobsTable.pipelineId, pipelineId));
  if (dateFrom)                  conditions.push(gte(dataJobsTable.createdAt, new Date(dateFrom)));
  if (dateTo) {
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);
    conditions.push(lte(dataJobsTable.createdAt, to));
  }
  if (search) {
    const q = `%${search}%`;
    conditions.push(or(
      like(dataJobsTable.connectionName, q),
      like(dataJobsTable.triggeredByEmail, q),
    ));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(dataJobsTable).where(where);
  const jobs = await db.select().from(dataJobsTable)
    .where(where)
    .orderBy(desc(dataJobsTable.createdAt))
    .limit(pageSize).offset((page - 1) * pageSize);

  res.json({ jobs, total: count, page, pageSize });
});

// ── GET /api/workflow/jobs/:id ─────────────────────────────────────────────
// Viewer role receives job metadata only (no raw data preview).
// Admin, Manager, Analyst receive full preview rows.
router.get("/workflow/jobs/:id", authenticate, async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [job] = await db.select().from(dataJobsTable).where(eq(dataJobsTable.id, id));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const roleName = req.user!.roleName;
  if (!canFetch(roleName)) {
    // Viewer: history metadata only, no staged row data
    res.json({ job, preview: [] });
    return;
  }

  const previewRows = await db.select().from(dataStagingTable)
    .where(eq(dataStagingTable.jobId, id))
    .orderBy(dataStagingTable.rowIndex)
    .limit(20);

  res.json({ job, preview: previewRows });
});

// ── POST /api/workflow/fetch — Fetch from BackOffice DB ────────────────────
// Allowed roles: Admin, Manager, Analyst
// The query is always a fixed SELECT — no user-supplied SQL accepted.
router.post("/workflow/fetch", authenticate, async (req, res) => {
  const roleName = req.user!.roleName;
  if (!canFetch(roleName)) {
    res.status(403).json({ error: "Insufficient role to fetch data" });
    return;
  }

  const { connectionId } = req.body as { connectionId: number };
  if (!connectionId) { res.status(400).json({ error: "connectionId is required" }); return; }

  const [conn] = await db.select().from(dbConnectionsTable).where(
    and(eq(dbConnectionsTable.id, connectionId), eq(dbConnectionsTable.type, "backoffice"))
  );
  if (!conn) { res.status(404).json({ error: "BackOffice connection not found" }); return; }

  loadEncryptionKey();
  const username = decrypt(conn.usernameEnc ?? "");
  const password = decrypt(conn.passwordEnc ?? "");

  const [job] = await db.insert(dataJobsTable).values({
    type: "fetch",
    status: "running",
    triggeredBy: req.user!.sub,
    triggeredByEmail: req.user!.email,
    triggeredBySchedule: false,
    connectionId: conn.id,
    connectionName: conn.name,
    startedAt: new Date(),
  }).returning();

  const fetchPool = new Pool({
    host: conn.host ?? undefined,
    port: conn.port ?? undefined,
    database: conn.dbName ?? undefined,
    user: username,
    password,
    connectionTimeoutMillis: 10000,
    max: 1,
  });

  try {
    // Use admin-configured query if set; fall back to safe default.
    // Query is validated to be SELECT-only before storage and again at runtime.
    const rawQuery = conn.fetchQuery?.trim() ?? "";
    const defaultQuery = `SELECT * FROM "${conn.schemaName}"."backoffice_data" LIMIT 1000`;
    const selectQuery = rawQuery || defaultQuery;

    // Runtime guard: re-validate even if stored, in case of direct DB edits
    const queryError = validateSelectQuery(selectQuery);
    if (queryError) {
      await db.update(dataJobsTable).set({ status: "failed", errorMessage: queryError, finishedAt: new Date() })
        .where(eq(dataJobsTable.id, job.id));
      res.status(400).json({ error: `Invalid fetch query: ${queryError}`, jobId: job.id });
      await fetchPool.end().catch(() => {});
      return;
    }

    const result = await fetchPool.query(selectQuery);
    const rows = result.rows as Record<string, unknown>[];

    if (rows.length > 0) {
      await db.insert(dataStagingTable).values(
        rows.map((row, i) => ({ jobId: job.id, rowIndex: i, rawData: row }))
      );
    }

    await db.update(dataJobsTable).set({
      status: "success",
      recordCount: rows.length,
      finishedAt: new Date(),
    }).where(eq(dataJobsTable.id, job.id));

    await db.insert(auditLogsTable).values({
      userId: req.user!.sub,
      userEmail: req.user!.email,
      action: "WORKFLOW_FETCH",
      details: `Fetched ${rows.length} rows from ${conn.name}`,
      resourceType: "data_job",
      resourceId: String(job.id),
      ipAddress: Array.isArray(req.ip) ? (req.ip[0] ?? null) : (req.ip ?? null),
    });

    const preview = rows.slice(0, 20);
    res.json({ jobId: job.id, recordCount: rows.length, preview });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Fetch failed";
    await db.update(dataJobsTable).set({
      status: "failed",
      errorMessage: msg,
      finishedAt: new Date(),
    }).where(eq(dataJobsTable.id, job.id));
    res.status(500).json({ error: msg, jobId: job.id });
  } finally {
    await fetchPool.end().catch(() => {});
  }
});

// ── POST /api/workflow/upload-csv — Upload pipe-delimited CSV ──────────────
// Allowed roles: Admin, Manager, Analyst
router.post("/workflow/upload-csv", authenticate, upload.single("file"), async (req, res) => {
  const roleName = req.user!.roleName;
  if (!canFetch(roleName)) {
    res.status(403).json({ error: "Insufficient role to upload data" });
    return;
  }

  const file = req.file;
  if (!file) { res.status(400).json({ error: "CSV file is required" }); return; }

  // Stream-parse the pipe-delimited CSV using csv-parse for full RFC 4180 compliance
  let headers: string[];
  let parsedRows: Record<string, string>[];
  try {
    const parsed = await parsePipeDelimitedCsv(file.buffer);
    headers = parsed.headers;
    parsedRows = parsed.rows;
  } catch (parseErr: unknown) {
    const msg = parseErr instanceof Error ? parseErr.message : "Failed to parse CSV";
    res.status(400).json({ error: `CSV parse error: ${msg}` });
    return;
  }

  if (parsedRows.length === 0) {
    res.status(400).json({ error: "CSV must have a header row and at least one data row" });
    return;
  }
  if (headers.length < 2) {
    res.status(400).json({ error: "CSV must use pipe (|) as delimiter and have at least 2 columns" });
    return;
  }

  // Validate that at least one configured BackOffice field is present
  const configuredMappings = await db.select({ backofficeField: fieldMappingsTable.backofficeField })
    .from(fieldMappingsTable);
  if (configuredMappings.length > 0) {
    const configuredFields = new Set(configuredMappings.map((m) => m.backofficeField));
    const matchedFields = headers.filter((h) => configuredFields.has(h));
    if (matchedFields.length === 0) {
      res.status(400).json({
        error: `CSV headers do not match any configured field mappings. Expected fields: ${[...configuredFields].join(", ")}`,
      });
      return;
    }
  }

  const [job] = await db.insert(dataJobsTable).values({
    type: "upload_csv",
    status: "running",
    triggeredBy: req.user!.sub,
    triggeredByEmail: req.user!.email,
    startedAt: new Date(),
  }).returning();

  await db.insert(dataStagingTable).values(
    parsedRows.map((row, i) => ({ jobId: job.id, rowIndex: i, rawData: row }))
  );

  await db.update(dataJobsTable).set({
    status: "success",
    recordCount: parsedRows.length,
    finishedAt: new Date(),
  }).where(eq(dataJobsTable.id, job.id));

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "WORKFLOW_CSV_UPLOAD",
    details: `Uploaded CSV: ${parsedRows.length} rows, headers: ${headers.join(", ")}`,
    resourceType: "data_job",
    resourceId: String(job.id),
    ipAddress: Array.isArray(req.ip) ? (req.ip[0] ?? null) : (req.ip ?? null),
  });

  res.json({
    jobId: job.id,
    headers,
    recordCount: parsedRows.length,
    preview: parsedRows.slice(0, 20),
  });
});

// ── POST /api/workflow/jobs/:id/download — Download transformed CSV ─────────
// Allowed roles: Admin, Manager, Analyst (Viewer cannot export data)
router.post("/workflow/jobs/:id/download", authenticate, async (req, res) => {
  const roleName = req.user!.roleName;
  if (!canFetch(roleName)) {
    res.status(403).json({ error: "Insufficient role to download data" });
    return;
  }

  const id = parseInt(String(req.params.id));
  const [job] = await db.select().from(dataJobsTable).where(eq(dataJobsTable.id, id));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.status !== "success") { res.status(400).json({ error: "Job has not completed successfully" }); return; }

  const mappings = await db.select().from(fieldMappingsTable).orderBy(fieldMappingsTable.sortOrder, fieldMappingsTable.id);
  let csvContent: string;

  if (mappings.length === 0) {
    const rows = await db.select({ rawData: dataStagingTable.rawData }).from(dataStagingTable)
      .where(eq(dataStagingTable.jobId, id)).orderBy(dataStagingTable.rowIndex);
    if (rows.length === 0) { res.status(404).json({ error: "No data for this job" }); return; }
    const hdrs = Object.keys(rows[0].rawData as Record<string, unknown>);
    const dataLines = rows.map((r) => toPipeCsvRow(hdrs.map((h) => String((r.rawData as Record<string, unknown>)[h] ?? ""))));
    csvContent = [toPipeCsvRow(hdrs), ...dataLines].join("\n");
  } else {
    const transformed = await transformRows(id, mappings);
    csvContent = toTradingCsv(transformed);
  }

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "WORKFLOW_DOWNLOAD",
    details: `Downloaded transformed CSV for job id=${id}`,
    resourceType: "data_job",
    resourceId: String(id),
    ipAddress: Array.isArray(req.ip) ? (req.ip[0] ?? null) : (req.ip ?? null),
  });

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="trading-data-job-${id}.csv"`);
  res.send(csvContent);
});

// ── POST /api/workflow/jobs/:id/push — Push to local file path ─────────────
// Allowed roles: Admin, Manager only.
// Body: { connectionId?: number } — required when the job has no associated
// connection (e.g. CSV upload jobs). The output_file_path of the specified
// connection is used as the push destination.
router.post("/workflow/jobs/:id/push", authenticate, async (req, res) => {
  const roleName = req.user!.roleName;
  if (!canPush(roleName)) {
    res.status(403).json({ error: "Only Admin and Manager roles can push to file path" });
    return;
  }

  const id = parseInt(String(req.params.id));
  const [job] = await db.select().from(dataJobsTable).where(eq(dataJobsTable.id, id));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.status !== "success") { res.status(400).json({ error: "Job has not completed successfully" }); return; }

  // Resolve output path from the job's connection, or from an override connection
  // supplied in the request body (required for upload-csv jobs with no connectionId).
  const bodyConnectionId = (req.body as { connectionId?: number }).connectionId ?? null;
  const resolveConnectionId = job.connectionId ?? bodyConnectionId;

  if (!resolveConnectionId) {
    res.status(400).json({
      error: "This job has no associated connection. Provide a connectionId in the request body to specify the push destination.",
    });
    return;
  }

  const [conn] = await db.select({ outputFilePath: dbConnectionsTable.outputFilePath, name: dbConnectionsTable.name })
    .from(dbConnectionsTable).where(eq(dbConnectionsTable.id, resolveConnectionId));
  const outputPath = conn?.outputFilePath ?? null;

  if (!outputPath) {
    res.status(400).json({ error: "No output file path configured for this connection" });
    return;
  }

  // Create a push job record so push operations appear in job history
  const [pushJob] = await db.insert(dataJobsTable).values({
    type: "push",
    status: "running",
    triggeredBy: req.user!.sub,
    triggeredByEmail: req.user!.email,
    connectionId: resolveConnectionId,
    connectionName: conn.name,
    startedAt: new Date(),
  }).returning();

  const mappings = await db.select().from(fieldMappingsTable).orderBy(fieldMappingsTable.sortOrder, fieldMappingsTable.id);
  let csvContent: string;

  if (mappings.length === 0) {
    const rows = await db.select({ rawData: dataStagingTable.rawData }).from(dataStagingTable)
      .where(eq(dataStagingTable.jobId, id)).orderBy(dataStagingTable.rowIndex);
    if (rows.length === 0) {
      await db.update(dataJobsTable).set({ status: "failed", errorMessage: "No data for this job", finishedAt: new Date() })
        .where(eq(dataJobsTable.id, pushJob.id));
      res.status(404).json({ error: "No data for this job" });
      return;
    }
    const hdrs = Object.keys(rows[0].rawData as Record<string, unknown>);
    const dataLines = rows.map((r) => toPipeCsvRow(hdrs.map((h) => String((r.rawData as Record<string, unknown>)[h] ?? ""))));
    csvContent = [toPipeCsvRow(hdrs), ...dataLines].join("\n");
  } else {
    const transformed = await transformRows(id, mappings);
    csvContent = toTradingCsv(transformed);
  }

  try {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, csvContent, "utf-8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to write file";
    await db.update(dataJobsTable).set({ status: "failed", errorMessage: msg, finishedAt: new Date() })
      .where(eq(dataJobsTable.id, pushJob.id));
    res.status(500).json({ error: `Failed to write to ${outputPath}: ${msg}` });
    return;
  }

  await db.update(dataJobsTable).set({
    status: "success",
    recordCount: csvContent.split("\n").length - 1,
    finishedAt: new Date(),
  }).where(eq(dataJobsTable.id, pushJob.id));

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "WORKFLOW_PUSH",
    details: `Pushed transformed CSV for source job id=${id} to ${outputPath} (push job id=${pushJob.id})`,
    resourceType: "data_job",
    resourceId: String(pushJob.id),
    ipAddress: Array.isArray(req.ip) ? (req.ip[0] ?? null) : (req.ip ?? null),
  });

  res.json({ success: true, path: outputPath, pushJobId: pushJob.id });
});

export default router;
