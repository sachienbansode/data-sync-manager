import { Router, type IRouter } from "express";
import { eq, desc, asc } from "drizzle-orm";
import pg from "pg";
import {
  db, dataPipelinesTable, pipelineFieldMappingsTable, auditLogsTable,
  dbConnectionsTable, dataJobsTable, dataStagingTable,
} from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";
import { decrypt, loadEncryptionKey } from "../lib/crypto";

const { Pool } = pg;
const router: IRouter = Router();

function getIp(req: import("express").Request): string | null {
  return Array.isArray(req.ip) ? (req.ip[0] ?? null) : (req.ip ?? null);
}

const DB_ENGINES = ["postgresql", "mysql", "mssql", "oracle"] as const;
type DbEngine = typeof DB_ENGINES[number];
function isDbEngine(engine: string): engine is DbEngine {
  return (DB_ENGINES as readonly string[]).includes(engine);
}

// ---------- Transform helpers ----------
function applyTransform(value: unknown, transformType: string, params: string): unknown {
  switch (transformType) {
    case "string":
      return value === null || value === undefined ? null : String(value);
    case "number": {
      const n = Number(value);
      return isNaN(n) ? null : n;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") return ["true", "1", "yes", "y"].includes(value.toLowerCase());
      return Boolean(value);
    }
    case "date-format": {
      if (!value) return null;
      const d = new Date(String(value));
      if (isNaN(d.getTime())) return String(value);
      if (!params) return d.toISOString().split("T")[0];
      return params
        .replace("YYYY", String(d.getFullYear()))
        .replace("MM", String(d.getMonth() + 1).padStart(2, "0"))
        .replace("DD", String(d.getDate()).padStart(2, "0"))
        .replace("HH", String(d.getHours()).padStart(2, "0"))
        .replace("mm", String(d.getMinutes()).padStart(2, "0"))
        .replace("ss", String(d.getSeconds()).padStart(2, "0"));
    }
    case "passthrough":
    default:
      return value;
  }
}

const DML_PATTERN =
  /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|EXECUTE|EXEC|CALL|MERGE)\b/i;
function validateSelect(query: string): string | null {
  const q = query.trim();
  if (!q) return "Query cannot be empty";
  if (!/^SELECT\b/i.test(q)) return "Query must start with SELECT";
  if (q.includes(";")) return "Query must not contain semicolons";
  const m = q.match(DML_PATTERN);
  if (m) return `Query must not contain ${m[0].toUpperCase()} statements`;
  return null;
}

function makePool(conn: typeof dbConnectionsTable.$inferSelect, username: string, password: string) {
  return new Pool({
    host: conn.host ?? undefined,
    port: conn.port ?? 5432,
    database: conn.dbName ?? undefined,
    user: username,
    password,
    connectionTimeoutMillis: 15000,
    max: 2,
    ssl: false,
  });
}

// ---------- CRUD ----------

// GET /api/admin/pipelines
router.get("/admin/pipelines", authenticate, requireRole("Admin"), async (_req, res) => {
  const rows = await db.select().from(dataPipelinesTable).orderBy(desc(dataPipelinesTable.createdAt));
  res.json(rows);
});

// GET /api/admin/pipelines/:id
router.get("/admin/pipelines/:id", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [row] = await db.select().from(dataPipelinesTable).where(eq(dataPipelinesTable.id, id));
  if (!row) { res.status(404).json({ error: "Pipeline not found" }); return; }
  res.json(row);
});

// GET /api/admin/pipelines/:id/mappings
router.get("/admin/pipelines/:id/mappings", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const mappings = await db
    .select()
    .from(pipelineFieldMappingsTable)
    .where(eq(pipelineFieldMappingsTable.pipelineId, id))
    .orderBy(asc(pipelineFieldMappingsTable.sortOrder), asc(pipelineFieldMappingsTable.id));
  res.json(mappings);
});

