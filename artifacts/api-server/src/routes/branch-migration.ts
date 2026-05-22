import { Router, type IRouter } from "express";
import { eq, ilike, and, or, sql, desc } from "drizzle-orm";
import { db, branchMigrationTable } from "@workspace/db";
import { authenticate, requireRole, requirePageAccess } from "../middlewares/authenticate";
import { apiKeyAuth } from "../middlewares/api-key-auth";
import { z } from "zod";

function uniqueViolationMessage(err: unknown): string | null {
  const msg = (err as { message?: string })?.message ?? "";
  if (!msg.includes("unique") && !msg.includes("duplicate")) return null;
  if (msg.includes("uq_bm_branchname")) return "Branch name already exists.";
  if (msg.includes("uq_bm_email"))      return "Email address already used by another branch.";
  if (msg.includes("pkey") || msg.includes("branchcode")) return "Branch code already exists.";
  return "A unique constraint was violated.";
}

const router: IRouter = Router();

const MIGRATION_STATUSES = ["Migrated", "Pending", "Planned"] as const;

const UpsertBody = z.object({
  branchcode:      z.string().min(1).max(30),
  branchname:      z.string().min(1).max(200),
  defaultcode:     z.string().max(20).optional().nullable(),
  email:           z.string().max(200).optional().nullable(),
  address1:        z.string().max(500).optional().nullable(),
  ccity:           z.string().max(100).optional().nullable(),
  npincode:        z.string().max(20).optional().nullable(),
  migrationStatus: z.enum(MIGRATION_STATUSES).default("Pending"),
  migrationDate:   z.string().nullable().optional(),
});

// ── Admin CRUD ─────────────────────────────────────────────────────────────────

// GET /admin/branch-migration
router.get(
  "/admin/branch-migration",
  authenticate,
  requireRole("Admin"),
  async (req, res): Promise<void> => {
    const search = (req.query.search as string | undefined)?.trim() ?? "";
    const status = req.query.status as string | undefined;
    const page     = Math.max(1, Number(req.query.page  ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20)));
    const offset   = (page - 1) * pageSize;

    const conditions = [];
    if (search) {
      conditions.push(
        or(
          ilike(branchMigrationTable.branchcode,  `%${search}%`),
          ilike(branchMigrationTable.branchname,  `%${search}%`),
          ilike(branchMigrationTable.ccity,       `%${search}%`),
        ),
      );
    }
    if (status && MIGRATION_STATUSES.includes(status as typeof MIGRATION_STATUSES[number])) {
      conditions.push(eq(branchMigrationTable.migrationStatus, status as typeof MIGRATION_STATUSES[number]));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ count }]] = await Promise.all([
      db.select().from(branchMigrationTable).where(where).limit(pageSize).offset(offset)
        .orderBy(desc(branchMigrationTable.updatedDatetime), desc(branchMigrationTable.createdDatetime)),
      db.select({ count: sql<number>`count(*)::int` }).from(branchMigrationTable).where(where),
    ]);

    res.json({ data: rows, total: count, page, pageSize });
  },
);

// POST /admin/branch-migration
router.post(
  "/admin/branch-migration",
  authenticate,
  requireRole("Admin"),
  async (req, res): Promise<void> => {
    const parsed = UpsertBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    const { branchcode, migrationDate, ...rest } = parsed.data;

    const existing = await db.select({ branchcode: branchMigrationTable.branchcode })
      .from(branchMigrationTable)
      .where(eq(branchMigrationTable.branchcode, branchcode));
    if (existing.length > 0) {
      res.status(409).json({ error: `Branch code '${branchcode}' already exists.` });
      return;
    }

    const userEmail = (req as Request & { user?: { email?: string } }).user?.email ?? "SYSTEM";
    try {
      const [row] = await db.insert(branchMigrationTable).values({
        branchcode,
        ...rest,
        migrationDate: migrationDate ?? null,
        createdBy: userEmail,
        updatedBy: userEmail,
      }).returning();
      res.status(201).json(row);
    } catch (err) {
      const msg = uniqueViolationMessage(err);
      if (msg) { res.status(409).json({ error: msg }); return; }
      throw err;
    }
  },
);

// PUT /admin/branch-migration/:branchcode
router.put(
  "/admin/branch-migration/:branchcode",
  authenticate,
  requireRole("Admin"),
  async (req, res): Promise<void> => {
    const branchcode = req.params.branchcode;
    const parsed = UpsertBody.omit({ branchcode: true }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    const { migrationDate, ...rest } = parsed.data;

    const userEmail = (req as Request & { user?: { email?: string } }).user?.email ?? "SYSTEM";
    try {
      const [row] = await db.update(branchMigrationTable)
        .set({
          ...rest,
          migrationDate: migrationDate ?? null,
          updatedBy: userEmail,
          updatedDatetime: new Date(),
        })
        .where(eq(branchMigrationTable.branchcode, branchcode))
        .returning();
      if (!row) { res.status(404).json({ error: "Branch not found." }); return; }
      res.json(row);
    } catch (err) {
      const msg = uniqueViolationMessage(err);
      if (msg) { res.status(409).json({ error: msg }); return; }
      throw err;
    }
  },
);

// DELETE /admin/branch-migration/:branchcode
router.delete(
  "/admin/branch-migration/:branchcode",
  authenticate,
  requireRole("Admin"),
  async (req, res): Promise<void> => {
    const branchcode = req.params.branchcode;
    const [row] = await db.delete(branchMigrationTable)
      .where(eq(branchMigrationTable.branchcode, branchcode))
      .returning({ branchcode: branchMigrationTable.branchcode });
    if (!row) { res.status(404).json({ error: "Branch not found." }); return; }
    res.json({ ok: true });
  },
);

// ── External API (API-key protected) ────────────────────────────────────────────

/**
 * GET /api/v1/branch-migration?branchcode=XXXXX
 * Returns migration_status and migration_date for the given branch code.
 * Authentication: Bearer <apk_...> or X-Api-Key header.
 */
router.get(
  "/v1/branch-migration",
  apiKeyAuth,
  async (req, res): Promise<void> => {
    const branchcode = (req.query.branchcode as string | undefined)?.trim();
    if (!branchcode) {
      res.status(400).json({ error: "branchcode query parameter is required." });
      return;
    }

    const [row] = await db
      .select({
        branchcode:      branchMigrationTable.branchcode,
        branchname:      branchMigrationTable.branchname,
        migrationStatus: branchMigrationTable.migrationStatus,
      })
      .from(branchMigrationTable)
      .where(eq(branchMigrationTable.branchcode, branchcode));

    if (!row) {
      res.status(404).json({ error: `Branch code '${branchcode}' not found.` });
      return;
    }

    res.json({
      branch_code:      row.branchcode,
      branch_name:      row.branchname ?? null,
      migration_status: row.migrationStatus,
    });
  },
);

export default router;
