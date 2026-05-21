import { Router, type IRouter } from "express";
import { eq, desc, asc } from "drizzle-orm";
import pg from "pg";
import {
  db, dataPipelinesTable, pipelineFieldMappingsTable, auditLogsTable,
  dbConnectionsTable, dataJobsTable, connectionObjectsTable, usersTable,
} from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";
import { decrypt, loadEncryptionKey } from "../lib/crypto";
import { registerPipelineSchedule, cancelPipelineSchedule, runPipelineById, isPipelineRunning, getJobProgress } from "../scheduler";

const { Pool } = pg;
const router: IRouter = Router();

function getIp(req: import("express").Request): string | null {
  return Array.isArray(req.ip) ? (req.ip[0] ?? null) : (req.ip ?? null);
}

// ---------- CRUD ----------

// GET /api/admin/pipelines
router.get("/admin/pipelines", authenticate, requireRole("Admin"), async (_req, res) => {
  const rows = await db
    .select({
      id: dataPipelinesTable.id,
      name: dataPipelinesTable.name,
      description: dataPipelinesTable.description,
      sourceObjectId: dataPipelinesTable.sourceObjectId,
      destObjectId: dataPipelinesTable.destObjectId,
      sourceConnectionId: dataPipelinesTable.sourceConnectionId,
      destConnectionId: dataPipelinesTable.destConnectionId,
      sourceTable: dataPipelinesTable.sourceTable,
      sourceQuery: dataPipelinesTable.sourceQuery,
      destTarget: dataPipelinesTable.destTarget,
      status: dataPipelinesTable.status,
      scheduleEnabled: dataPipelinesTable.scheduleEnabled,
      scheduleCron: dataPipelinesTable.scheduleCron,
      scheduleLastRunAt: dataPipelinesTable.scheduleLastRunAt,
      scheduleNextRunAt: dataPipelinesTable.scheduleNextRunAt,
      scheduleConsecutiveFailures: dataPipelinesTable.scheduleConsecutiveFailures,
      notifyOnSuccess: dataPipelinesTable.notifyOnSuccess,
      notifyOnFailure: dataPipelinesTable.notifyOnFailure,
      loadType: dataPipelinesTable.loadType,
      preSqlCommand: dataPipelinesTable.preSqlCommand,
      postSqlCommand: dataPipelinesTable.postSqlCommand,
      conflictColumns: dataPipelinesTable.conflictColumns,
      watermarkColumn: dataPipelinesTable.watermarkColumn,
      lastWatermarkValue: dataPipelinesTable.lastWatermarkValue,
      createdBy: dataPipelinesTable.createdBy,
      createdAt: dataPipelinesTable.createdAt,
      updatedAt: dataPipelinesTable.updatedAt,
      createdByEmail: usersTable.email,
    })
    .from(dataPipelinesTable)
    .leftJoin(usersTable, eq(dataPipelinesTable.createdBy, usersTable.id))
    .orderBy(desc(dataPipelinesTable.createdAt));
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
    name, description, sourceObjectId, destObjectId,
    sourceConnectionId, destConnectionId,
    sourceTable, sourceQuery, destTarget, status, scheduleEnabled, scheduleCron,
    notifyOnSuccess, notifyOnFailure, loadType, preSqlCommand, postSqlCommand,
    conflictColumns, watermarkColumn,
  } = req.body as {
    name: string; description?: string;
    sourceObjectId?: number | null; destObjectId?: number | null;
    sourceConnectionId?: number; destConnectionId?: number;
    sourceTable?: string; sourceQuery?: string; destTarget?: string;
    status?: string; scheduleEnabled?: boolean; scheduleCron?: string;
    notifyOnSuccess?: string; notifyOnFailure?: string;
    loadType?: "full_load" | "incremental";
    preSqlCommand?: string; postSqlCommand?: string;
    conflictColumns?: string; watermarkColumn?: string;
  };

  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  if (scheduleEnabled && !scheduleCron) {
    res.status(400).json({ error: "scheduleCron is required when scheduleEnabled is true" });
    return;
  }

  const [row] = await db.insert(dataPipelinesTable).values({
    name,
    description: description ?? null,
    sourceObjectId: sourceObjectId ?? null,
    destObjectId: destObjectId ?? null,
    sourceConnectionId: sourceConnectionId ?? null,
    destConnectionId: destConnectionId ?? null,
    sourceTable: sourceTable ?? null,
    sourceQuery: sourceQuery ?? null,
    destTarget: destTarget ?? null,
    status: (status as "active" | "inactive") ?? "inactive",
    scheduleEnabled: scheduleEnabled ?? false,
    scheduleCron: scheduleCron ?? null,
    notifyOnSuccess: notifyOnSuccess?.trim() || null,
    notifyOnFailure: notifyOnFailure?.trim() || null,
    loadType: loadType ?? "full_load",
    preSqlCommand: preSqlCommand?.trim() || null,
    postSqlCommand: postSqlCommand?.trim() || null,
    conflictColumns: conflictColumns?.trim() || null,
    watermarkColumn: watermarkColumn?.trim() || null,
    createdBy: req.user!.sub,
  }).returning();

  if (row.scheduleEnabled && row.scheduleCron && row.status === "active") {
    await registerPipelineSchedule(row.id, row.scheduleCron);
  }

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
  if (body.sourceObjectId !== undefined) updates.sourceObjectId = (body.sourceObjectId as number) || null;
  if (body.destObjectId !== undefined) updates.destObjectId = (body.destObjectId as number) || null;
  if (body.sourceConnectionId !== undefined) updates.sourceConnectionId = (body.sourceConnectionId as number) || null;
  if (body.destConnectionId !== undefined) updates.destConnectionId = (body.destConnectionId as number) || null;
  if (body.sourceTable !== undefined) updates.sourceTable = (body.sourceTable as string) || null;
  if (body.sourceQuery !== undefined) updates.sourceQuery = (body.sourceQuery as string) || null;
  if (body.destTarget !== undefined) updates.destTarget = (body.destTarget as string) || null;
  if (body.status !== undefined) updates.status = body.status as "active" | "inactive";
  if (body.scheduleEnabled !== undefined) updates.scheduleEnabled = body.scheduleEnabled as boolean;
  if (body.scheduleCron !== undefined) updates.scheduleCron = (body.scheduleCron as string) || null;
  if (body.notifyOnSuccess !== undefined) updates.notifyOnSuccess = (body.notifyOnSuccess as string)?.trim() || null;
  if (body.notifyOnFailure !== undefined) updates.notifyOnFailure = (body.notifyOnFailure as string)?.trim() || null;
  if (body.loadType !== undefined) updates.loadType = body.loadType as "full_load" | "incremental";
  if (body.preSqlCommand !== undefined) updates.preSqlCommand = (body.preSqlCommand as string)?.trim() || null;
  if (body.postSqlCommand !== undefined) updates.postSqlCommand = (body.postSqlCommand as string)?.trim() || null;
  if (body.conflictColumns !== undefined) updates.conflictColumns = (body.conflictColumns as string)?.trim() || null;
  if (body.watermarkColumn !== undefined) updates.watermarkColumn = (body.watermarkColumn as string)?.trim() || null;

  const [updated] = await db.update(dataPipelinesTable).set(updates).where(eq(dataPipelinesTable.id, id)).returning();

  // Update scheduler based on new settings
  if (updated.scheduleEnabled && updated.scheduleCron && updated.status === "active") {
    await registerPipelineSchedule(updated.id, updated.scheduleCron);
  } else {
    cancelPipelineSchedule(updated.id);
    if (!updated.scheduleEnabled) {
      await db.update(dataPipelinesTable).set({ scheduleNextRunAt: null }).where(eq(dataPipelinesTable.id, id));
    }
  }

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

  cancelPipelineSchedule(id);
  await db.delete(dataPipelinesTable).where(eq(dataPipelinesTable.id, id));

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub, userEmail: req.user!.email,
    action: "PIPELINE_DELETED", details: `Deleted pipeline: ${existing.name} (id=${id})`,
    resourceType: "pipeline", resourceId: String(id), ipAddress: getIp(req),
  });

  res.status(204).send();
});

