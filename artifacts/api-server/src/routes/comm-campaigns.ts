import { Router, type IRouter } from "express";
import { eq, desc, and, lte, sql, count } from "drizzle-orm";
import multer from "multer";
import {
  db, commCampaignsTable, commCampaignRecipientsTable, commEmailEventsTable,
  commAttachmentsTable, commTemplatesTable, commNetcoreSettingsTable,
  usersTable, auditLogsTable,
} from "@workspace/db";
import { authenticate, requirePageAccess } from "../middlewares/authenticate";

const router: IRouter = Router();

const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (file.mimetype === "text/csv" || file.originalname.toLowerCase().endsWith(".csv")) cb(null, true);
    else cb(new Error("Only CSV files are allowed"));
  },
});
const uploadFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/* ── CSV parsing ── */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') { inQuotes = !inQuotes; }
    else if (char === "," && !inQuotes) { result.push(current); current = ""; }
    else { current += char; }
  }
  result.push(current);
  return result.map(v => v.trim().replace(/^"|"$/g, ""));
}

function parseCSV(content: string): Array<Record<string, string>> {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/* ── Netcore send ── */
async function sendCampaignBatch(campaignId: number): Promise<void> {
  try {
    const [campaign] = await db.select().from(commCampaignsTable).where(eq(commCampaignsTable.id, campaignId));
    if (!campaign) return;

    const [settings] = await db.select().from(commNetcoreSettingsTable).limit(1);
    if (!settings?.apiKey || !settings.isEnabled) {
      await db.update(commCampaignsTable).set({ status: "failed", completedAt: new Date() }).where(eq(commCampaignsTable.id, campaignId));
      console.error(`Campaign ${campaignId}: Netcore not configured or disabled`);
      return;
    }

    const [template] = campaign.templateId
      ? await db.select().from(commTemplatesTable).where(eq(commTemplatesTable.id, campaign.templateId))
      : [null];
    const attachments = await db.select().from(commAttachmentsTable).where(eq(commAttachmentsTable.campaignId, campaignId));
    const recipients = await db.select().from(commCampaignRecipientsTable)
      .where(and(eq(commCampaignRecipientsTable.campaignId, campaignId), eq(commCampaignRecipientsTable.status, "pending")));

    const batchSize = settings.maxRecipientsPerBatch ?? 50;
    let sentCount = campaign.sentCount;
    let failedCount = campaign.failedCount;

    const regularAttachments = attachments.filter(a => !a.isInline);

    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);

      const payload: Record<string, unknown> = {
        from: { email: settings.senderEmail ?? "", name: settings.senderName ?? "" },
        subject: campaign.subject,
        content: [{ type: "html", value: template?.htmlBody ?? "" }],
        personalizations: batch.map(r => ({
          to: [{ email: r.email }],
          ...(campaign.type === "dynamic" && r.variables
            ? { attributes: r.variables as Record<string, string> }
            : {}),
        })),
      };
      if (regularAttachments.length > 0) {
        payload.attachments = regularAttachments.map(a => ({
          content: a.contentBase64,
          filename: a.filename,
          type: a.contentType,
        }));
      }

      try {
        const apiUrl = settings.apiUrl ?? "https://emailapi.netcorecloud.net/v5.1/mail/send";
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", "api_key": settings.apiKey },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(30_000),
        });
        const result = await response.json().catch(() => ({})) as Record<string, unknown>;
        const msgId = ((result?.DATA ?? {}) as Record<string, unknown>).MESSAGE_ID as string | undefined;

        if (response.ok) {
          for (const r of batch) {
            await db.update(commCampaignRecipientsTable)
              .set({ status: "sent", sentAt: new Date(), netcoreMessageId: msgId ?? null })
              .where(eq(commCampaignRecipientsTable.id, r.id));
          }
          sentCount += batch.length;
        } else {
          const errMsg = (result as Record<string, string>).message ?? `HTTP ${response.status}`;
          for (const r of batch) {
            await db.update(commCampaignRecipientsTable).set({ status: "failed", errorMessage: errMsg }).where(eq(commCampaignRecipientsTable.id, r.id));
          }
          failedCount += batch.length;
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Network error";
        for (const r of batch) {
          await db.update(commCampaignRecipientsTable).set({ status: "failed", errorMessage: errMsg }).where(eq(commCampaignRecipientsTable.id, r.id));
        }
        failedCount += batch.length;
      }

      await db.update(commCampaignsTable).set({ sentCount, failedCount }).where(eq(commCampaignsTable.id, campaignId));
      if (i + batchSize < recipients.length) await new Promise(r => setTimeout(r, 1_000));
    }

    if (campaign.isRecurring && campaign.recurrenceType) {
      const next = new Date();
      if (campaign.recurrenceType === "daily") next.setDate(next.getDate() + 1);
      else if (campaign.recurrenceType === "weekly") next.setDate(next.getDate() + 7);
      else if (campaign.recurrenceType === "monthly") next.setMonth(next.getMonth() + 1);
      await db.update(commCampaignRecipientsTable)
        .set({ status: "pending", sentAt: null, netcoreMessageId: null, errorMessage: null })
        .where(eq(commCampaignRecipientsTable.campaignId, campaignId));
      await db.update(commCampaignsTable)
        .set({ status: "scheduled", scheduledAt: next, sentCount: 0, failedCount: 0, startedAt: null, completedAt: null })
        .where(eq(commCampaignsTable.id, campaignId));
    } else {
      await db.update(commCampaignsTable)
        .set({ status: "completed", completedAt: new Date(), sentCount, failedCount })
        .where(eq(commCampaignsTable.id, campaignId));
    }
  } catch (err) {
    console.error(`Campaign ${campaignId} fatal error:`, err);
    await db.update(commCampaignsTable).set({ status: "failed", completedAt: new Date() }).where(eq(commCampaignsTable.id, campaignId)).catch(() => {});
  }
}

