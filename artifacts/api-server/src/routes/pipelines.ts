import { Router, type IRouter } from "express";
import { eq, desc, asc } from "drizzle-orm";
import { db, dataPipelinesTable, pipelineFieldMappingsTable, auditLogsTable, dbConnectionsTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";

const router: IRouter = Router();

function safeRow(r: typeof dataPipelinesTable.$inferSelect) {
  return r;
}

// GET /api/admin/pipelines
router.get("/admin/pipelines", authenticate, requireRole("Admin"), async (_req, res) => {
  const rows = await db.select().from(dataPipelinesTable).orderBy(desc(dataPipelinesTable.createdAt));
  res.json(rows);
});

// GET /api/admin/pipelines/:id
router.get("/admin/pipelines/:id", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.select().from(dataPipelinesTable).where(eq(dataPipelinesTable.id, id));
  if (!row) { res.status(404).json({ error: "Pipeline not found" }); return; }
  res.json(row);
});

// GET /api/admin/pipelines/:id/mappings
router.get("/admin/pipelines/:id/mappings", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(req.params.id);
  const mappings = await db
    .select()
    .from(pipelineFieldMappingsTable)
    .where(eq(pipelineFieldMappingsTable.pipelineId, id))
    .orderBy(asc(pipelineFieldMappingsTable.sortOrder), asc(pipelineFieldMappingsTable.id));
  res.json(mappings);
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
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "PIPELINE_CREATED",
    details: `Created pipeline: ${name} (id=${row.id})`,
    resourceType: "pipeline",
    resourceId: String(row.id),
    ipAddress: req.ip ?? null,
  });

  res.status(201).json(safeRow(row));
});

// PUT /api/admin/pipelines/:id
router.put("/admin/pipelines/:id", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(dataPipelinesTable).where(eq(dataPipelinesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Pipeline not found" }); return; }

  const {
    name, description, sourceConnectionId, destConnectionId,
    sourceQuery, destTarget, status, scheduleEnabled, scheduleCron,
  } = req.body as Record<string, unknown>;

  const updates: Partial<typeof dataPipelinesTable.$inferInsert> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name as string;
  if (description !== undefined) updates.description = (description as string) || null;
  if (sourceConnectionId !== undefined) updates.sourceConnectionId = (sourceConnectionId as number) || null;
  if (destConnectionId !== undefined) updates.destConnectionId = (destConnectionId as number) || null;
  if (sourceQuery !== undefined) updates.sourceQuery = (sourceQuery as string) || null;
  if (destTarget !== undefined) updates.destTarget = (destTarget as string) || null;
  if (status !== undefined) updates.status = status as "active" | "inactive";
  if (scheduleEnabled !== undefined) updates.scheduleEnabled = scheduleEnabled as boolean;
  if (scheduleCron !== undefined) updates.scheduleCron = (scheduleCron as string) || null;

  const [updated] = await db.update(dataPipelinesTable).set(updates).where(eq(dataPipelinesTable.id, id)).returning();

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "PIPELINE_UPDATED",
    details: `Updated pipeline: ${updated.name} (id=${id})`,
    resourceType: "pipeline",
    resourceId: String(id),
    ipAddress: req.ip ?? null,
  });

  res.json(safeRow(updated));
});

// DELETE /api/admin/pipelines/:id
router.delete("/admin/pipelines/:id", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(dataPipelinesTable).where(eq(dataPipelinesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Pipeline not found" }); return; }

  await db.delete(dataPipelinesTable).where(eq(dataPipelinesTable.id, id));

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "PIPELINE_DELETED",
    details: `Deleted pipeline: ${existing.name} (id=${id})`,
    resourceType: "pipeline",
    resourceId: String(id),
    ipAddress: req.ip ?? null,
  });

  res.status(204).send();
});

// PUT /api/admin/pipelines/:id/mappings — replace all field mappings for a pipeline
router.put("/admin/pipelines/:id/mappings", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(dataPipelinesTable).where(eq(dataPipelinesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Pipeline not found" }); return; }

  const { mappings } = req.body as {
    mappings: Array<{
      sourceField: string; destField: string;
      transformType?: string; transformParams?: string; sortOrder?: number;
    }>;
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
    .select()
    .from(pipelineFieldMappingsTable)
    .where(eq(pipelineFieldMappingsTable.pipelineId, id))
    .orderBy(asc(pipelineFieldMappingsTable.sortOrder));

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "PIPELINE_MAPPINGS_UPDATED",
    details: `Updated field mappings for pipeline: ${existing.name} (id=${id}), ${mappings.length} mapping(s)`,
    resourceType: "pipeline",
    resourceId: String(id),
    ipAddress: req.ip ?? null,
  });

  res.json(saved);
});

// GET /api/admin/pipelines/:id/connections — return source and dest connection names for a pipeline
router.get("/admin/pipelines/:id/connections", authenticate, requireRole("Admin"), async (req, res) => {
  const id = parseInt(req.params.id);
  const [pipeline] = await db.select().from(dataPipelinesTable).where(eq(dataPipelinesTable.id, id));
  if (!pipeline) { res.status(404).json({ error: "Pipeline not found" }); return; }

  let source = null;
  let dest = null;
  if (pipeline.sourceConnectionId) {
    const [r] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, pipeline.sourceConnectionId));
    if (r) source = { id: r.id, name: r.name, dbEngine: r.dbEngine, type: r.type };
  }
  if (pipeline.destConnectionId) {
    const [r] = await db.select().from(dbConnectionsTable).where(eq(dbConnectionsTable.id, pipeline.destConnectionId));
    if (r) dest = { id: r.id, name: r.name, dbEngine: r.dbEngine, type: r.type };
  }

  res.json({ source, dest });
});

export default router;