// PUT /api/admin/pipelines/:id/mappings — replace all field mappings for a pipeline
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

// ── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Return the effective schema name for a connection.
 * Oracle has no "public" schema — default to the username (upper-cased).
 * All other engines default to "public".
 */
function defaultSchema(conn: { schemaName?: string | null; dbEngine?: string | null; usernameEnc?: string | null }): string {
  if (conn.schemaName) return conn.schemaName;
  if (conn.dbEngine === "oracle") {
    loadEncryptionKey();
    const user = conn.usernameEnc ? decrypt(conn.usernameEnc) : "";
    return user.toUpperCase() || "PUBLIC";
  }
  return "public";
}

async function resolveColumns(connId: number, query: string): Promise<string[]> {
  const [conn] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, connId));
  if (!conn) throw new Error("Connection not found");
  loadEncryptionKey();
  const user = conn.usernameEnc ? decrypt(conn.usernameEnc) : "";
  const pass = conn.passwordEnc ? decrypt(conn.passwordEnc) : "";
  const engine = (conn.dbEngine ?? "postgresql").toLowerCase();

  // ── PostgreSQL ──────────────────────────────────────────────────────────────
  if (engine === "postgresql" || engine === "postgres") {
    const useSSL = (conn.extraParams as Record<string, string> | null)?.ssl === "true";
    const pool = new Pool({
      host: conn.host ?? undefined, port: conn.port ?? 5432,
      database: conn.dbName ?? undefined, user: user || undefined, password: pass || undefined,
      connectionTimeoutMillis: 8000, max: 1,
      ...(useSSL ? { ssl: { rejectUnauthorized: false } } : {}),
    });
    try {
      const result = await pool.query(`SELECT * FROM (${query}) _col_meta LIMIT 0`);
      return result.fields.map(f => f.name);
    } finally {
      await pool.end().catch(() => {});
    }
  }

  // ── MySQL ───────────────────────────────────────────────────────────────────
  if (engine === "mysql") {
    const mysql2 = await import("mysql2/promise");
    const mysqlConn = await mysql2.createConnection({
      host: conn.host ?? "localhost", port: conn.port ?? 3306,
      database: conn.dbName ?? undefined, user, password: pass,
      connectTimeout: 8000,
    });
    try {
      const [, fields] = await mysqlConn.query(`SELECT * FROM (${query}) _col_meta WHERE 1=0`);
      return (fields as { name: string }[]).map(f => f.name);
    } finally {
      await mysqlConn.end().catch(() => {});
    }
  }

  // ── MSSQL ───────────────────────────────────────────────────────────────────
  if (engine === "mssql" || engine === "sqlserver") {
    const mssql = await import("mssql");
    const pool = await mssql.connect({
      server: conn.host ?? "localhost", port: conn.port ?? 1433,
      database: conn.dbName ?? undefined, user, password: pass,
      options: { trustServerCertificate: true, connectTimeout: 8000 },
    } as Parameters<typeof mssql.connect>[0]);
    try {
      const result = await pool.request().query(`SELECT TOP 0 * FROM (${query}) AS _col_meta`);
      return Object.keys(result.recordset.columns ?? {});
    } finally {
      await pool.close().catch(() => {});
    }
  }

  // ── Oracle ──────────────────────────────────────────────────────────────────
  if (engine === "oracle" || engine === "oracledb") {
    const oracledb = await import("oracledb");
    const host = (conn.host ?? "localhost").split("@").pop()!;
    const port = conn.port ?? 1521;
    const service = conn.dbName ?? "ORCL";
    const oraConn = await oracledb.getConnection({
      user, password: pass,
      connectString: `${host}:${port}/${service}`,
    });
    try {
      const result = await oraConn.execute(
        `SELECT * FROM (${query}) _col_meta WHERE 1=0`,
        [], { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (result.metaData ?? []).map((m: { name: string }) => m.name.toLowerCase());
    } finally {
      await oraConn.close().catch(() => {});
    }
  }

  throw new Error(`Column introspection not supported for engine: ${engine}`);
}

// GET /api/admin/pipelines/:id/source-columns — fetch column names from source for mapping UI
router.get("/admin/pipelines/:id/source-columns", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [pipeline] = await db.select().from(dataPipelinesTable).where(eq(dataPipelinesTable.id, id));
  if (!pipeline) { res.status(404).json({ error: "Pipeline not found" }); return; }

  try {
    let connId: number | null = null;
    let q = "";

    if (pipeline.sourceObjectId) {
      // Object-based: resolve via connectionObjectsTable
      const [obj] = await db.select().from(connectionObjectsTable).where(eq(connectionObjectsTable.id, pipeline.sourceObjectId));
      if (!obj) { res.status(400).json({ error: "Source data object not found" }); return; }
      const [conn] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, obj.connectionId));
      if (!conn) { res.status(400).json({ error: "Source connection not found" }); return; }
      connId = conn.id;
      if (obj.objectType === "query") {
        q = obj.objectValue;
      } else {
        q = `SELECT * FROM "${defaultSchema(conn)}"."${obj.objectValue}"`;
      }
    } else if (pipeline.sourceConnectionId) {
      // Legacy: connection + table/query on pipeline itself
      const [conn] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, pipeline.sourceConnectionId));
      if (!conn) { res.status(400).json({ error: "Source connection not found" }); return; }
      connId = conn.id;
      q = pipeline.sourceQuery?.trim() || "";
      if (!q && pipeline.sourceTable) {
        q = `SELECT * FROM "${defaultSchema(conn)}"."${pipeline.sourceTable}"`;
      }
    }

    if (!connId || !q) { res.status(400).json({ error: "No source table or query configured on this pipeline" }); return; }

    const columns = await resolveColumns(connId, q);
    res.json({ columns });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch columns";
    res.status(500).json({ error: msg });
  }
});