/* ── Scheduler ── */
let _schedulerRunning = false;
export function initCommScheduler(): void {
  if (_schedulerRunning) return;
  _schedulerRunning = true;
  setInterval(async () => {
    try {
      const now = new Date();
      const pending = await db.select({ id: commCampaignsTable.id })
        .from(commCampaignsTable)
        .where(and(eq(commCampaignsTable.status, "scheduled"), lte(commCampaignsTable.scheduledAt, now)));
      for (const { id } of pending) {
        await db.update(commCampaignsTable).set({ status: "running", startedAt: now }).where(eq(commCampaignsTable.id, id));
        sendCampaignBatch(id).catch(e => console.error(`Scheduler: campaign ${id}`, e));
      }
    } catch {}
  }, 60_000);
}

/* ── Routes ── */

// GET /comm/campaigns
router.get("/comm/campaigns", authenticate, requirePageAccess("/email-hub/campaigns"), async (req, res): Promise<void> => {
  const search = (req.query.search as string | undefined)?.toLowerCase();
  const statusFilter = req.query.status as string | undefined;
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = 10;

  const rows = await db.select({
    id: commCampaignsTable.id,
    name: commCampaignsTable.name,
    type: commCampaignsTable.type,
    status: commCampaignsTable.status,
    subject: commCampaignsTable.subject,
    totalRecipients: commCampaignsTable.totalRecipients,
    sentCount: commCampaignsTable.sentCount,
    failedCount: commCampaignsTable.failedCount,
    scheduledAt: commCampaignsTable.scheduledAt,
    completedAt: commCampaignsTable.completedAt,
    isRecurring: commCampaignsTable.isRecurring,
    recurrenceType: commCampaignsTable.recurrenceType,
    hasAttachments: commCampaignsTable.hasAttachments,
    createdAt: commCampaignsTable.createdAt,
    creatorName: sql<string | null>`nullif(trim(coalesce(${usersTable.firstName}, '') || ' ' || coalesce(${usersTable.lastName}, '')), '')`,
    deliveredCount: sql<number>`(select count(*) from comm_email_events where campaign_id = ${commCampaignsTable.id} and event_type = 'delivered')`.mapWith(Number),
    openedCount: sql<number>`(select count(*) from comm_email_events where campaign_id = ${commCampaignsTable.id} and event_type = 'opened')`.mapWith(Number),
    clickedCount: sql<number>`(select count(*) from comm_email_events where campaign_id = ${commCampaignsTable.id} and event_type = 'clicked')`.mapWith(Number),
  }).from(commCampaignsTable)
    .leftJoin(usersTable, eq(commCampaignsTable.createdBy, usersTable.id))
    .orderBy(desc(commCampaignsTable.createdAt));

  let filtered = rows;
  if (search) filtered = filtered.filter(r => r.name.toLowerCase().includes(search) || r.subject.toLowerCase().includes(search));
  if (statusFilter) filtered = filtered.filter(r => r.status === statusFilter);

  res.json({ data: filtered.slice((page - 1) * limit, page * limit), total: filtered.length, page, pages: Math.max(1, Math.ceil(filtered.length / limit)) });
});

