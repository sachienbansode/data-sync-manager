import { Router, type IRouter } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import pg from "pg";
import multer from "multer";
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

async function transformRows(
  jobId: number,
  mappings: Awaited<ReturnType<typeof db.select>>
): Promise<{ tradingField: string; value: string }[][]> {
  if (mappings.length === 0) return [];
  const rows = await db
    .select({ rawData: dataStagingTable.rawData, rowIndex: dataStagingTable.rowIndex })
    .from(dataStagingTable)
    .where(eq(dataStagingTable.jobId, jobId))
    .orderBy(dataStagingTable.rowIndex);

  return rows.map((r) => {
    const raw = r.rawData as Record<string, unknown>;
    return (mappings as Array<{ backofficeField: string; tradingField: string; transformType: string; transformParams: string | null; sortOrder: number }>)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => ({
        tradingField: m.tradingField,
        value: applyTransform(raw[m.backofficeField], m.transformType, m.transformParams),
      }));
  });
}

function toTradingCsv(rows: { tradingField: string; value: string }[][]): string {
  if (rows.length === 0) return "";
  const headers = rows[0].map((c) => c.tradingField).join("|");
  const dataLines = rows.map((r) => r.map((c) => c.value).join("|"));
  return [headers, ...dataLines].join("\n");
}

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
    ipAddress: req.ip ?? null,
  });

  const updated = await db.select().from(fieldMappingsTable).orderBy(fieldMappingsTable.sortOrder, fieldMappingsTable.id);
  res.json(updated);
});

// ── GET /api/workflow/jobs ──────────────────────────────────────────────────
router.get("/workflow/jobs", authenticate, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, parseInt(req.query.pageSize as string) || 20);

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(dataJobsTable);
  const jobs = await db.select().from(dataJobsTable).orderBy(desc(dataJobsTable.createdAt))
    .limit(pageSize).offset((page - 1) * pageSize);

  res.json({ jobs, total: count, page, pageSize });
});

// ── GET /api/workflow/jobs/:id ─────────────────────────────────────────────
router.get("/workflow/jobs/:id", authenticate, async (req, res) => {
  const id = parseInt(req.params.id);
  const [job] = await db.select().from(dataJobsTable).where(eq(dataJobsTable.id, id));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const previewRows = await db.select().from(dataStagingTable)
    .where(eq(dataStagingTable.jobId, id))
    .orderBy(dataStagingTable.rowIndex)
    .limit(20);

  res.json({ job, preview: previewRows });
});

// ── POST /api/workflow/fetch — Fetch from BackOffice DB ────────────────────
router.post("/workflow/fetch", authenticate, async (req, res) => {
  const roleName = req.user!.roleName;
  if (!canFetch(roleName)) {
    res.status(403).json({ error: "Insufficient role to fetch data" });
    return;
  }

  const { connectionId, query } = req.body as { connectionId: number; query?: string };
  if (!connectionId) { res.status(400).json({ error: "connectionId is required" }); return; }

  const [conn] = await db.select().from(dbConnectionsTable).where(
    and(eq(dbConnectionsTable.id, connectionId), eq(dbConnectionsTable.type, "backoffice"))
  );
  if (!conn) { res.status(404).json({ error: "BackOffice connection not found" }); return; }

  loadEncryptionKey();
  const username = decrypt(conn.usernameEnc);
  const password = decrypt(conn.passwordEnc);

  const [job] = await db.insert(dataJobsTable).values({
    type: "fetch",
    status: "running",
    triggeredBy: req.user!.sub,
    triggeredByEmail: req.user!.email,
    connectionId: conn.id,
    connectionName: conn.name,
    startedAt: new Date(),
  }).returning();

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
    const selectQuery = query || `SELECT * FROM "${conn.schemaName}"."backoffice_data" LIMIT 1000`;
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
      ipAddress: req.ip ?? null,
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
router.post("/workflow/upload-csv", authenticate, upload.single("file"), async (req, res) => {
  const roleName = req.user!.roleName;
  if (!canFetch(roleName)) {
    res.status(403).json({ error: "Insufficient role to upload data" });
    return;
  }

  const file = req.file;
  if (!file) { res.status(400).json({ error: "CSV file is required" }); return; }

  const text = file.buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    res.status(400).json({ error: "CSV must have a header row and at least one data row" });
    return;
  }

  const headers = lines[0].split("|").map((h) => h.trim());
  if (headers.length < 2) {
    res.status(400).json({ error: "CSV must use pipe (|) as delimiter and have at least 2 columns" });
    return;
  }

  const dataLines = lines.slice(1);
  const parsedRows: Record<string, string>[] = dataLines.map((line) => {
    const values = line.split("|");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (values[i] ?? "").trim(); });
    return row;
  });

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
    ipAddress: req.ip ?? null,
  });

  res.json({
    jobId: job.id,
    headers,
    recordCount: parsedRows.length,
    preview: parsedRows.slice(0, 20),
  });
});

