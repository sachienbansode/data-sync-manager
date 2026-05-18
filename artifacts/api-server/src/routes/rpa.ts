import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import fs from "fs";
import path from "path";
import {
  db,
  rpaBotsTable,
  rpaBotStepsTable,
  rpaBotCredentialsTable,
  rpaBotRunsTable,
  rpaBotSchedulesTable,
  pagePermissionsTable,
  rolesTable,
} from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";
import { encrypt, loadEncryptionKey } from "../lib/crypto";
import { z } from "zod";

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
});

const UpdateBotBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
});

router.get("/rpa/bots", ...adminAuth, async (_req, res): Promise<void> => {
  const bots = await db.select().from(rpaBotsTable).orderBy(desc(rpaBotsTable.createdAt));
  res.json(bots);
});

router.post("/rpa/bots", ...adminAuth, async (req, res): Promise<void> => {
  const parsed = CreateBotBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid body" }); return; }
  const { name, description, botType } = parsed.data;
  const [bot] = await db.insert(rpaBotsTable).values({
    name, description, botType,
    createdBy: req.user?.sub ?? null,
  }).returning();
  res.status(201).json(bot);
});

router.patch("/rpa/bots/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const parsed = UpdateBotBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid body" }); return; }
  const updates = { ...parsed.data, updatedAt: new Date() };
  const [bot] = await db.update(rpaBotsTable).set(updates).where(eq(rpaBotsTable.id, id)).returning();
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  res.json(bot);
});

router.delete("/rpa/bots/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [bot] = await db.delete(rpaBotsTable).where(eq(rpaBotsTable.id, id)).returning();
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
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
  res.status(201).json(step);
});

router.patch("/rpa/steps/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const parsed = UpsertStepBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid body" }); return; }
  const [step] = await db.update(rpaBotStepsTable).set(parsed.data).where(eq(rpaBotStepsTable.id, id)).returning();
  if (!step) { res.status(404).json({ error: "Step not found" }); return; }
  res.json(step);
});

router.delete("/rpa/steps/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [step] = await db.delete(rpaBotStepsTable).where(eq(rpaBotStepsTable.id, id)).returning();
  if (!step) { res.status(404).json({ error: "Step not found" }); return; }
  res.json({ ok: true });
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
  res.status(201).json({ id: cred.id, botId: cred.botId, label: cred.label, usernameSet: true, passwordSet: true });
});

router.delete("/rpa/credentials/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [cred] = await db.delete(rpaBotCredentialsTable).where(eq(rpaBotCredentialsTable.id, id)).returning();
  if (!cred) { res.status(404).json({ error: "Credential not found" }); return; }
  res.json({ ok: true });
});

// ── SCHEDULES CRUD ────────────────────────────────────────────────────────────

const CreateScheduleBody = z.object({
  cronExpr: z.string().min(1).max(100),
  isActive: z.boolean().default(false),
});

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
  const [schedule] = await db.insert(rpaBotSchedulesTable).values({
    botId, ...parsed.data,
  }).returning();
  res.status(201).json(schedule);
});

router.patch("/rpa/schedules/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const parsed = CreateScheduleBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid body" }); return; }
  const [schedule] = await db.update(rpaBotSchedulesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(rpaBotSchedulesTable.id, id)).returning();
  if (!schedule) { res.status(404).json({ error: "Schedule not found" }); return; }
  res.json(schedule);
});

router.delete("/rpa/schedules/:id", ...adminAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [schedule] = await db.delete(rpaBotSchedulesTable).where(eq(rpaBotSchedulesTable.id, id)).returning();
  if (!schedule) { res.status(404).json({ error: "Schedule not found" }); return; }
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
  res.status(status).json(status === 201 ? camelizeKeys(body) : body);
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

// ── Idempotent page-permission bootstrap ──────────────────────────────────────
// Upserts the /admin/rpa-bots page permission row for every existing role so
// that existing databases (not re-seeded from scratch) gain access immediately.
// Admin gets canAccess=true; all other roles default to false.
export async function seedRpaPagePermissions(): Promise<void> {
  const roles = await db.select({ id: rolesTable.id, name: rolesTable.name }).from(rolesTable);
  for (const role of roles) {
    const canAccess = role.name === "Admin";
    await db
      .insert(pagePermissionsTable)
      .values({ roleId: role.id, pagePath: "/admin/rpa-bots", pageName: "RPA Bots", canAccess })
      .onConflictDoUpdate({
        target: [pagePermissionsTable.roleId, pagePermissionsTable.pagePath],
        set: { pageName: "RPA Bots", canAccess },
      });
  }
}
