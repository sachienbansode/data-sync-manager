import { Router, type IRouter, type Request } from "express";
import { eq, and, desc } from "drizzle-orm";
import fs from "fs";
import path from "path";
import cron from "node-cron";
import {
  db,
  rpaBotsTable,
  rpaBotStepsTable,
  rpaBotCredentialsTable,
  rpaCredentialsTable,
  rpaBotRunsTable,
  rpaBotSchedulesTable,
  pagePermissionsTable,
  rolesTable,
  auditLogsTable,
} from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";
import { encrypt, loadEncryptionKey } from "../lib/crypto";
import { z } from "zod";
import { registerBotSchedule, cancelBotSchedule, computeNextBotRunAt } from "../rpa-scheduler";

// ── Audit logging helper ──────────────────────────────────────────────────────
function logRpaAudit(opts: {
  req?: Request;
  userId?: number | null;
  userEmail?: string | null;
  action: string;
  details: Record<string, unknown>;
  resourceType: string;
  resourceId: string | number;
}): void {
  const { req, userId, userEmail, action, details, resourceType, resourceId } = opts;
  const uid = userId ?? (req?.user?.sub ?? null);
  const email = userEmail ?? (req?.user?.email ?? null);
  const ip = req
    ? (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? null
    : null;
  db.insert(auditLogsTable).values({
    userId: uid,
    userEmail: email,
    action,
    details: JSON.stringify(details),
    ipAddress: ip,
    resourceType,
    resourceId: String(resourceId),
  }).catch(() => {});
}

const router: IRouter = Router();

const RPA_SERVICE_URL = process.env.RPA_SERVICE_URL ?? "http://localhost:8090";

const adminAuth = [authenticate, requireRole("Admin")];

// ── Generic Python proxy helper ───────────────────────────────────────────────
async function proxyToRpa(path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${RPA_SERVICE_URL}${path}`, opts);
}

// ── snake_case → camelCase helpers (normalise Python/asyncpg responses) ────────
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, l: string) => l.toUpperCase());
}

function camelizeKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(camelizeKeys);
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [snakeToCamel(k), camelizeKeys(v)])
    );
  }
  return obj;
}

async function jsonProxy(path: string, opts: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  try {
    const resp = await proxyToRpa(path, opts);
    const raw = await resp.json().catch(() => ({ error: "RPA service returned non-JSON response" }));
    // Normalise FastAPI {detail:...} → {error:...} so the frontend sees a consistent shape
    const body =
      !resp.ok &&
      typeof raw === "object" &&
      raw !== null &&
      "detail" in (raw as object) &&
      !("error" in (raw as object))
        ? { error: (raw as { detail: string }).detail }
        : raw;
    return { status: resp.status, body };
  } catch {
    return { status: 503, body: { error: "RPA service is not reachable. Ensure the RPA Bot Service workflow is running." } };
  }
}

// ── BOTS CRUD ─────────────────────────────────────────────────────────────────

const CreateBotBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  botType: z.enum(["browser_automation", "file_processing", "web_scraping"]).default("browser_automation"),
  notifyEmail: z.string().email().optional().nullable(),
  notifyOn: z.enum(["never", "always", "on_failure"]).default("never"),
});

const UpdateBotBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
  notifyEmail: z.string().email().optional().nullable(),
  notifyOn: z.enum(["never", "always", "on_failure"]).optional(),
});

router.get("/rpa/bots", ...adminAuth, async (_req, res): Promise<void> => {
  const bots = await db.select().from(rpaBotsTable).orderBy(desc(rpaBotsTable.createdAt));

  const schedules = await db
    .select({
      botId: rpaBotSchedulesTable.botId,
      cronExpr: rpaBotSchedulesTable.cronExpr,
      isActive: rpaBotSchedulesTable.isActive,
      lastRunAt: rpaBotSchedulesTable.lastRunAt,
    })
    .from(rpaBotSchedulesTable)
    .where(eq(rpaBotSchedulesTable.isActive, true));

  const scheduleMap = new Map<number, typeof schedules[0]>();
  for (const s of schedules) {
    if (!scheduleMap.has(s.botId)) scheduleMap.set(s.botId, s);
  }

  const result = bots.map((bot) => {
    const sched = scheduleMap.get(bot.id);
    return {
      ...bot,
      scheduleActive: !!sched,
      scheduleCronExpr: sched?.cronExpr ?? null,
      scheduleLastRunAt: sched?.lastRunAt ?? null,
      scheduleNextRunAt: sched ? computeNextBotRunAt(sched.cronExpr) : null,
    };
  });

  res.json(result);
});

router.post("/rpa/bots", ...adminAuth, async (req, res): Promise<void> => {
  const parsed = CreateBotBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid body" }); return; }
  const { name, description, botType, notifyEmail, notifyOn } = parsed.data;
  const [bot] = await db.insert(rpaBotsTable).values({
    name, description, botType,
    notifyEmail: notifyEmail ?? null,
    notifyOn: notifyOn ?? "never",
    createdBy: req.user?.sub ?? null,
  }).returning();
  logRpaAudit({ req, action: "RPA_BOT_CREATED", resourceType: "rpa_bot", resourceId: bot.id, details: { botName: name, botType, notifyEmail: notifyEmail ?? null, notifyOn: notifyOn ?? "never" } });
  res.status(201).json(bot);
});

router.patch("/rpa/bots/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const parsed = UpdateBotBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid body" }); return; }
  const updates = { ...parsed.data, updatedAt: new Date() };
  const [bot] = await db.update(rpaBotsTable).set(updates).where(eq(rpaBotsTable.id, id)).returning();
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }

  if (parsed.data.isActive !== undefined) {
    const schedules = await db
      .select({ id: rpaBotSchedulesTable.id, cronExpr: rpaBotSchedulesTable.cronExpr, isActive: rpaBotSchedulesTable.isActive })
      .from(rpaBotSchedulesTable)
      .where(eq(rpaBotSchedulesTable.botId, id));
    for (const s of schedules) {
      if (bot.isActive && s.isActive) {
        registerBotSchedule(s.id, id, s.cronExpr);
      } else {
        cancelBotSchedule(s.id);
      }
    }
    const action = bot.isActive ? "RPA_BOT_ACTIVATED" : "RPA_BOT_DEACTIVATED";
    logRpaAudit({ req, action, resourceType: "rpa_bot", resourceId: id, details: { botName: bot.name } });
  } else {
    logRpaAudit({ req, action: "RPA_BOT_UPDATED", resourceType: "rpa_bot", resourceId: id, details: { changes: parsed.data } });
  }

  res.json(bot);
});

router.delete("/rpa/bots/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const schedules = await db
    .select({ id: rpaBotSchedulesTable.id })
    .from(rpaBotSchedulesTable)
    .where(eq(rpaBotSchedulesTable.botId, id));
  for (const s of schedules) cancelBotSchedule(s.id);
  const [bot] = await db.delete(rpaBotsTable).where(eq(rpaBotsTable.id, id)).returning();
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  logRpaAudit({ req, action: "RPA_BOT_DELETED", resourceType: "rpa_bot", resourceId: id, details: { botName: bot.name, botType: bot.botType } });
  res.json({ ok: true });
});

// ── STEPS CRUD ────────────────────────────────────────────────────────────────

const UpsertStepBody = z.object({
  stepType: z.enum(["navigate", "fill", "click", "wait", "extract", "screenshot", "select", "key_press", "scroll", "hover"]),
  config: z.record(z.unknown()).default({}),
  description: z.string().max(500).optional(),
  stepOrder: z.number().int().min(0).optional(),
});

router.get("/rpa/bots/:id/steps", ...adminAuth, async (req, res): Promise<void> => {
  const botId = parseInt(req.params.id, 10);
  const steps = await db.select().from(rpaBotStepsTable)
    .where(eq(rpaBotStepsTable.botId, botId))
    .orderBy(rpaBotStepsTable.stepOrder);
  res.json(steps);
});

router.post("/rpa/bots/:id/steps", ...adminAuth, async (req, res): Promise<void> => {
  const botId = parseInt(req.params.id, 10);
  const parsed = UpsertStepBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid body" }); return; }
  const { stepType, config, description, stepOrder } = parsed.data;

  let order = stepOrder;
  if (order === undefined) {
    const existing = await db.select().from(rpaBotStepsTable).where(eq(rpaBotStepsTable.botId, botId));
    order = existing.length;
  }

  const [step] = await db.insert(rpaBotStepsTable).values({
    botId, stepType, config, description, stepOrder: order,
  }).returning();
  logRpaAudit({ req, action: "RPA_STEP_ADDED", resourceType: "rpa_bot", resourceId: botId, details: { stepType, stepOrder: order, description: description ?? null } });
  res.status(201).json(step);
});

router.patch("/rpa/steps/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const parsed = UpsertStepBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid body" }); return; }
  const [step] = await db.update(rpaBotStepsTable).set(parsed.data).where(eq(rpaBotStepsTable.id, id)).returning();
  if (!step) { res.status(404).json({ error: "Step not found" }); return; }
  logRpaAudit({ req, action: "RPA_STEP_UPDATED", resourceType: "rpa_bot", resourceId: step.botId, details: { stepId: id, changes: parsed.data } });
  res.json(step);
});

router.delete("/rpa/steps/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [step] = await db.delete(rpaBotStepsTable).where(eq(rpaBotStepsTable.id, id)).returning();
  if (!step) { res.status(404).json({ error: "Step not found" }); return; }
  logRpaAudit({ req, action: "RPA_STEP_DELETED", resourceType: "rpa_bot", resourceId: step.botId, details: { stepId: id, stepType: step.stepType } });
  res.json({ ok: true });
});

router.put("/rpa/bots/:id/steps", ...adminAuth, async (req, res): Promise<void> => {
  const botId = parseInt(req.params.id, 10);
  const body = z.array(z.object({
    stepType: z.enum(["navigate", "fill", "click", "wait", "extract", "screenshot", "select", "key_press", "scroll", "hover"]),
    config: z.record(z.unknown()).default({}),
    description: z.string().max(500).optional(),
  })).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.errors[0]?.message ?? "Expected array of steps" }); return; }

  const steps = await db.transaction(async (tx) => {
    await tx.delete(rpaBotStepsTable).where(eq(rpaBotStepsTable.botId, botId));
    if (body.data.length === 0) return [];
    return tx.insert(rpaBotStepsTable).values(
      body.data.map((s, i) => ({ botId, stepType: s.stepType, config: s.config ?? {}, description: s.description, stepOrder: i }))
    ).returning();
  });

  logRpaAudit({ req, action: "RPA_STEPS_BULK_REPLACED", resourceType: "rpa_bot", resourceId: botId, details: { stepCount: body.data.length } });
  res.json(steps);
});

router.put("/rpa/bots/:id/steps/reorder", ...adminAuth, async (req, res): Promise<void> => {
  const botId = parseInt(req.params.id, 10);
  const body = z.array(z.object({ id: z.number(), stepOrder: z.number() })).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Expected array of {id, stepOrder}" }); return; }
  await Promise.all(
    body.data.map(({ id, stepOrder }) =>
      db.update(rpaBotStepsTable).set({ stepOrder }).where(and(eq(rpaBotStepsTable.id, id), eq(rpaBotStepsTable.botId, botId)))
    )
  );
  logRpaAudit({ req, action: "RPA_STEPS_REORDERED", resourceType: "rpa_bot", resourceId: botId, details: { stepCount: body.data.length } });
  res.json({ ok: true });
});

// ── CREDENTIALS CRUD ──────────────────────────────────────────────────────────

const CreateCredBody = z.object({
  label: z.string().min(1).max(100),
  username: z.string().min(1),
  password: z.string().min(1),
});

router.get("/rpa/bots/:id/credentials", ...adminAuth, async (req, res): Promise<void> => {
  const botId = parseInt(req.params.id, 10);
  const creds = await db.select({
    id: rpaBotCredentialsTable.id,
    botId: rpaBotCredentialsTable.botId,
    label: rpaBotCredentialsTable.label,
    usernameEnc: rpaBotCredentialsTable.usernameEnc,
    passwordEnc: rpaBotCredentialsTable.passwordEnc,
    createdAt: rpaBotCredentialsTable.createdAt,
  }).from(rpaBotCredentialsTable).where(eq(rpaBotCredentialsTable.botId, botId));
  res.json(creds.map(c => ({
    id: c.id,
    botId: c.botId,
    label: c.label,
    usernameSet: !!c.usernameEnc,
    passwordSet: !!c.passwordEnc,
    createdAt: c.createdAt,
  })));
});

router.post("/rpa/bots/:id/credentials", ...adminAuth, async (req, res): Promise<void> => {
  const botId = parseInt(req.params.id, 10);
  const parsed = CreateCredBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid body" }); return; }
  loadEncryptionKey();
  const { label, username, password } = parsed.data;
  const [cred] = await db.insert(rpaBotCredentialsTable).values({
    botId, label,
    usernameEnc: encrypt(username),
    passwordEnc: encrypt(password),
  }).returning();
  logRpaAudit({ req, action: "RPA_CREDENTIAL_ADDED", resourceType: "rpa_bot", resourceId: botId, details: { credentialId: cred.id, label } });
  res.status(201).json({ id: cred.id, botId: cred.botId, label: cred.label, usernameSet: true, passwordSet: true });
});

router.delete("/rpa/credentials/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [cred] = await db.delete(rpaBotCredentialsTable).where(eq(rpaBotCredentialsTable.id, id)).returning();
  if (!cred) { res.status(404).json({ error: "Credential not found" }); return; }
  logRpaAudit({ req, action: "RPA_CREDENTIAL_DELETED", resourceType: "rpa_bot", resourceId: cred.botId, details: { credentialId: id, label: cred.label } });
  res.json({ ok: true });
});

// ── SCHEDULES CRUD ────────────────────────────────────────────────────────────

const CreateScheduleBody = z.object({
  cronExpr: z.string().min(1).max(100),
  isActive: z.boolean().default(false),
});

async function applyScheduleState(schedule: { id: number; botId: number; cronExpr: string; isActive: boolean }): Promise<void> {
  if (schedule.isActive) {
    const [bot] = await db.select({ isActive: rpaBotsTable.isActive }).from(rpaBotsTable).where(eq(rpaBotsTable.id, schedule.botId));
    if (bot?.isActive) {
      registerBotSchedule(schedule.id, schedule.botId, schedule.cronExpr);
    } else {
      cancelBotSchedule(schedule.id);
    }
  } else {
    cancelBotSchedule(schedule.id);
  }
}

router.get("/rpa/bots/:id/schedules", ...adminAuth, async (req, res): Promise<void> => {
  const botId = parseInt(req.params.id, 10);
  const schedules = await db.select().from(rpaBotSchedulesTable)
    .where(eq(rpaBotSchedulesTable.botId, botId));
  res.json(schedules);
});

router.post("/rpa/bots/:id/schedules", ...adminAuth, async (req, res): Promise<void> => {
  const botId = parseInt(req.params.id, 10);
  const parsed = CreateScheduleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid body" }); return; }
  if (!cron.validate(parsed.data.cronExpr)) { res.status(400).json({ error: "Invalid cron expression" }); return; }
  const [schedule] = await db.insert(rpaBotSchedulesTable).values({ botId, ...parsed.data }).returning();
  await applyScheduleState(schedule);
  logRpaAudit({ req, action: "RPA_SCHEDULE_CREATED", resourceType: "rpa_bot", resourceId: botId, details: { scheduleId: schedule.id, cronExpr: parsed.data.cronExpr, isActive: parsed.data.isActive } });
  res.status(201).json(schedule);
});

router.patch("/rpa/bots/:botId/schedules/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const botId = parseInt(req.params.botId, 10);
  const parsed = CreateScheduleBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid body" }); return; }
  if (parsed.data.cronExpr !== undefined && !cron.validate(parsed.data.cronExpr)) { res.status(400).json({ error: "Invalid cron expression" }); return; }
  const [schedule] = await db.update(rpaBotSchedulesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(rpaBotSchedulesTable.id, id), eq(rpaBotSchedulesTable.botId, botId))).returning();
  if (!schedule) { res.status(404).json({ error: "Schedule not found" }); return; }
  await applyScheduleState(schedule);
  logRpaAudit({ req, action: "RPA_SCHEDULE_UPDATED", resourceType: "rpa_bot", resourceId: botId, details: { scheduleId: id, changes: parsed.data } });
  res.json(schedule);
});

router.delete("/rpa/bots/:botId/schedules/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const botId = parseInt(req.params.botId, 10);
  const [schedule] = await db.delete(rpaBotSchedulesTable)
    .where(and(eq(rpaBotSchedulesTable.id, id), eq(rpaBotSchedulesTable.botId, botId))).returning();
  if (!schedule) { res.status(404).json({ error: "Schedule not found" }); return; }
  cancelBotSchedule(id);
  logRpaAudit({ req, action: "RPA_SCHEDULE_DELETED", resourceType: "rpa_bot", resourceId: botId, details: { scheduleId: id, cronExpr: schedule.cronExpr } });
  res.json({ ok: true });
});

router.patch("/rpa/schedules/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const parsed = CreateScheduleBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid body" }); return; }
  if (parsed.data.cronExpr !== undefined && !cron.validate(parsed.data.cronExpr)) { res.status(400).json({ error: "Invalid cron expression" }); return; }
  const [schedule] = await db.update(rpaBotSchedulesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(rpaBotSchedulesTable.id, id)).returning();
  if (!schedule) { res.status(404).json({ error: "Schedule not found" }); return; }
  await applyScheduleState(schedule);
  logRpaAudit({ req, action: "RPA_SCHEDULE_UPDATED", resourceType: "rpa_bot", resourceId: schedule.botId, details: { scheduleId: id, changes: parsed.data } });
  res.json(schedule);
});

router.delete("/rpa/schedules/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [schedule] = await db.delete(rpaBotSchedulesTable).where(eq(rpaBotSchedulesTable.id, id)).returning();
  if (!schedule) { res.status(404).json({ error: "Schedule not found" }); return; }
  cancelBotSchedule(id);
  logRpaAudit({ req, action: "RPA_SCHEDULE_DELETED", resourceType: "rpa_bot", resourceId: schedule.botId, details: { scheduleId: id, cronExpr: schedule.cronExpr } });
  res.json({ ok: true });
});

// ── RUNS — proxy to Python ────────────────────────────────────────────────────

router.get("/rpa/bots/:id/runs", ...adminAuth, async (req, res): Promise<void> => {
  const botId = parseInt(req.params.id, 10);
  const { status, body } = await jsonProxy(`/bots/${botId}/runs`);
  res.status(status).json(status === 200 ? camelizeKeys(body) : body);
});

router.post("/rpa/bots/:id/run", ...adminAuth, async (req, res): Promise<void> => {
  const botId = parseInt(req.params.id, 10);
  // Verify bot exists at Node layer before calling Python
  const [bot] = await db.select({ id: rpaBotsTable.id, isActive: rpaBotsTable.isActive })
    .from(rpaBotsTable).where(eq(rpaBotsTable.id, botId));
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  if (!bot.isActive) { res.status(400).json({ error: "Bot is inactive" }); return; }

  const { status, body } = await jsonProxy(`/bots/${botId}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      triggeredBy: req.user?.sub ?? null,
      triggeredByEmail: req.user?.email ?? null,
    }),
  });
  if (status >= 200 && status < 300) {
    const camel = camelizeKeys(body) as { id?: number };
    logRpaAudit({ req, action: "RPA_RUN_TRIGGERED", resourceType: "rpa_bot", resourceId: botId, details: { runId: camel.id ?? null, trigger: "manual" } });
    res.status(status).json(camel);
  } else {
    res.status(status).json(body);
  }
});

