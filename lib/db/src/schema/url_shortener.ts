import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const shortDomainsTable = pgTable("short_domains", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  verificationToken: text("verification_token").notNull(),
  isVerified: boolean("is_verified").notNull().default(false),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ShortDomain = typeof shortDomainsTable.$inferSelect;

export const shortUrlsTable = pgTable("short_urls", {
  id: serial("id").primaryKey(),
  shortCode: text("short_code").notNull().unique(),
  originalUrl: text("original_url").notNull(),
  title: text("title"),
  description: text("description"),
  domainId: integer("domain_id").references(() => shortDomainsTable.id, { onDelete: "set null" }),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ShortUrl = typeof shortUrlsTable.$inferSelect;

export const urlClicksTable = pgTable("url_clicks", {
  id: serial("id").primaryKey(),
  shortUrlId: integer("short_url_id").notNull().references(() => shortUrlsTable.id, { onDelete: "cascade" }),
  clickedAt: timestamp("clicked_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  browser: text("browser"),
  browserVersion: text("browser_version"),
  os: text("os"),
  deviceType: text("device_type"),
  country: text("country"),
  city: text("city"),
  referer: text("referer"),
});

export type UrlClick = typeof urlClicksTable.$inferSelect;

export const apiKeysTable = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ApiKey = typeof apiKeysTable.$inferSelect;
