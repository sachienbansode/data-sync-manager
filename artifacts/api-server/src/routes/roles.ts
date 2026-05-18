import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, rolesTable, pagePermissionsTable, usersTable, auditLogsTable } from "@workspace/db";
import {
  GetRolePagePermissionsParams,
  UpdateRolePagePermissionsParams,
  UpdateRolePagePermissionsBody,
} from "@workspace/api-zod";
import { z } from "zod";
import { authenticate, requireRole, requirePageAccess } from "../middlewares/authenticate";

const router: IRouter = Router();

export const ALL_PAGES = [
  { path: "/dashboard", name: "Dashboard" },
  { path: "/users", name: "Users" },
  { path: "/roles", name: "Roles & Permissions" },
  { path: "/audit-log", name: "Audit Log" },
  { path: "/admin/login-report", name: "Login Report" },
  { path: "/admin/data-objects", name: "Data Objects" },
  { path: "/workflow", name: "Data Workflow" },
  { path: "/workflow/jobs", name: "Workflow Jobs" },
  { path: "/admin/db-connections", name: "DB Connections" },
  { path: "/admin/field-mappings", name: "Field Mappings" },
  { path: "/admin/email-settings", name: "Email Settings" },
  { path: "/admin/app-settings", name: "App Settings" },
  { path: "/admin/font-settings", name: "Font Settings" },
  { path: "/admin/allowed-file-types", name: "Allowed File Types" },
  { path: "/admin/pii-permissions", name: "PII Permissions" },
  { path: "/pii-records", name: "PII Records" },
  { path: "/admin/application-types", name: "Application Types" },
  { path: "/admin/email-templates", name: "Email Templates" },
  { path: "/docs", name: "API Documentation" },
  { path: "/url-shortener", name: "URL Shortener" },
  { path: "/admin/short-domains", name: "Short Domains" },
  { path: "/email-hub/campaigns", name: "Email Campaigns" },
  { path: "/email-hub/templates", name: "Email Templates (Bulk)" },
  { path: "/admin/comm-settings", name: "Bulk Email Settings" },
  { path: "/data-preview", name: "Data Preview" },
  { path: "/admin/rpa-bots", name: "RPA Bots" },
];

const CreateRoleBody = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(200).default(""),
  mfaRequired: z.boolean().default(false),
});

const UpdateRoleBody = z.object({
  name: z.string().min(1).max(60).optional(),
  description: z.string().max(200).optional(),
  mfaRequired: z.boolean().optional(),
});

// GET /roles/pages — list of all pages that can be permission-controlled
router.get("/roles/pages", authenticate, async (_req, res): Promise<void> => {
  res.json(ALL_PAGES);
});

// GET /roles
router.get("/roles", authenticate, requirePageAccess("/roles"), async (_req, res): Promise<void> => {
  const roles = await db
    .select({
      id: rolesTable.id,
      name: rolesTable.name,
      description: rolesTable.description,
      mfaRequired: rolesTable.mfaRequired,
      userCount: sql<number>`count(${usersTable.id})::int`,
    })
    .from(rolesTable)
    .leftJoin(usersTable, eq(usersTable.roleId, rolesTable.id))
    .groupBy(rolesTable.id)
    .orderBy(rolesTable.id);

  res.json(roles);
});

// POST /roles — create a new role
router.post("/roles", authenticate, requirePageAccess("/roles"), requireRole("Admin"), async (req, res): Promise<void> => {
  const body = CreateRoleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const existing = await db.select({ id: rolesTable.id }).from(rolesTable).where(eq(rolesTable.name, body.data.name));
  if (existing.length > 0) {
    res.status(409).json({ error: `Role "${body.data.name}" already exists` });
    return;
  }

  const [role] = await db.insert(rolesTable).values({
    name: body.data.name,
    description: body.data.description,
    mfaRequired: body.data.mfaRequired,
  }).returning();

  // Seed page permissions for the new role (all false by default)
  await db.insert(pagePermissionsTable).values(
    ALL_PAGES.map(p => ({
      roleId: role!.id,
      pagePath: p.path,
      pageName: p.name,
      canAccess: false,
    }))
  ).onConflictDoNothing();

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "ROLE_CREATED",
    details: `Created role: ${body.data.name}`,
    ipAddress: req.ip ?? null,
  });

  res.status(201).json({ ...role, userCount: 0 });
});