// GET /api/admin/pipelines/:id/runs — last 50 job runs for this pipeline
router.get("/admin/pipelines/:id/runs", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [pipeline] = await db.select().from(dataPipelinesTable).where(eq(dataPipelinesTable.id, id));
  if (!pipeline) { res.status(404).json({ error: "Pipeline not found" }); return; }

  const runs = await db
    .select()
    .from(dataJobsTable)
    .where(eq(dataJobsTable.pipelineId, id))
    .orderBy(desc(dataJobsTable.createdAt))
    .limit(50);

  res.json(runs);
});

// POST /api/admin/pipelines
router.post("/admin/pipelines", authenticate, requireRole("Admin"), async (req, res) => {
  const {
    name, description, sourceConnectionId, destConnectionId,
    sourceQuery, destTarget, status, scheduleEnabled, scheduleCron,
  } = req.body as {
    name: string; description?: string;
    sourceConnectionId?: number; destConnectionId?: number;
    sourceQuery?: string; destTarget?: string;
    status?: string; scheduleEnabled?: boolean; scheduleCron?: string;
  };

  if (!name) { res.status(400).json({ error: "name is required" }); return; }

  const [row] = await db.insert(dataPipelinesTable).values({
    name,
    description: description ?? null,
    sourceConnectionId: sourceConnectionId ?? null,
    destConnectionId: destConnectionId ?? null,
    sourceQuery: sourceQuery ?? null,
    destTarget: destTarget ?? null,
    status: (status as "active" | "inactive") ?? "inactive",
    scheduleEnabled: scheduleEnabled ?? false,
    scheduleCron: scheduleCron ?? null,
    createdBy: req.user!.sub,
  }).returning();

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub, userEmail: req.user!.email,
    action: "PIPELINE_CREATED", details: `Created pipeline: ${name} (id=${row.id})`,
    resourceType: "pipeline", resourceId: String(row.id), ipAddress: getIp(req),
  });

  res.status(201).json(row);
});

// PUT /api/admin/pipelines/:id
router.put("/admin/pipelines/:id", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [existing] = await db.select().from(dataPipelinesTable).where(eq(dataPipelinesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Pipeline not found" }); return; }

  const body = req.body as Record<string, unknown>;
  const updates: Partial<typeof dataPipelinesTable.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name as string;
  if (body.description !== undefined) updates.description = (body.description as string) || null;
  if (body.sourceConnectionId !== undefined) updates.sourceConnectionId = (body.sourceConnectionId as number) || null;
  if (body.destConnectionId !== undefined) updates.destConnectionId = (body.destConnectionId as number) || null;
  if (body.sourceQuery !== undefined) updates.sourceQuery = (body.sourceQuery as string) || null;
  if (body.destTarget !== undefined) updates.destTarget = (body.destTarget as string) || null;
  if (body.status !== undefined) updates.status = body.status as "active" | "inactive";
  if (body.scheduleEnabled !== undefined) updates.scheduleEnabled = body.scheduleEnabled as boolean;
  if (body.scheduleCron !== undefined) updates.scheduleCron = (body.scheduleCron as string) || null;

  const [updated] = await db.update(dataPipelinesTable).set(updates).where(eq(dataPipelinesTable.id, id)).returning();

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub, userEmail: req.user!.email,
    action: "PIPELINE_UPDATED", details: `Updated pipeline: ${updated.name} (id=${id})`,
    resourceType: "pipeline", resourceId: String(id), ipAddress: getIp(req),
  });

  res.json(updated);
});

// DELETE /api/admin/pipelines/:id
router.delete("/admin/pipelines/:id", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [existing] = await db.select().from(dataPipelinesTable).where(eq(dataPipelinesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Pipeline not found" }); return; }

  await db.delete(dataPipelinesTable).where(eq(dataPipelinesTable.id, id));

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub, userEmail: req.user!.email,
    action: "PIPELINE_DELETED", details: `Deleted pipeline: ${existing.name} (id=${id})`,
    resourceType: "pipeline", resourceId: String(id), ipAddress: getIp(req),
  });

  res.status(204).send();
});

