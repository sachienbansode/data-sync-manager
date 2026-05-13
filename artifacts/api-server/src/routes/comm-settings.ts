import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, commNetcoreSettingsTable, auditLogsTable } from "@workspace/db";
import { authenticate, requireRole } from "../middlewares/authenticate";

const router: IRouter = Router();

async function getOrCreate() {
  const [s] = await db.select().from(commNetcoreSettingsTable).limit(1);
  if (s) return s;
  const [created] = await db.insert(commNetcoreSettingsTable).values({}).returning();
  return created!;
}

// GET /admin/comm-settings
router.get("/admin/comm-settings", authenticate, requireRole("Admin"), async (_req, res): Promise<void> => {
  const s = await getOrCreate();
  res.json({
    id: s.id,
    apiKeySet: !!s.apiKey,
    apiKeyPrefix: s.apiKey ? s.apiKey.slice(0, 6) + "…" : null,
    apiUrl: s.apiUrl,
    senderEmail: s.senderEmail,
    senderName: s.senderName,
    maxAttachmentSizeMb: s.maxAttachmentSizeMb,
    maxRecipientsPerBatch: s.maxRecipientsPerBatch,
    webhookSecretSet: !!s.webhookSecret,
    isEnabled: s.isEnabled,
    updatedAt: s.updatedAt,
  });
});

// PUT /admin/comm-settings
router.put("/admin/comm-settings", authenticate, requireRole("Admin"), async (req, res): Promise<void> => {
  const { apiKey, apiUrl, senderEmail, senderName, maxAttachmentSizeMb, maxRecipientsPerBatch, webhookSecret, isEnabled } = req.body;
  const current = await getOrCreate();

  const [row] = await db.update(commNetcoreSettingsTable).set({
    ...(apiKey !== undefined && apiKey !== "" ? { apiKey } : {}),
    apiUrl: apiUrl || current.apiUrl,
    senderEmail: senderEmail ?? current.senderEmail,
    senderName: senderName ?? current.senderName,
    maxAttachmentSizeMb: maxAttachmentSizeMb ? Number(maxAttachmentSizeMb) : current.maxAttachmentSizeMb,
    maxRecipientsPerBatch: maxRecipientsPerBatch ? Number(maxRecipientsPerBatch) : current.maxRecipientsPerBatch,
    ...(webhookSecret !== undefined && webhookSecret !== "" ? { webhookSecret } : {}),
    isEnabled: isEnabled !== undefined ? Boolean(isEnabled) : current.isEnabled,
    updatedAt: new Date(),
    updatedBy: req.user!.sub,
  }).where(eq(commNetcoreSettingsTable.id, current.id)).returning();

  db.insert(auditLogsTable).values({
    userId: req.user!.sub,
    userEmail: req.user!.email,
    action: "COMM_SETTINGS_UPDATED",
    details: "Updated Netcore bulk email settings",
    resourceType: "comm_settings",
    resourceId: String(current.id),
  }).catch(() => {});

  res.json({
    apiKeySet: !!row?.apiKey,
    apiUrl: row?.apiUrl,
    senderEmail: row?.senderEmail,
    senderName: row?.senderName,
    maxAttachmentSizeMb: row?.maxAttachmentSizeMb,
    maxRecipientsPerBatch: row?.maxRecipientsPerBatch,
    isEnabled: row?.isEnabled,
    updatedAt: row?.updatedAt,
  });
});

export default router;
