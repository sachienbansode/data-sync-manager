import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, rolesTable, pagePermissionsTable, usersTable } from "@workspace/db";
import {
  GetRolePagePermissionsParams,
  UpdateRolePagePermissionsParams,
  UpdateRolePagePermissionsBody,
} from "@workspace/api-zod";
import { authenticate, requireRole } from "../middlewares/authenticate";

const router: IRouter = Router();

// GET /roles
router.get("/roles", authenticate, async (_req, res): Promise<void> => {
  const roles = await db
    .select({
      id: rolesTable.id,
      name: rolesTable.name,
      description: rolesTable.description,
      userCount: sql<number>`count(${usersTable.id})::int`,
    })
    .from(rolesTable)
    .leftJoin(usersTable, eq(usersTable.roleId, rolesTable.id))
    .groupBy(rolesTable.id)
    .orderBy(rolesTable.id);

  res.json(roles);
});

// GET /roles/:id/page-permissions
router.get("/roles/:id/page-permissions", authenticate, async (req, res): Promise<void> => {
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
router.put("/roles/:id/page-permissions", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
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
        pageName: perm.pagePath.replace(/\//g, "").replace(/-/g, " "),
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
