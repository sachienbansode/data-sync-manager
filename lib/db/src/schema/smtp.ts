import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const smtpSettingsTable = pgTable("smtp_settings", {
  id: serial("id").primaryKey(),
  host: text("host").notNull().default("smtp.gmail.com"),
  port: integer("port").notNull().default(587),
  secure: boolean("secure").notNull().default(false),
  username: text("username").notNull().default(""),
  password: text("password").notNull().default(""),
  fromName: text("from_name").notNull().default("Ashika Platform"),
  fromEmail: text("from_email").notNull().default(""),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SmtpSettings = typeof smtpSettingsTable.$inferSelect;