// GET /api/admin/pipelines/:id/dest-columns — fetch column names from destination for mapping UI
router.get("/admin/pipelines/:id/dest-columns", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [pipeline] = await db.select().from(dataPipelinesTable).where(eq(dataPipelinesTable.id, id));
  if (!pipeline) { res.status(404).json({ error: "Pipeline not found" }); return; }

  try {
    let connId: number | null = null;
    let q = "";

    if (pipeline.destObjectId) {
      const [obj] = await db.select().from(connectionObjectsTable).where(eq(connectionObjectsTable.id, pipeline.destObjectId));
      if (!obj) { res.status(400).json({ error: "Destination data object not found" }); return; }
      const [conn] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, obj.connectionId));
      if (!conn) { res.status(400).json({ error: "Destination connection not found" }); return; }
      connId = conn.id;
      if (obj.objectType === "query") {
        q = obj.objectValue;
      } else {
        q = `SELECT * FROM "${defaultSchema(conn)}"."${obj.objectValue}"`;
      }
    } else if (pipeline.destConnectionId && pipeline.destTarget) {
      const [conn] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, pipeline.destConnectionId));
      if (!conn) { res.status(400).json({ error: "Destination connection not found" }); return; }
      connId = conn.id;
      q = `SELECT * FROM "${defaultSchema(conn)}"."${pipeline.destTarget}"`;
    }

    if (!connId || !q) { res.status(400).json({ error: "No destination table or query configured on this pipeline" }); return; }

    const columns = await resolveColumns(connId, q);
    res.json({ columns });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch columns";
    res.status(500).json({ error: msg });
  }
});

