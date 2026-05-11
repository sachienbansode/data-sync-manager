import { Router, type IRouter } from "express";
import { eq, sql, desc, and } from "drizzle-orm";
import { db, usersTable, rolesTable, auditLogsTable } from "@workspace/db";
import { GetAuditLogQueryParams } from "@workspace/api-zod";
import { authenticate, requireRole, requirePageAccess } from "../middlewares/authenticate";

const router: IRouter = Router();

// GET /dashboard/summary
router.get("/dashboard/summary", authenticate, requirePageAccess("/dashboard"), async (_req, res): Promise<void> => {
  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${usersTable.isActive} = true)::int`,
      inactive: sql<number>`count(*) filter (where ${usersTable.isActive} = false)::int`,
      mfaEnabled: sql<number>`count(*) filter (where ${usersTable.mfaEnabled} = true)::int`,
    })
    .from(usersTable);

  const usersByRole = await db
    .select({
      roleName: rolesTable.name,
      count: sql<number>`count(${usersTable.id})::int`,
    })
    .from(rolesTable)
    .leftJoin(usersTable, eq(usersTable.roleId, rolesTable.id))
    .groupBy(rolesTable.id, rolesTable.name)
    .orderBy(rolesTable.id);

  const recentLogins = await db
    .select({
      id: auditLogsTable.id,
      userId: auditLogsTable.userId,
      userEmail: auditLogsTable.userEmail,
      action: auditLogsTable.action,
      details: auditLogsTable.details,
      ipAddress: auditLogsTable.ipAddress,
      createdAt: auditLogsTable.createdAt,
    })
    .from(auditLogsTable)
    .where(eq(auditLogsTable.action, "LOGIN_SUCCESS"))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(10);

  res.json({
    totalUsers: totals?.total ?? 0,
    activeUsers: totals?.active ?? 0,
    inactiveUsers: totals?.inactive ?? 0,
    mfaEnabledUsers: totals?.mfaEnabled ?? 0,
    usersByRole,
    recentLogins,
  });
});

// GET /dashboard/audit-log
router.get("/dashboard/audit-log", authenticate, requirePageAccess("/audit-log"), requireRole("Admin"), async (req, res): Promise<void> => {
  const params = GetAuditLogQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { page = 1, pageSize = 50, userId, action } = params.data;

  const conditions = [];
  if (userId != null) conditions.push(eq(auditLogsTable.userId, userId));
  if (action != null) conditions.push(eq(auditLogsTable.action, action));

  const whereClause = conditions.length > 1
    ? and(...(conditions as [typeof conditions[0], typeof conditions[0], ...typeof conditions]))
    : conditions.length === 1
    ? conditions[0]
    : undefined;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogsTable)
    .where(whereClause);

  const entries = await db
    .select({
      id: auditLogsTable.id,
      userId: auditLogsTable.userId,
      userEmail: auditLogsTable.userEmail,
      action: auditLogsTable.action,
      details: auditLogsTable.details,
      ipAddress: auditLogsTable.ipAddress,
      resourceType: auditLogsTable.resourceType,
      resourceId: auditLogsTable.resourceId,
      fieldName: auditLogsTable.fieldName,
      createdAt: auditLogsTable.createdAt,
    })
    .from(auditLogsTable)
    .where(whereClause)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  res.json({ entries, total: count, page, pageSize });
});

// POST /dashboard/audit-log/export-record — internal audit event when a user downloads the audit log
router.post("/dashboard/audit-log/export-record", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const { filter, count } = req.body as { filter?: string; count?: number };
  await db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "AUDIT_LOG_EXPORTED",
    details: `Exported ${count ?? 0} records${filter && filter !== "all" ? ` (filter: ${filter})` : ""}`,
    ipAddress: req.ip ?? null,
  });
  res.json({ success: true });
});

export default router;
