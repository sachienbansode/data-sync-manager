import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { randomBytes, createHash } from "crypto";
import { db, apiKeysTable } from "@workspace/db";
import { authenticate } from "../middlewares/authenticate";

const router: IRouter = Router();

// GET /api-keys — list current user's keys (hashes never returned)
router.get("/api-keys", authenticate, async (req, res): Promise<void> => {
  const rows = await db.select({
    id: apiKeysTable.id,
    name: apiKeysTable.name,
    keyPrefix: apiKeysTable.keyPrefix,
    isActive: apiKeysTable.isActive,
    lastUsedAt: apiKeysTable.lastUsedAt,
    expiresAt: apiKeysTable.expiresAt,
    createdAt: apiKeysTable.createdAt,
  }).from(apiKeysTable).where(eq(apiKeysTable.userId, req.user!.sub));
  res.json(rows);
});

// POST /api-keys — generate a new API key
router.post("/api-keys", authenticate, async (req, res): Promise<void> => {
  const { name, expiresAt } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }

  const randomPart = randomBytes(24).toString("hex"); // 48 hex chars
  const fullKey = `apk_${randomPart}`;             // 52 chars total
  const prefix = fullKey.slice(0, 12);              // "apk_" + 8 chars
  const hash = createHash("sha256").update(fullKey).digest("hex");

  const [row] = await db.insert(apiKeysTable).values({
    userId: req.user!.sub,
    name: name.trim(),
    keyPrefix: prefix,
    keyHash: hash,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  }).returning({
    id: apiKeysTable.id,
    name: apiKeysTable.name,
    keyPrefix: apiKeysTable.keyPrefix,
    isActive: apiKeysTable.isActive,
    lastUsedAt: apiKeysTable.lastUsedAt,
    expiresAt: apiKeysTable.expiresAt,
    createdAt: apiKeysTable.createdAt,
  });

  // Return the full key ONCE — it will never be shown again
  res.status(201).json({ ...row, key: fullKey });
});

// PATCH /api-keys/:id/toggle — enable/disable
router.patch("/api-keys/:id/toggle", authenticate, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [current] = await db.select({ isActive: apiKeysTable.isActive })
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.userId, req.user!.sub)));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  const [updated] = await db.update(apiKeysTable)
    .set({ isActive: !current.isActive })
    .where(eq(apiKeysTable.id, id))
    .returning({ id: apiKeysTable.id, isActive: apiKeysTable.isActive });
  res.json(updated);
});

// DELETE /api-keys/:id
router.delete("/api-keys/:id", authenticate, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  await db.delete(apiKeysTable).where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.userId, req.user!.sub)));
  res.json({ success: true });
});

export default router;