// PUT /api/admin/pipelines/:id/mappings
router.put("/admin/pipelines/:id/mappings", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [existing] = await db.select().from(dataPipelinesTable).where(eq(dataPipelinesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Pipeline not found" }); return; }

  const { mappings } = req.body as {
    mappings: Array<{ sourceField: string; destField: string; transformType?: string; transformParams?: string; sortOrder?: number }>;
  };
  if (!Array.isArray(mappings)) { res.status(400).json({ error: "mappings array is required" }); return; }

  await db.delete(pipelineFieldMappingsTable).where(eq(pipelineFieldMappingsTable.pipelineId, id));

  if (mappings.length > 0) {
    await db.insert(pipelineFieldMappingsTable).values(
      mappings.map((m, i) => ({
        pipelineId: id,
        sourceField: m.sourceField,
        destField: m.destField,
        transformType: (m.transformType ?? "passthrough") as typeof pipelineFieldMappingsTable.$inferInsert["transformType"],
        transformParams: m.transformParams ?? null,
        sortOrder: m.sortOrder ?? i,
      }))
    );
  }

  const saved = await db
    .select().from(pipelineFieldMappingsTable)
    .where(eq(pipelineFieldMappingsTable.pipelineId, id))
    .orderBy(asc(pipelineFieldMappingsTable.sortOrder));

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub, userEmail: req.user!.email,
    action: "PIPELINE_MAPPINGS_UPDATED",
    details: `Updated field mappings for pipeline: ${existing.name} (id=${id}), ${mappings.length} mapping(s)`,
    resourceType: "pipeline", resourceId: String(id), ipAddress: getIp(req),
  });

  res.json(saved);
});

