import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, applicationTypesTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";

const router: IRouter = Router();

const DEFAULTS = [
  { name: "BackOffice", slug: "backoffice", description: "Back-office system connections", sortOrder: 0 },
  { name: "Trading",    slug: "trading",    description: "Trading platform connections",   sortOrder: 1 },
];

async function seedDefaults() {
  for (const d of DEFAULTS) {
    await db.insert(applicationTypesTable).values(d).onConflictDoNothing();
  }
}

// GET /admin/application-types
router.get("/admin/application-types", authenticate, requireRole("Admin"), async (_req, res): Promise<void> => {
  await seedDefaults();
  const rows = await db.select().from(applicationTypesTable).orderBy(asc(applicationTypesTable.sortOrder), asc(applicationTypesTable.name));
  res.json(rows);
});

// GET /admin/application-types/active — non-admin-restricted, for dropdowns
router.get("/admin/application-types/active", authenticate, async (_req, res): Promise<void> => {
  await seedDefaults();
  const rows = await db
    .select()
    .from(applicationTypesTable)
    .where(eq(applicationTypesTable.isActive, true))
    .orderBy(asc(applicationTypesTable.sortOrder), asc(applicationTypesTable.name));
  res.json(rows);
});

// POST /admin/application-types
router.post("/admin/application-types", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const { name, slug, description, sortOrder } = req.body as {
    name: string; slug: string; description?: string; sortOrder?: number;
  };
  if (!name?.trim() || !slug?.trim()) {
    res.status(400).json({ error: "name and slug are required" });
    return;
  }
  const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  try {
    const [row] = await db.insert(applicationTypesTable).values({
      name: name.trim(),
      slug: cleanSlug,
      description: description?.trim() ?? null,
      sortOrder: sortOrder ?? 0,
    }).returning();
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: "An application type with this name or slug already exists" });
  }
});

// PUT /admin/application-types/:id
router.put("/admin/application-types/:id", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { name, description, isActive, sortOrder } = req.body as {
    name?: string; description?: string; isActive?: boolean; sortOrder?: number;
  };
  const updates: Partial<typeof applicationTypesTable.$inferInsert> = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name.trim();
  if (description !== undefined) updates.description = description?.trim() ?? null;
  if (isActive !== undefined) updates.isActive = isActive;
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;
  try {
    const [updated] = await db.update(applicationTypesTable).set(updates).where(eq(applicationTypesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Application type not found" }); return; }
    res.json(updated);
  } catch {
    res.status(409).json({ error: "An application type with this name already exists" });
  }
});

// DELETE /admin/application-types/:id
router.delete("/admin/application-types/:id", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(applicationTypesTable).where(eq(applicationTypesTable.id, id));
  res.sendStatus(204);
});

export default router;