// ── LOGS — proxy to Python ────────────────────────────────────────────────────

router.get("/rpa/runs/:id/logs", ...adminAuth, async (req, res): Promise<void> => {
  const runId = parseInt(req.params.id, 10);
  const { status, body } = await jsonProxy(`/runs/${runId}/logs`);
  res.status(status).json(status === 200 ? camelizeKeys(body) : body);
});

// ── SSE stream — proxy to Python ──────────────────────────────────────────────

router.get("/rpa/runs/:id/stream", ...adminAuth, async (req, res): Promise<void> => {
  const runId = parseInt(req.params.id, 10);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let pyResp: Response;
  try {
    pyResp = await proxyToRpa(`/runs/${runId}/stream`);
  } catch {
    res.write(`data: ${JSON.stringify({ level: "error", message: "RPA service unreachable" })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    return;
  }

  if (!pyResp.ok) {
    let detail = `Upstream error ${pyResp.status}`;
    try {
      const errBody = await pyResp.json() as { detail?: string; error?: string };
      detail = errBody.detail ?? errBody.error ?? detail;
    } catch { /* non-JSON body */ }
    res.write(`data: ${JSON.stringify({ level: "error", message: detail })}\n\n`);
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    return;
  }

  if (!pyResp.body) {
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
    return;
  }

  const reader = pyResp.body.getReader();
  const decoder = new TextDecoder();
  req.on("close", () => reader.cancel().catch(() => {}));

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }
  } catch {
    // client disconnected
  } finally {
    res.end();
  }
});

// ── SCREENSHOT — serve file ───────────────────────────────────────────────────

router.get("/rpa/runs/:id/screenshot", ...adminAuth, async (req, res): Promise<void> => {
  const runId = parseInt(req.params.id, 10);
  const [run] = await db.select({ screenshotPath: rpaBotRunsTable.screenshotPath }).from(rpaBotRunsTable).where(eq(rpaBotRunsTable.id, runId));
  if (!run) { res.status(404).json({ error: "Run not found" }); return; }
  if (!run?.screenshotPath) { res.status(404).json({ error: "No screenshot for this run" }); return; }

  const filePath = run.screenshotPath;
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Screenshot file not found on server" }); return; }

  res.setHeader("Cache-Control", "max-age=3600");
  res.sendFile(path.resolve(filePath), { headers: { "Content-Type": "image/png" } });
});

// ── SEED reference bot ────────────────────────────────────────────────────────

router.post("/rpa/seed", ...adminAuth, async (req, res): Promise<void> => {
  const existing = await db.select().from(rpaBotsTable).limit(1);
  if (existing.length > 0) {
    res.json({ ok: true, message: "Bots already exist, skipping seed" });
    return;
  }

  const [bot] = await db.insert(rpaBotsTable).values({
    name: "Data Preview Automation",
    description: "Reference bot: logs into the platform, navigates to Data Preview, selects the first DB connection, runs a sample query, and screenshots the result.",
    botType: "browser_automation",
    isActive: true,
    createdBy: req.user?.sub ?? null,
  }).returning();

  const appUrl = process.env.APP_URL ?? "http://localhost:22333";

  const steps = [
    // Login flow
    { stepOrder: 0,  stepType: "navigate"    as const, config: { url: appUrl },                                                                         description: "Open app login page" },
    { stepOrder: 1,  stepType: "fill"        as const, config: { selector: "input[type=email], input[name=email]", cred_label: "admin", cred_field: "username" }, description: "Fill email" },
    { stepOrder: 2,  stepType: "fill"        as const, config: { selector: "input[type=password]",                  cred_label: "admin", cred_field: "password" }, description: "Fill password" },
    { stepOrder: 3,  stepType: "click"       as const, config: { selector: "button[type=submit]" },                                                      description: "Submit login form" },
    { stepOrder: 4,  stepType: "wait"        as const, config: { ms: 3000 },                                                                             description: "Wait for dashboard to load" },
    // Navigate to Data Preview
    { stepOrder: 5,  stepType: "navigate"    as const, config: { url: `${appUrl}/preview` },                                                             description: "Navigate to Data Preview page" },
    { stepOrder: 6,  stepType: "wait"        as const, config: { ms: 2000 },                                                                             description: "Wait for page load" },
    // Select a DB connection from the combobox
    { stepOrder: 7,  stepType: "click"       as const, config: { selector: "[role=combobox]" },                                                          description: "Open connection selector" },
    { stepOrder: 8,  stepType: "wait"        as const, config: { ms: 500 },                                                                              description: "Wait for dropdown" },
    { stepOrder: 9,  stepType: "click"       as const, config: { selector: "[role=option]:first-child" },                                                description: "Select first connection" },
    { stepOrder: 10, stepType: "wait"        as const, config: { ms: 500 },                                                                              description: "Wait for selection" },
    // Type a sample query
    { stepOrder: 11, stepType: "fill"        as const, config: { selector: "textarea", value: "SELECT 1 AS test_col, NOW() AS current_time" },            description: "Enter sample SQL query" },
    // Run the query
    { stepOrder: 12, stepType: "click"       as const, config: { selector: "button:has-text('Run'), button:has-text('Preview'), button[aria-label*='Run']" }, description: "Click Run / Preview button" },
    { stepOrder: 13, stepType: "wait"        as const, config: { ms: 3000 },                                                                             description: "Wait for query results" },
    // Screenshot result
    { stepOrder: 14, stepType: "screenshot"  as const, config: { full_page: false },                                                                     description: "Capture result screenshot" },
  ];

  await db.insert(rpaBotStepsTable).values(steps.map(s => ({ ...s, botId: bot.id })));

  res.status(201).json({ ok: true, bot });
});

export default router;

// ── Auto-seed on first startup ────────────────────────────────────────────────
// Called from index.ts at server startup. Inserts the reference bot exactly
// once when the rpa_bots table is empty (idempotent).
export async function seedRpaBotsIfEmpty(): Promise<void> {
  const existing = await db.select({ id: rpaBotsTable.id }).from(rpaBotsTable).limit(1);
  if (existing.length > 0) return;

  const appUrl = process.env.APP_URL ?? "http://localhost:22333";

  const [bot] = await db.insert(rpaBotsTable).values({
    name: "Data Preview Automation",
    description: "Reference bot: logs into the platform, navigates to Data Preview, selects the first DB connection, runs a sample query, and screenshots the result.",
    botType: "browser_automation",
    isActive: true,
    createdBy: null,
  }).returning();

  const steps = [
    { stepOrder: 0,  stepType: "navigate"   as const, config: { url: appUrl },                                                                            description: "Open app login page" },
    { stepOrder: 1,  stepType: "fill"       as const, config: { selector: "input[type=email], input[name=email]", cred_label: "admin", cred_field: "username" }, description: "Fill email from credential" },
    { stepOrder: 2,  stepType: "fill"       as const, config: { selector: "input[type=password]", cred_label: "admin", cred_field: "password" },           description: "Fill password from credential" },
    { stepOrder: 3,  stepType: "click"      as const, config: { selector: "button[type=submit]" },                                                         description: "Submit login form" },
    { stepOrder: 4,  stepType: "wait"       as const, config: { ms: 3000 },                                                                                description: "Wait for dashboard to load" },
    { stepOrder: 5,  stepType: "navigate"   as const, config: { url: `${appUrl}/preview` },                                                                description: "Navigate to Data Preview page" },
    { stepOrder: 6,  stepType: "wait"       as const, config: { ms: 2000 },                                                                                description: "Wait for page load" },
    { stepOrder: 7,  stepType: "click"      as const, config: { selector: "[role=combobox]" },                                                             description: "Open connection selector dropdown" },
    { stepOrder: 8,  stepType: "wait"       as const, config: { ms: 500 },                                                                                 description: "Wait for dropdown to open" },
    { stepOrder: 9,  stepType: "click"      as const, config: { selector: "[role=option]:first-child" },                                                   description: "Select first available connection" },
    { stepOrder: 10, stepType: "wait"       as const, config: { ms: 500 },                                                                                 description: "Wait for connection to be selected" },
    { stepOrder: 11, stepType: "fill"       as const, config: { selector: "textarea", value: "SELECT 1 AS test_col, NOW() AS current_time" },              description: "Enter sample SQL query" },
    { stepOrder: 12, stepType: "click"      as const, config: { selector: "button:has-text('Run'), button:has-text('Preview'), button[aria-label*='Run']" }, description: "Click Run / Preview button" },
    { stepOrder: 13, stepType: "wait"       as const, config: { ms: 3000 },                                                                                description: "Wait for query results" },
    { stepOrder: 14, stepType: "screenshot" as const, config: { full_page: false },                                                                        description: "Capture screenshot of results" },
  ];

  await db.insert(rpaBotStepsTable).values(steps.map(s => ({ ...s, botId: bot.id })));
}

// ── Global Credential Vault ───────────────────────────────────────────────────

router.get("/rpa/credentials", ...adminAuth, async (_req, res): Promise<void> => {
  const rows = await db.select({
    id: rpaCredentialsTable.id,
    name: rpaCredentialsTable.name,
    description: rpaCredentialsTable.description,
    notes: rpaCredentialsTable.notes,
    usernameEnc: rpaCredentialsTable.usernameEnc,
    passwordEnc: rpaCredentialsTable.passwordEnc,
    createdAt: rpaCredentialsTable.createdAt,
    updatedAt: rpaCredentialsTable.updatedAt,
  }).from(rpaCredentialsTable).orderBy(rpaCredentialsTable.name);
  res.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    notes: r.notes,
    hasUsername: !!r.usernameEnc,
    hasPassword: !!r.passwordEnc,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })));
});

router.post("/rpa/credentials", ...adminAuth, async (req, res): Promise<void> => {
  const { name, description, username, password, notes } = req.body as {
    name?: string; description?: string; username?: string; password?: string; notes?: string;
  };
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  try {
    const key = loadEncryptionKey();
    const [row] = await db.insert(rpaCredentialsTable).values({
      name: name.trim(),
      description: description?.trim() || null,
      usernameEnc: username ? encrypt(username, key) : null,
      passwordEnc: password ? encrypt(password, key) : null,
      notes: notes?.trim() || null,
      createdBy: req.user?.sub ?? null,
    }).returning();
    logRpaAudit({ req, action: "RPA_CREDENTIAL_CREATED", details: { name: name.trim() }, resourceType: "rpa_credential", resourceId: row!.id });
    res.json({ id: row!.id, name: row!.name });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "23505") { res.status(409).json({ error: "A credential with that name already exists" }); return; }
    throw e;
  }
});

router.put("/rpa/credentials/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { name, description, username, password, notes } = req.body as {
    name?: string; description?: string; username?: string; password?: string; notes?: string;
  };
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  const key = loadEncryptionKey();
  const updates: Record<string, unknown> = {
    name: name.trim(),
    description: description?.trim() || null,
    notes: notes?.trim() || null,
    updatedAt: new Date(),
  };
  if (username) updates.usernameEnc = encrypt(username, key);
  if (password) updates.passwordEnc = encrypt(password, key);
  try {
    await db.update(rpaCredentialsTable).set(updates).where(eq(rpaCredentialsTable.id, id));
    logRpaAudit({ req, action: "RPA_CREDENTIAL_UPDATED", details: { id, name: name.trim() }, resourceType: "rpa_credential", resourceId: id });
    res.json({ success: true });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "23505") { res.status(409).json({ error: "A credential with that name already exists" }); return; }
    throw e;
  }
});

router.delete("/rpa/credentials/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.select({ name: rpaCredentialsTable.name }).from(rpaCredentialsTable).where(eq(rpaCredentialsTable.id, id));
  await db.delete(rpaCredentialsTable).where(eq(rpaCredentialsTable.id, id));
  logRpaAudit({ req, action: "RPA_CREDENTIAL_DELETED", details: { id, name: row?.name }, resourceType: "rpa_credential", resourceId: id });
  res.status(204).send();
});

// ── Idempotent page-permission bootstrap ──────────────────────────────────────
// Upserts the /admin/rpa-bots page permission row for every existing role so
// that existing databases (not re-seeded from scratch) gain access immediately.
// Admin gets canAccess=true; all other roles default to false.
export async function seedRpaPagePermissions(): Promise<void> {
  const roles = await db.select({ id: rolesTable.id, name: rolesTable.name }).from(rolesTable);
  const pages = [
    { pagePath: "/admin/rpa-bots", pageName: "RPA Bots" },
    { pagePath: "/admin/rpa-credentials", pageName: "RPA Credential Vault" },
  ];
  for (const role of roles) {
    const canAccess = role.name === "Admin";
    for (const page of pages) {
      await db
        .insert(pagePermissionsTable)
        .values({ roleId: role.id, pagePath: page.pagePath, pageName: page.pageName, canAccess })
        .onConflictDoUpdate({
          target: [pagePermissionsTable.roleId, pagePermissionsTable.pagePath],
          set: { pageName: page.pageName, canAccess },
        });
    }
  }
}
