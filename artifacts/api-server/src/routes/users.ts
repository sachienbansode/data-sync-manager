import { Router, type IRouter } from "express";
import { eq, ilike, and, or, sql } from "drizzle-orm";
import { db, usersTable, rolesTable, mfaSecretsTable, auditLogsTable } from "@workspace/db";
import {
  CreateUserBody,
  UpdateUserBody,
  UpdateUserStatusBody,
  UpdateUserRoleBody,
  GetUserParams,
  UpdateUserParams,
  DeleteUserParams,
  UpdateUserStatusParams,
  UpdateUserRoleParams,
  ResetUserMfaParams,
  ListUsersQueryParams,
} from "@workspace/api-zod";
import { hashPassword } from "../lib/auth";
import { authenticate, requireRole } from "../middlewares/authenticate";

const router: IRouter = Router();

function buildUserSelect() {
  return db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      roleId: usersTable.roleId,
      roleName: rolesTable.name,
      isActive: usersTable.isActive,
      mfaEnabled: usersTable.mfaEnabled,
      authProvider: usersTable.authProvider,
      createdAt: usersTable.createdAt,
      lastLoginAt: usersTable.lastLoginAt,
    })
    .from(usersTable)
    .innerJoin(rolesTable, eq(usersTable.roleId, rolesTable.id));
}

// GET /users
router.get("/users", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const params = ListUsersQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { search, roleId, isActive, page = 1, pageSize = 20 } = params.data;

  const conditions = [];
  if (search) {
    conditions.push(
      or(
        ilike(usersTable.email, `%${search}%`),
        ilike(usersTable.firstName, `%${search}%`),
        ilike(usersTable.lastName, `%${search}%`)
      )
    );
  }
  if (roleId != null) conditions.push(eq(usersTable.roleId, roleId));
  if (isActive != null) conditions.push(eq(usersTable.isActive, isActive));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(whereClause);

  const users = await buildUserSelect()
    .where(whereClause)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .orderBy(usersTable.createdAt);

  res.json({ users, total: count, page, pageSize });
});

// POST /users
router.post("/users", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, firstName, lastName, roleId, password, authProvider } = parsed.data;

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()));

  if (existing) {
    res.status(409).json({ error: "Email already exists" });
    return;
  }

  const passwordHash = password ? await hashPassword(password) : null;

  const [user] = await db
    .insert(usersTable)
    .values({
      email: email.toLowerCase(),
      firstName,
      lastName,
      roleId,
      passwordHash,
      authProvider: authProvider ?? "local",
    })
    .returning({ id: usersTable.id });

  if (!user) {
    res.status(500).json({ error: "Failed to create user" });
    return;
  }

  const [created] = await buildUserSelect().where(eq(usersTable.id, user.id));
  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "USER_CREATED",
    details: `Created user ${email}`,
    ipAddress: req.ip ?? null,
  });

  res.status(201).json(created);
});

// GET /users/:id
router.get("/users/:id", authenticate, async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (req.user!.roleName !== "Admin" && req.user!.roleName !== "Manager" && req.user!.sub !== params.data.id) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }

  const [user] = await buildUserSelect().where(eq(usersTable.id, params.data.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(user);
});

// PATCH /users/:id
router.patch("/users/:id", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateUserBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const updateData: Partial<typeof usersTable.$inferInsert> = {};
  if (body.data.firstName != null) updateData.firstName = body.data.firstName;
  if (body.data.lastName != null) updateData.lastName = body.data.lastName;
  if (body.data.roleId != null) updateData.roleId = body.data.roleId;

  await db.update(usersTable).set(updateData).where(eq(usersTable.id, params.data.id));

  const [user] = await buildUserSelect().where(eq(usersTable.id, params.data.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(user);
});

// DELETE /users/:id
router.delete("/users/:id", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (params.data.id === req.user!.sub) {
    res.status(400).json({ error: "Cannot delete your own account" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await db.delete(usersTable).where(eq(usersTable.id, params.data.id));
  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "USER_DELETED",
    details: `Deleted user ${user.email}`,
    ipAddress: req.ip ?? null,
  });

  res.sendStatus(204);
});

// PATCH /users/:id/status
router.patch("/users/:id/status", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const params = UpdateUserStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateUserStatusBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  if (params.data.id === req.user!.sub) {
    res.status(400).json({ error: "Cannot change your own status" });
    return;
  }

  await db
    .update(usersTable)
    .set({ isActive: body.data.isActive })
    .where(eq(usersTable.id, params.data.id));

  const [user] = await buildUserSelect().where(eq(usersTable.id, params.data.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: body.data.isActive ? "USER_ENABLED" : "USER_DISABLED",
    details: `${body.data.isActive ? "Enabled" : "Disabled"} user ${user.email}`,
    ipAddress: req.ip ?? null,
  });

  res.json(user);
});

// PATCH /users/:id/role
router.patch("/users/:id/role", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const params = UpdateUserRoleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateUserRoleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  await db
    .update(usersTable)
    .set({ roleId: body.data.roleId })
    .where(eq(usersTable.id, params.data.id));

  const [user] = await buildUserSelect().where(eq(usersTable.id, params.data.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "ROLE_CHANGED",
    details: `Changed role for ${user.email} to ${user.roleName}`,
    ipAddress: req.ip ?? null,
  });

  res.json(user);
});

// POST /users/:id/reset-mfa
router.post("/users/:id/reset-mfa", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const params = ResetUserMfaParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db.update(usersTable).set({ mfaEnabled: false }).where(eq(usersTable.id, params.data.id));
  await db.delete(mfaSecretsTable).where(eq(mfaSecretsTable.userId, params.data.id));

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));

  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "MFA_RESET",
    details: `Reset MFA for user ${user?.email}`,
    ipAddress: req.ip ?? null,
  });

  res.json({ success: true });
});

export default router;
