import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const appSettingsTable = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  appName: text("app_name").notNull().default("Ashika Platform"),
  logoData: text("logo_data"),
  logoMimeType: text("logo_mime_type"),
  /** Font family applied across the application */
  fontFamily: text("font_family").notNull().default("Inter"),
  /** Font size in px for menu/sidebar items */
  menuFontSize: text("menu_font_size").notNull().default("14"),
  /** Font size in px for body content */
  bodyFontSize: text("body_font_size").notNull().default("14"),
  /** Font size in px for page headings */
  headingFontSize: text("heading_font_size").notNull().default("24"),
  /** Whether PII columns are masked in Data Preview (admin-controlled) */
  piiPreviewEnabled: boolean("pii_preview_enabled").notNull().default(true),
  /** How often (seconds) the RPA run notifier polls for completed runs */
  rpaNotifyIntervalSec: integer("rpa_notify_interval_sec").notNull().default(60),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AppSettings = typeof appSettingsTable.$inferSelect;