// GET /api/admin/pipelines/:id/progress — live progress for a running pipeline
router.get("/admin/pipelines/:id/progress", authenticate, requireRole("Admin"), (req, res) => {
  const id = parseInt(String(req.params.id));
  res.json(getJobProgress(id) ?? null);
});

// POST /api/admin/pipelines/:id/run — execute pipeline via Python worker
router.post("/admin/pipelines/:id/run", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(String(req.params.id));

  if (isPipelineRunning(id)) {
    res.status(409).json({ error: "A run is already in progress for this pipeline" });
    return;
  }

  const [pipeline] = await db.select().from(dataPipelinesTable).where(eq(dataPipelinesTable.id, id));
  if (!pipeline) { res.status(404).json({ error: "Pipeline not found" }); return; }

  // Validate: object-based or legacy — at least one source and one dest must be resolvable
  const hasObjectSource = !!pipeline.sourceObjectId;
  const hasLegacySource = !!pipeline.sourceConnectionId && (!!pipeline.sourceTable || !!pipeline.sourceQuery);
  if (!hasObjectSource && !hasLegacySource) {
    res.status(400).json({ error: "Configure a source Data Object (or legacy source connection + table) before running" });
    return;
  }
  const hasObjectDest = !!pipeline.destObjectId;
  const hasLegacyDest = !!pipeline.destConnectionId && !!pipeline.destTarget;
  if (!hasObjectDest && !hasLegacyDest) {
    res.status(400).json({ error: "Configure a destination Data Object (or legacy destination connection + target) before running" });
    return;
  }

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub, userEmail: req.user!.email,
    action: "PIPELINE_RUN_STARTED",
    details: `Started pipeline run: ${pipeline.name} (id=${id})`,
    resourceType: "pipeline", resourceId: String(id), ipAddress: getIp(req),
  });

  const result = await runPipelineById(id, false);
  if (result.success) {
    res.json({ success: true, recordCount: result.recordCount, jobId: result.jobId });
  } else if (result.conflict) {
    res.status(409).json({ success: false, error: result.error });
  } else {
    res.status(500).json({ success: false, error: result.error, jobId: result.jobId });
  }
});

export default router;