// POST /api/admin/pipelines/:id/run — execute pipeline end-to-end
router.post("/admin/pipelines/:id/run", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));

  const [pipeline] = await db.select().from(dataPipelinesTable).where(eq(dataPipelinesTable.id, id));
  if (!pipeline) { res.status(404).json({ error: "Pipeline not found" }); return; }
  if (!pipeline.sourceConnectionId) { res.status(400).json({ error: "Pipeline has no source connection configured" }); return; }
  if (!pipeline.destConnectionId)   { res.status(400).json({ error: "Pipeline has no destination connection configured" }); return; }

  const [[srcConn], [dstConn]] = await Promise.all([
    db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, pipeline.sourceConnectionId)),
    db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, pipeline.destConnectionId)),
  ]);
  if (!srcConn) { res.status(400).json({ error: "Source connection not found" }); return; }
  if (!dstConn) { res.status(400).json({ error: "Destination connection not found" }); return; }

  if (!isDbEngine(srcConn.dbEngine)) {
    res.status(400).json({ error: `Source engine "${srcConn.dbEngine}" is not yet supported for pipeline runs. Use PostgreSQL, MySQL, MS SQL, or Oracle as the source.` });
    return;
  }
  if (!isDbEngine(dstConn.dbEngine)) {
    res.status(400).json({ error: `Destination engine "${dstConn.dbEngine}" is not yet supported for pipeline runs. Use PostgreSQL, MySQL, MS SQL, or Oracle as the destination.` });
    return;
  }
  if (!pipeline.destTarget) {
    res.status(400).json({ error: "Destination table is required. Set 'Destination Table / Path' on the pipeline (e.g. public.target_table)." });
    return;
  }

  const mappings = await db
    .select().from(pipelineFieldMappingsTable)
    .where(eq(pipelineFieldMappingsTable.pipelineId, id))
    .orderBy(asc(pipelineFieldMappingsTable.sortOrder));

  // Create job record
  const [job] = await db.insert(dataJobsTable).values({
    type: "pipeline",
    status: "running",
    triggeredBy: req.user!.sub,
    triggeredByEmail: req.user!.email,
    triggeredBySchedule: false,
    pipelineId: id,
    startedAt: new Date(),
  }).returning();

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub, userEmail: req.user!.email,
    action: "PIPELINE_RUN_STARTED",
    details: `Started pipeline run: ${pipeline.name} (id=${id}, job=${job.id})`,
    resourceType: "pipeline", resourceId: String(id), ipAddress: getIp(req),
  });

  const fail = async (msg: string) => {
    await db.update(dataJobsTable).set({ status: "failed", errorMessage: msg, finishedAt: new Date() }).where(eq(dataJobsTable.id, job.id));
    return { success: false, error: msg, jobId: job.id };
  };

  loadEncryptionKey();

  // ── Step 1: Fetch rows from source ──
  let sourceRows: Record<string, unknown>[] = [];
  let srcPool: InstanceType<typeof Pool> | null = null;
  try {
    const srcUser = srcConn.usernameEnc ? decrypt(srcConn.usernameEnc) : "";
    const srcPass = srcConn.passwordEnc ? decrypt(srcConn.passwordEnc) : "";
    srcPool = makePool(srcConn, srcUser, srcPass);

    const rawQuery = pipeline.sourceQuery?.trim() ||
      `SELECT * FROM "${srcConn.schemaName ?? "public"}"."data" LIMIT 10000`;
    const qErr = validateSelect(rawQuery);
    if (qErr) {
      const result = await fail(`Source query error: ${qErr}`);
      res.status(400).json(result);
      return;
    }
    const qResult = await srcPool.query(rawQuery);
    sourceRows = qResult.rows as Record<string, unknown>[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch from source";
    const result = await fail(`Source error: ${msg}`);
    res.status(500).json(result);
    return;
  } finally {
    await srcPool?.end().catch(() => {});
  }

  // ── Step 2: Apply field mappings ──
  let transformedRows: Record<string, unknown>[];
  if (mappings.length === 0) {
    // No mappings — pass rows through as-is
    transformedRows = sourceRows;
  } else {
    transformedRows = sourceRows.map(row => {
      const out: Record<string, unknown> = {};
      for (const m of mappings) {
        out[m.destField] = applyTransform(row[m.sourceField], m.transformType, m.transformParams ?? "");
      }
      return out;
    });
  }

  // Save staging data (sample first 1000 to avoid excessive storage)
  if (sourceRows.length > 0) {
    const sample = sourceRows.slice(0, 1000);
    await db.insert(dataStagingTable).values(
      sample.map((row, i) => ({
        jobId: job.id,
        rowIndex: i,
        rawData: row,
        transformedData: transformedRows[i] ?? null,
      }))
    ).catch(() => {}); // non-fatal
  }

  // ── Step 3: Push to destination ──
  let dstPool: InstanceType<typeof Pool> | null = null;
  try {
    const dstUser = dstConn.usernameEnc ? decrypt(dstConn.usernameEnc) : "";
    const dstPass = dstConn.passwordEnc ? decrypt(dstConn.passwordEnc) : "";
    dstPool = makePool(dstConn, dstUser, dstPass);

    if (transformedRows.length > 0) {
      const cols = Object.keys(transformedRows[0]);
      if (cols.length === 0) throw new Error("Transformed rows have no columns");

      const colList = cols.map(c => `"${c}"`).join(", ");
      const CHUNK = 200;

      for (let i = 0; i < transformedRows.length; i += CHUNK) {
        const chunk = transformedRows.slice(i, i + CHUNK);
        const placeholders = chunk
          .map((_, ri) => `(${cols.map((_, ci) => `$${ri * cols.length + ci + 1}`).join(", ")})`)
          .join(", ");
        const values = chunk.flatMap(row => cols.map(c => row[c] ?? null));
        await dstPool.query(
          `INSERT INTO ${pipeline.destTarget} (${colList}) VALUES ${placeholders}`,
          values
        );
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to push to destination";
    const result = await fail(`Destination error: ${msg}`);
    res.status(500).json(result);
    return;
  } finally {
    await dstPool?.end().catch(() => {});
  }

  // ── Step 4: Mark success ──
  await db.update(dataJobsTable).set({
    status: "success",
    recordCount: transformedRows.length,
    finishedAt: new Date(),
  }).where(eq(dataJobsTable.id, job.id));

  await db.update(dataPipelinesTable).set({
    scheduleLastRunAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(dataPipelinesTable.id, id));

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub, userEmail: req.user!.email,
    action: "PIPELINE_RUN_COMPLETED",
    details: `Pipeline run completed: ${pipeline.name} — ${transformedRows.length} row(s) transferred (job=${job.id})`,
    resourceType: "pipeline", resourceId: String(id), ipAddress: getIp(req),
  });

  res.json({ success: true, recordCount: transformedRows.length, jobId: job.id });
});

export default router;