// PUT /roles/:id — update role name / description / mfaRequired
router.put("/roles/:id", authenticate, requirePageAccess("/roles"), requireRole("Admin"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = UpdateRoleBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  // Check name collision if renaming
  if (body.data.name) {
    const clash = await db.select({ id: rolesTable.id }).from(rolesTable)
      .where(eq(rolesTable.name, body.data.name));
    if (clash.length > 0 && clash[0]!.id !== id) {
      res.status(409).json({ error: `Role "${body.data.name}" already exists` });
      return;
    }
  }

  const updateData: Partial<typeof rolesTable.$inferInsert> = {};
  if (body.data.name != null) updateData.name = body.data.name;
  if (body.data.description != null) updateData.description = body.data.description;
  if (body.data.mfaRequired != null) updateData.mfaRequired = body.data.mfaRequired;

  const [role] = await db.update(rolesTable).set(updateData).where(eq(rolesTable.id, id)).returning();
  if (!role) { res.status(404).json({ error: "Role not found" }); return; }

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "ROLE_UPDATED",
    details: `Updated role ${role.name}`,
    ipAddress: req.ip ?? null,
  });

  const [withCount] = await db
    .select({ id: rolesTable.id, name: rolesTable.name, description: rolesTable.description, mfaRequired: rolesTable.mfaRequired, userCount: sql<number>`count(${usersTable.id})::int` })
    .from(rolesTable).leftJoin(usersTable, eq(usersTable.roleId, rolesTable.id))
    .where(eq(rolesTable.id, id)).groupBy(rolesTable.id);

  res.json(withCount);
});

// DELETE /roles/:id
router.delete("/roles/:id", authenticate, requirePageAccess("/roles"), requireRole("Admin"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.roleId, id));
  if (count > 0) {
    res.status(400).json({ error: `Cannot delete — ${count} user(s) are assigned to this role. Reassign them first.` });
    return;
  }

  const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, id));
  if (!role) { res.status(404).json({ error: "Role not found" }); return; }

  await db.delete(rolesTable).where(eq(rolesTable.id, id));

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "ROLE_DELETED",
    details: `Deleted role: ${role.name}`,
    ipAddress: req.ip ?? null,
  });

  res.sendStatus(204);
});

// GET /roles/:id/page-permissions
router.get("/roles/:id/page-permissions", authenticate, requirePageAccess("/roles"), async (req, res): Promise<void> => {
  const params = GetRolePagePermissionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const perms = await db
    .select()
    .from(pagePermissionsTable)
    .where(eq(pagePermissionsTable.roleId, params.data.id))
    .orderBy(pagePermissionsTable.pagePath);

  res.json(perms);
});

// PUT /roles/:id/page-permissions
router.put("/roles/:id/page-permissions", authenticate, requirePageAccess("/roles"), requireRole("Admin"), async (req, res): Promise<void> => {
  const params = UpdateRolePagePermissionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateRolePagePermissionsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const roleId = params.data.id;

  for (const perm of body.data.permissions) {
    await db
      .insert(pagePermissionsTable)
      .values({
        roleId,
        pagePath: perm.pagePath,
        pageName: perm.pagePath.replace(/\//g, " ").trim().replace(/-/g, " "),
        canAccess: perm.canAccess,
      })
      .onConflictDoUpdate({
        target: [pagePermissionsTable.roleId, pagePermissionsTable.pagePath],
        set: { canAccess: perm.canAccess },
      });
  }

  const updated = await db
    .select()
    .from(pagePermissionsTable)
    .where(eq(pagePermissionsTable.roleId, roleId))
    .orderBy(pagePermissionsTable.pagePath);

  res.json(updated);
});

export default router;