// POST /comm/campaigns
router.post("/comm/campaigns", authenticate, requirePageAccess("/email-hub/campaigns"), async (req, res): Promise<void> => {
  const { name, type, templateId, subject, fromEmail, fromName, isRecurring, recurrenceType } = req.body;
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }
  if (!subject?.trim()) { res.status(400).json({ error: "subject is required" }); return; }

  const [row] = await db.insert(commCampaignsTable).values({
    name: name.trim(), type: type ?? "static",
    templateId: templateId ? Number(templateId) : null,
    subject: subject.trim(), fromEmail: fromEmail ?? null, fromName: fromName ?? null,
    isRecurring: isRecurring ?? false, recurrenceType: recurrenceType ?? null,
    createdBy: req.user!.sub,
  }).returning();

  db.insert(auditLogsTable).values({ userId: req.user!.sub, userEmail: req.user!.email, action: "CAMPAIGN_CREATED", details: `Created campaign: ${name}`, resourceType: "campaign", resourceId: String(row.id) }).catch(() => {});
  res.status(201).json(row);
});

// GET /comm/campaigns/:id
router.get("/comm/campaigns/:id", authenticate, requirePageAccess("/email-hub/campaigns"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.select({
    id: commCampaignsTable.id, name: commCampaignsTable.name, type: commCampaignsTable.type,
    status: commCampaignsTable.status, subject: commCampaignsTable.subject,
    fromEmail: commCampaignsTable.fromEmail, fromName: commCampaignsTable.fromName,
    templateId: commCampaignsTable.templateId, totalRecipients: commCampaignsTable.totalRecipients,
    sentCount: commCampaignsTable.sentCount, failedCount: commCampaignsTable.failedCount,
    hasAttachments: commCampaignsTable.hasAttachments, scheduledAt: commCampaignsTable.scheduledAt,
    startedAt: commCampaignsTable.startedAt, completedAt: commCampaignsTable.completedAt,
    isRecurring: commCampaignsTable.isRecurring, recurrenceType: commCampaignsTable.recurrenceType,
    createdAt: commCampaignsTable.createdAt, updatedAt: commCampaignsTable.updatedAt,
    creatorName: sql<string | null>`nullif(trim(coalesce(${usersTable.firstName}, '') || ' ' || coalesce(${usersTable.lastName}, '')), '')`,
    deliveredCount: sql<number>`(select count(*) from comm_email_events where campaign_id = ${commCampaignsTable.id} and event_type = 'delivered')`.mapWith(Number),
    openedCount: sql<number>`(select count(*) from comm_email_events where campaign_id = ${commCampaignsTable.id} and event_type = 'opened')`.mapWith(Number),
    clickedCount: sql<number>`(select count(*) from comm_email_events where campaign_id = ${commCampaignsTable.id} and event_type = 'clicked')`.mapWith(Number),
    bouncedCount: sql<number>`(select count(*) from comm_email_events where campaign_id = ${commCampaignsTable.id} and event_type = 'bounced')`.mapWith(Number),
    unsubscribedCount: sql<number>`(select count(*) from comm_email_events where campaign_id = ${commCampaignsTable.id} and event_type = 'unsubscribed')`.mapWith(Number),
    spamCount: sql<number>`(select count(*) from comm_email_events where campaign_id = ${commCampaignsTable.id} and event_type = 'spam')`.mapWith(Number),
  }).from(commCampaignsTable)
    .leftJoin(usersTable, eq(commCampaignsTable.createdBy, usersTable.id))
    .where(eq(commCampaignsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

  const attachments = await db.select({ id: commAttachmentsTable.id, filename: commAttachmentsTable.filename, contentType: commAttachmentsTable.contentType, fileSizeBytes: commAttachmentsTable.fileSizeBytes, isInline: commAttachmentsTable.isInline, cid: commAttachmentsTable.cid }).from(commAttachmentsTable).where(eq(commAttachmentsTable.campaignId, id));
  res.json({ ...row, attachments });
});

// PUT /comm/campaigns/:id
router.put("/comm/campaigns/:id", authenticate, requirePageAccess("/email-hub/campaigns"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { name, subject, templateId, fromEmail, fromName, isRecurring, recurrenceType } = req.body;
  const [row] = await db.update(commCampaignsTable).set({
    name: name ?? undefined, subject: subject ?? undefined,
    templateId: templateId !== undefined ? (templateId ? Number(templateId) : null) : undefined,
    fromEmail: fromEmail ?? null, fromName: fromName ?? null,
    isRecurring: isRecurring ?? undefined, recurrenceType: recurrenceType ?? null,
    updatedBy: req.user!.sub, updatedAt: new Date(),
  }).where(eq(commCampaignsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// DELETE /comm/campaigns/:id
router.delete("/comm/campaigns/:id", authenticate, requirePageAccess("/email-hub/campaigns"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.select({ status: commCampaignsTable.status, name: commCampaignsTable.name }).from(commCampaignsTable).where(eq(commCampaignsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.status === "running") { res.status(400).json({ error: "Cannot delete a running campaign" }); return; }
  await db.delete(commCampaignsTable).where(eq(commCampaignsTable.id, id));
  db.insert(auditLogsTable).values({ userId: req.user!.sub, userEmail: req.user!.email, action: "CAMPAIGN_DELETED", details: `Deleted: ${row.name}`, resourceType: "campaign", resourceId: String(id) }).catch(() => {});
  res.json({ success: true });
});

// POST /comm/campaigns/:id/send
router.post("/comm/campaigns/:id/send", authenticate, requirePageAccess("/email-hub/campaigns"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.select({ status: commCampaignsTable.status, name: commCampaignsTable.name }).from(commCampaignsTable).where(eq(commCampaignsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!["draft", "scheduled"].includes(row.status)) { res.status(400).json({ error: "Campaign cannot be sent in its current state" }); return; }

  const [{ cnt }] = await db.select({ cnt: count() }).from(commCampaignRecipientsTable).where(eq(commCampaignRecipientsTable.campaignId, id));
  if (cnt === 0) { res.status(400).json({ error: "No recipients — upload a recipient list first" }); return; }

  await db.update(commCampaignsTable).set({ status: "running", startedAt: new Date(), sentCount: 0, failedCount: 0 }).where(eq(commCampaignsTable.id, id));
  db.insert(auditLogsTable).values({ userId: req.user!.sub, userEmail: req.user!.email, action: "CAMPAIGN_SENT", details: `Sent campaign: ${row.name}`, resourceType: "campaign", resourceId: String(id) }).catch(() => {});
  sendCampaignBatch(id).catch(e => console.error(`Campaign ${id}:`, e));
  res.json({ success: true, message: "Campaign is sending in the background" });
});

// POST /comm/campaigns/:id/schedule
router.post("/comm/campaigns/:id/schedule", authenticate, requirePageAccess("/email-hub/campaigns"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const { scheduledAt } = req.body;
  if (!scheduledAt) { res.status(400).json({ error: "scheduledAt is required" }); return; }
  const dt = new Date(scheduledAt);
  if (dt <= new Date()) { res.status(400).json({ error: "scheduledAt must be in the future" }); return; }
  const [row] = await db.update(commCampaignsTable).set({ status: "scheduled", scheduledAt: dt, updatedAt: new Date() }).where(eq(commCampaignsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

// POST /comm/campaigns/:id/cancel
router.post("/comm/campaigns/:id/cancel", authenticate, requirePageAccess("/email-hub/campaigns"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.update(commCampaignsTable).set({ status: "cancelled", completedAt: new Date() }).where(eq(commCampaignsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  db.insert(auditLogsTable).values({ userId: req.user!.sub, userEmail: req.user!.email, action: "CAMPAIGN_CANCELLED", details: `Cancelled: ${row.name}`, resourceType: "campaign", resourceId: String(id) }).catch(() => {});
  res.json(row);
});

// POST /comm/campaigns/:id/recipients/csv
router.post("/comm/campaigns/:id/recipients/csv", authenticate, requirePageAccess("/email-hub/campaigns"),
  uploadCsv.single("file"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!req.file) { res.status(400).json({ error: "No CSV file" }); return; }

  const rows = parseCSV(req.file.buffer.toString("utf-8"));
  const valid = rows.filter(r => isValidEmail(r.email ?? ""));
  const invalidCount = rows.length - valid.length;

  const seen = new Set<string>();
  const deduped = valid.filter(r => { const e = r.email.toLowerCase(); if (seen.has(e)) return false; seen.add(e); return true; });
  const dupCount = valid.length - deduped.length;
  if (deduped.length === 0) { res.status(400).json({ error: "No valid unique email addresses found" }); return; }

  await db.delete(commCampaignRecipientsTable).where(eq(commCampaignRecipientsTable.campaignId, id));
  for (let i = 0; i < deduped.length; i += 500) {
    const chunk = deduped.slice(i, i + 500);
    await db.insert(commCampaignRecipientsTable).values(chunk.map(r => {
      const { email, ...rest } = r;
      return { campaignId: id, email: email.toLowerCase().trim(), variables: Object.keys(rest).length > 0 ? rest : null };
    }));
  }
  await db.update(commCampaignsTable).set({ totalRecipients: deduped.length, updatedAt: new Date() }).where(eq(commCampaignsTable.id, id));
  res.json({ imported: deduped.length, invalid: invalidCount, duplicates: dupCount });
});

// GET /comm/campaigns/:id/recipients
router.get("/comm/campaigns/:id/recipients", authenticate, requirePageAccess("/email-hub/campaigns"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = 10;
  const rows = await db.select().from(commCampaignRecipientsTable).where(eq(commCampaignRecipientsTable.campaignId, id)).orderBy(commCampaignRecipientsTable.id).limit(limit).offset((page - 1) * limit);
  const [{ total }] = await db.select({ total: count() }).from(commCampaignRecipientsTable).where(eq(commCampaignRecipientsTable.campaignId, id));
  res.json({ data: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

// GET /comm/campaigns/:id/events
router.get("/comm/campaigns/:id/events", authenticate, requirePageAccess("/email-hub/campaigns"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = 10;
  const rows = await db.select().from(commEmailEventsTable).where(eq(commEmailEventsTable.campaignId, id)).orderBy(desc(commEmailEventsTable.eventAt)).limit(limit).offset((page - 1) * limit);
  const [{ total }] = await db.select({ total: count() }).from(commEmailEventsTable).where(eq(commEmailEventsTable.campaignId, id));
  res.json({ data: rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

// POST /comm/campaigns/:id/attachments
router.post("/comm/campaigns/:id/attachments", authenticate, requirePageAccess("/email-hub/campaigns"),
  uploadFile.single("file"), async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!req.file) { res.status(400).json({ error: "No file" }); return; }

  const [settings] = await db.select({ maxAttachmentSizeMb: commNetcoreSettingsTable.maxAttachmentSizeMb }).from(commNetcoreSettingsTable).limit(1);
  const maxBytes = (settings?.maxAttachmentSizeMb ?? 10) * 1024 * 1024;
  if (req.file.size > maxBytes) { res.status(400).json({ error: `File exceeds ${settings?.maxAttachmentSizeMb ?? 10}MB limit` }); return; }

  const isInline = req.body.isInline === "true";
  const cid = isInline ? (req.body.cid ?? `cid_${Date.now()}`) : null;

  const [row] = await db.insert(commAttachmentsTable).values({
    campaignId: id, filename: req.file.originalname, contentType: req.file.mimetype,
    fileSizeBytes: req.file.size, contentBase64: req.file.buffer.toString("base64"),
    isInline, cid,
  }).returning({ id: commAttachmentsTable.id, filename: commAttachmentsTable.filename, contentType: commAttachmentsTable.contentType, fileSizeBytes: commAttachmentsTable.fileSizeBytes, isInline: commAttachmentsTable.isInline, cid: commAttachmentsTable.cid });

  await db.update(commCampaignsTable).set({ hasAttachments: true }).where(eq(commCampaignsTable.id, id));
  res.status(201).json(row);
});

// DELETE /comm/campaigns/:id/attachments/:aid
router.delete("/comm/campaigns/:id/attachments/:aid", authenticate, requirePageAccess("/email-hub/campaigns"), async (req, res): Promise<void> => {
  const { id, aid } = { id: Number(req.params.id), aid: Number(req.params.aid) };
  await db.delete(commAttachmentsTable).where(and(eq(commAttachmentsTable.id, aid), eq(commAttachmentsTable.campaignId, id)));
  const [{ cnt }] = await db.select({ cnt: count() }).from(commAttachmentsTable).where(eq(commAttachmentsTable.campaignId, id));
  if (cnt === 0) await db.update(commCampaignsTable).set({ hasAttachments: false }).where(eq(commCampaignsTable.id, id));
  res.json({ success: true });
});

export default router;