// ── POST /api/workflow/jobs/:id/download — Download transformed CSV ─────────
router.post("/workflow/jobs/:id/download", authenticate, async (req, res) => {
  const id = parseInt(req.params.id);
  const [job] = await db.select().from(dataJobsTable).where(eq(dataJobsTable.id, id));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.status !== "success") { res.status(400).json({ error: "Job has not completed successfully" }); return; }

  const mappings = await db.select().from(fieldMappingsTable).orderBy(fieldMappingsTable.sortOrder, fieldMappingsTable.id);
  let csvContent: string;

  if (mappings.length === 0) {
    const rows = await db.select({ rawData: dataStagingTable.rawData }).from(dataStagingTable)
      .where(eq(dataStagingTable.jobId, id)).orderBy(dataStagingTable.rowIndex);
    if (rows.length === 0) { res.status(404).json({ error: "No data for this job" }); return; }
    const headers = Object.keys(rows[0].rawData as Record<string, unknown>);
    const lines = rows.map((r) => headers.map((h) => String((r.rawData as Record<string, unknown>)[h] ?? "")).join("|"));
    csvContent = [headers.join("|"), ...lines].join("\n");
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
    ipAddress: req.ip ?? null,
  });

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="trading-data-job-${id}.csv"`);
  res.send(csvContent);
});

// ── POST /api/workflow/jobs/:id/push — Push to local file path ─────────────
router.post("/workflow/jobs/:id/push", authenticate, async (req, res) => {
  const roleName = req.user!.roleName;
  if (!canPush(roleName)) {
    res.status(403).json({ error: "Only Admin and Manager roles can push to file path" });
    return;
  }

  const id = parseInt(req.params.id);
  const [job] = await db.select().from(dataJobsTable).where(eq(dataJobsTable.id, id));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  if (job.status !== "success") { res.status(400).json({ error: "Job has not completed successfully" }); return; }

  let outputPath: string | null = null;
  if (job.connectionId) {
    const [conn] = await db.select({ outputFilePath: dbConnectionsTable.outputFilePath })
      .from(dbConnectionsTable).where(eq(dbConnectionsTable.id, job.connectionId));
    outputPath = conn?.outputFilePath ?? null;
  }
  if (!outputPath) {
    res.status(400).json({ error: "No output file path configured for this connection" });
    return;
  }

  const mappings = await db.select().from(fieldMappingsTable).orderBy(fieldMappingsTable.sortOrder, fieldMappingsTable.id);
  let csvContent: string;

  if (mappings.length === 0) {
    const rows = await db.select({ rawData: dataStagingTable.rawData }).from(dataStagingTable)
      .where(eq(dataStagingTable.jobId, id)).orderBy(dataStagingTable.rowIndex);
    if (rows.length === 0) { res.status(404).json({ error: "No data for this job" }); return; }
    const headers = Object.keys(rows[0].rawData as Record<string, unknown>);
    const lines = rows.map((r) => headers.map((h) => String((r.rawData as Record<string, unknown>)[h] ?? "")).join("|"));
    csvContent = [headers.join("|"), ...lines].join("\n");
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
    res.status(500).json({ error: `Failed to write to ${outputPath}: ${msg}` });
    return;
  }

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "WORKFLOW_PUSH",
    details: `Pushed transformed CSV for job id=${id} to ${outputPath}`,
    resourceType: "data_job",
    resourceId: String(id),
    ipAddress: req.ip ?? null,
  });

  res.json({ success: true, path: outputPath });
});

export default router;
