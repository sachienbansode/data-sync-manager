import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import {
  db,
  rpaBotsTable,
  rpaBotStepsTable,
  rpaBotCredentialsTable,
  rpaBotRunsTable,
  rpaBotLogsTable,
} from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";
import { encrypt, decrypt, loadEncryptionKey } from "../lib/crypto";
import { z } from "zod";

const router: IRouter = Router();

const RPA_SERVICE_URL = process.env.RPA_SERVICE_URL ?? "http://localhost:8090";

const adminAuth = [authenticate, requireRole("Admin")];

// ── Helpers ───────────────────────────────────────────────────────────────────
async function proxyToRpa(path: string, opts: RequestInit = {}) {
  const resp = await fetch(`${RPA_SERVICE_URL}${path}`, opts);
  return resp;
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
    createdBy: req.user?.userId ?? null,
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

  // Default order: append at end
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

// Reorder steps — accepts [{id, stepOrder}]
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
    usernameSet: rpaBotCredentialsTable.usernameEnc,
    createdAt: rpaBotCredentialsTable.createdAt,
  }).from(rpaBotCredentialsTable).where(eq(rpaBotCredentialsTable.botId, botId));
  // Return masked — never expose decrypted values
  res.json(creds.map(c => ({ ...c, usernameSet: !!c.usernameSet, passwordSet: true })));
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

// ── RUNS ──────────────────────────────────────────────────────────────────────

router.get("/rpa/bots/:id/runs", ...adminAuth, async (req, res): Promise<void> => {
  const botId = parseInt(req.params.id, 10);
  const runs = await db.select().from(rpaBotRunsTable)
    .where(eq(rpaBotRunsTable.botId, botId))
    .orderBy(desc(rpaBotRunsTable.createdAt))
    .limit(50);
  res.json(runs);
});

router.post("/rpa/bots/:id/run", ...adminAuth, async (req, res): Promise<void> => {
  const botId = parseInt(req.params.id, 10);
  const [bot] = await db.select().from(rpaBotsTable).where(eq(rpaBotsTable.id, botId));
  if (!bot) { res.status(404).json({ error: "Bot not found" }); return; }
  if (!bot.isActive) { res.status(400).json({ error: "Bot is inactive" }); return; }

  const [run] = await db.insert(rpaBotRunsTable).values({
    botId,
    status: "pending",
    triggeredBy: req.user?.userId ?? null,
    triggeredByEmail: req.user?.email ?? null,
  }).returning();

  // Call Python service to execute
  try {
    const pyResp = await proxyToRpa(`/internal/runs/${run.id}/execute`, { method: "POST" });
    if (!pyResp.ok) {
      const err = await pyResp.json().catch(() => ({ detail: "RPA service error" }));
      res.status(pyResp.status).json({ error: (err as { detail?: string }).detail ?? "RPA service error" });
      return;
    }
  } catch (e) {
    // RPA service unreachable — mark run as failed
    await db.update(rpaBotRunsTable).set({
      status: "failed",
      errorMessage: "RPA service is not reachable",
      startedAt: new Date(),
      finishedAt: new Date(),
    }).where(eq(rpaBotRunsTable.id, run.id));
    res.status(503).json({ error: "RPA service is not reachable. Ensure the RPA Bot Service workflow is running." });
    return;
  }

  res.status(201).json(run);
});

router.get("/rpa/runs/:id/logs", ...adminAuth, async (req, res): Promise<void> => {
  const runId = parseInt(req.params.id, 10);
  const logs = await db.select().from(rpaBotLogsTable)
    .where(eq(rpaBotLogsTable.runId, runId))
    .orderBy(rpaBotLogsTable.ts);
  res.json(logs);
});

// SSE stream — proxy to Python service
router.get("/rpa/runs/:id/stream", ...adminAuth, async (req, res): Promise<void> => {
  const runId = parseInt(req.params.id, 10);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let pyResp: Response;
  try {
    pyResp = await proxyToRpa(`/internal/runs/${runId}/stream`);
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

  // Pipe chunks from Python SSE → client
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

// ── SEED reference bot ────────────────────────────────────────────────────────

router.post("/rpa/seed", ...adminAuth, async (req, res): Promise<void> => {
  const existing = await db.select().from(rpaBotsTable).limit(1);
  if (existing.length > 0) {
    res.json({ ok: true, message: "Bots already exist, skipping seed" });
    return;
  }

  const [bot] = await db.insert(rpaBotsTable).values({
    name: "Data Preview Automation",
    description: "Reference bot: logs into the platform, navigates to Data Preview, selects a connection, runs a query, and takes a screenshot.",
    botType: "browser_automation",
    isActive: true,
    createdBy: req.user?.userId ?? null,
  }).returning();

  const appUrl = process.env.APP_URL ?? "http://localhost:5173";

  const steps = [
    { stepOrder: 0, stepType: "navigate" as const, config: { url: appUrl }, description: "Open app" },
    { stepOrder: 1, stepType: "fill" as const, config: { selector: "input[type=email]", cred_label: "admin", cred_field: "username" }, description: "Fill email" },
    { stepOrder: 2, stepType: "fill" as const, config: { selector: "input[type=password]", cred_label: "admin", cred_field: "password" }, description: "Fill password" },
    { stepOrder: 3, stepType: "click" as const, config: { selector: "button[type=submit]" }, description: "Click login" },
    { stepOrder: 4, stepType: "wait" as const, config: { selector: "[data-testid=dashboard]", ms: 3000 }, description: "Wait for dashboard" },
    { stepOrder: 5, stepType: "navigate" as const, config: { url: `${appUrl}/preview` }, description: "Go to Data Preview" },
    { stepOrder: 6, stepType: "wait" as const, config: { ms: 2000 }, description: "Wait for page load" },
    { stepOrder: 7, stepType: "screenshot" as const, config: { full_page: true }, description: "Take screenshot" },
  ];

  await db.insert(rpaBotStepsTable).values(steps.map(s => ({ ...s, botId: bot.id })));

  res.status(201).json({ ok: true, bot });
});

export default router;
