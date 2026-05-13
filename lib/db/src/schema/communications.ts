import { pgTable, serial, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/* ── Netcore settings (singleton) ── */
export const commNetcoreSettingsTable = pgTable("comm_netcore_settings", {
  id: serial("id").primaryKey(),
  apiKey: text("api_key"),
  apiUrl: text("api_url").default("https://emailapi.netcorecloud.net/v5.1/mail/send"),
  senderEmail: text("sender_email"),
  senderName: text("sender_name"),
  maxAttachmentSizeMb: integer("max_attachment_size_mb").notNull().default(10),
  maxRecipientsPerBatch: integer("max_recipients_per_batch").notNull().default(50),
  webhookSecret: text("webhook_secret"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
});

export type CommNetcoreSettings = typeof commNetcoreSettingsTable.$inferSelect;

/* ── Email templates ── */
export const commTemplatesTable = pgTable("comm_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  textBody: text("text_body"),
  variables: text("variables").array().default([]),
  version: integer("version").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommTemplate = typeof commTemplatesTable.$inferSelect;

/* ── Template version history ── */
export const commTemplateVersionsTable = pgTable("comm_template_versions", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => commTemplatesTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  subject: text("subject").notNull(),
  htmlBody: text("html_body").notNull(),
  textBody: text("text_body"),
  variables: text("variables").array().default([]),
  changeNote: text("change_note"),
  changedBy: integer("changed_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommTemplateVersion = typeof commTemplateVersionsTable.$inferSelect;

/* ── Campaigns ── */
export const commCampaignsTable = pgTable("comm_campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("static"), // static | dynamic
  status: text("status").notNull().default("draft"), // draft|scheduled|running|completed|cancelled|failed
  templateId: integer("template_id").references(() => commTemplatesTable.id, { onDelete: "set null" }),
  subject: text("subject").notNull(),
  fromEmail: text("from_email"),
  fromName: text("from_name"),
  totalRecipients: integer("total_recipients").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  hasAttachments: boolean("has_attachments").notNull().default(false),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurrenceType: text("recurrence_type"), // daily|weekly|monthly
  recurrenceConfig: jsonb("recurrence_config").$type<Record<string, unknown>>(),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommCampaign = typeof commCampaignsTable.$inferSelect;

/* ── Campaign recipients ── */
export const commCampaignRecipientsTable = pgTable("comm_campaign_recipients", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => commCampaignsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  variables: jsonb("variables").$type<Record<string, string>>(),
  status: text("status").notNull().default("pending"), // pending|sent|failed|delivered|bounced|opened|clicked|unsubscribed|spam
  netcoreMessageId: text("netcore_message_id"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommCampaignRecipient = typeof commCampaignRecipientsTable.$inferSelect;

/* ── Email delivery events (from Netcore webhooks) ── */
export const commEmailEventsTable = pgTable("comm_email_events", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => commCampaignsTable.id, { onDelete: "cascade" }),
  recipientId: integer("recipient_id").references(() => commCampaignRecipientsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  eventType: text("event_type").notNull(), // delivered|bounced|opened|clicked|unsubscribed|spam
  eventData: jsonb("event_data").$type<Record<string, unknown>>(),
  netcoreMessageId: text("netcore_message_id"),
  eventAt: timestamp("event_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommEmailEvent = typeof commEmailEventsTable.$inferSelect;

/* ── Campaign attachments ── */
export const commAttachmentsTable = pgTable("comm_attachments", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => commCampaignsTable.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  contentBase64: text("content_base64").notNull(),
  isInline: boolean("is_inline").notNull().default(false),
  cid: text("cid"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CommAttachment = typeof commAttachmentsTable.$inferSelect;
