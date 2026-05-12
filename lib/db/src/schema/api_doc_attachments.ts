import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { apiApplicationsTable } from "./api-docs";

export const apiDocAttachmentsTable = pgTable("api_doc_attachments", {
  id: serial("id").primaryKey(),
  appId: integer("app_id").notNull().references(() => apiApplicationsTable.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: text("mime_type").notNull(),
  /** Base64-encoded file content stored in DB (no S3 required) */
  content: text("content").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("api_doc_attachments_app_idx").on(t.appId),
]);

export type ApiDocAttachment = typeof apiDocAttachmentsTable.$inferSelect;
