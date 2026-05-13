/**
 * Netcore email delivery webhook receiver
 * POST /webhooks/netcore  (no auth — called by Netcore servers)
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, commCampaignRecipientsTable, commEmailEventsTable, commNetcoreSettingsTable } from "@workspace/db";

const router: IRouter = Router();

// Status priority for updating recipient record
const STATUS_PRIORITY: Record<string, number> = {
  pending: 0, sent: 1, delivered: 2, bounced: 3,
  opened: 4, clicked: 5, unsubscribed: 6, spam: 7,
};

function priority(status: string) { return STATUS_PRIORITY[status] ?? -1; }

router.post("/webhooks/netcore", async (req, res): Promise<void> => {
  // Netcore can send an array or single object
  const events: Array<Record<string, unknown>> = Array.isArray(req.body) ? req.body : [req.body];

  // Optional webhook secret verification
  const [settings] = await db.select({ webhookSecret: commNetcoreSettingsTable.webhookSecret })
    .from(commNetcoreSettingsTable).limit(1);

  if (settings?.webhookSecret) {
    const incoming = req.headers["x-netcore-secret"] as string | undefined;
    if (incoming !== settings.webhookSecret) {
      res.status(401).json({ error: "Invalid webhook secret" });
      return;
    }
  }

  for (const event of events) {
    const email = String(event.email ?? event.EMAIL ?? "").toLowerCase();
    const eventType = String(event.event ?? event.EVENT_TYPE ?? "").toLowerCase();
    const messageId = String(event.message_id ?? event.MAILING_ID ?? event.netcore_message_id ?? "");

    if (!email || !eventType) continue;

    // Find recipient by message ID or email
    let recipient = messageId
      ? (await db.select({ id: commCampaignRecipientsTable.id, campaignId: commCampaignRecipientsTable.campaignId, status: commCampaignRecipientsTable.status })
          .from(commCampaignRecipientsTable)
          .where(eq(commCampaignRecipientsTable.netcoreMessageId, messageId)))[0]
      : undefined;

    if (!recipient) {
      recipient = (await db.select({ id: commCampaignRecipientsTable.id, campaignId: commCampaignRecipientsTable.campaignId, status: commCampaignRecipientsTable.status })
        .from(commCampaignRecipientsTable)
        .where(eq(commCampaignRecipientsTable.email, email)))[0];
    }

    // Record the event
    await db.insert(commEmailEventsTable).values({
      campaignId: recipient?.campaignId ?? null,
      recipientId: recipient?.id ?? null,
      email,
      eventType,
      eventData: event as Record<string, unknown>,
      netcoreMessageId: messageId || null,
      eventAt: new Date(),
    }).catch(() => {});

    // Upgrade recipient status if the new status is higher priority
    if (recipient && priority(eventType) > priority(recipient.status)) {
      await db.update(commCampaignRecipientsTable)
        .set({ status: eventType })
        .where(eq(commCampaignRecipientsTable.id, recipient.id))
        .catch(() => {});
    }
  }

  res.json({ received: events.length });
});

export default router;
