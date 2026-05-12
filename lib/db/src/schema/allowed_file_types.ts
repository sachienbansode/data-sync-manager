import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const allowedFileTypesTable = pgTable("allowed_file_types", {
  id: serial("id").primaryKey(),
  extension: text("extension").notNull().unique(),
  mimeType: text("mime_type").notNull(),
  label: text("label").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AllowedFileType = typeof allowedFileTypesTable.$inferSelect;
