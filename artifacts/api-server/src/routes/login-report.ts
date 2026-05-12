import { Router, type IRouter } from "express";
import { eq, and, desc, sql, gte, lte, ilike, or } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";

const router: IRouter = Router();

const LOGIN_ACTIONS = ["LOGIN_SUCCESS", "LOGIN_FAILED", "LOGIN_MFA_REQUIRED", "MFA_VERIFIED", "M365_LOGIN"];

// GET /admin/login-report
router.get("/admin/login-report", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const {
    page = "1",
    pageSize = "50",
    email,
    action,
    from,
    to,
  } = req.query as Record<string, string>;

  const p = Math.max(1, parseInt(page, 10));
  const ps = Math.min(200, Math.max(1, parseInt(pageSize, 10)));

  const conditions = [or(...LOGIN_ACTIONS.map(a => eq(auditLogsTable.action, a)))!];
  if (email?.trim()) conditions.push(ilike(auditLogsTable.userEmail, `%${email.trim()}%`));
  if (action?.trim() && LOGIN_ACTIONS.includes(action.trim())) conditions.push(eq(auditLogsTable.action, action.trim()));
  if (from?.trim()) conditions.push(gte(auditLogsTable.createdAt, new Date(from.trim())));
  if (to?.trim()) conditions.push(lte(auditLogsTable.createdAt, new Date(to.trim())));

  const whereClause = and(...(conditions as [typeof conditions[0], ...typeof conditions]));

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
      ipAddress: auditLogsTable.ipAddress,
      details: auditLogsTable.details,
      createdAt: auditLogsTable.createdAt,
    })
    .from(auditLogsTable)
    .where(whereClause)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(ps)
    .offset((p - 1) * ps);

  // Daily summary (last 30 days) for the chart
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

  const dailyStats = await db
    .select({
      date: sql<string>`date_trunc('day', ${auditLogsTable.createdAt})::date::text`,
      successes: sql<number>`count(*) filter (where ${auditLogsTable.action} = 'LOGIN_SUCCESS')::int`,
      failures: sql<number>`count(*) filter (where ${auditLogsTable.action} = 'LOGIN_FAILED')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(auditLogsTable)
    .where(
      and(
        or(...LOGIN_ACTIONS.map(a => eq(auditLogsTable.action, a)))!,
        gte(auditLogsTable.createdAt, thirtyDaysAgo)
      )
    )
    .groupBy(sql`date_trunc('day', ${auditLogsTable.createdAt})::date`)
    .orderBy(sql`date_trunc('day', ${auditLogsTable.createdAt})::date`);

  res.json({ entries, total: count, page: p, pageSize: ps, dailyStats });
});

export default router;
