import { pgTable, serial, text, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { rolesTable } from "./roles";

export const apiApplicationsTable = pgTable("api_applications", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  tags: text("tags").array().notNull().default([]),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertApiApplicationSchema = createInsertSchema(apiApplicationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertApiApplication = z.infer<typeof insertApiApplicationSchema>;
export type ApiApplication = typeof apiApplicationsTable.$inferSelect;

export const apiSpecsTable = pgTable("api_specs", {
  id: serial("id").primaryKey(),
  appId: integer("app_id").notNull().references(() => apiApplicationsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  /** Human-friendly label for this spec, e.g. "REST API v1", "GraphQL API" */
  specLabel: text("spec_label"),
  s3Key: text("s3_key"),
  specUrl: text("spec_url"),
  /** OpenAPI YAML or JSON stored directly in the database (no S3 required) */
  inlineContent: text("inline_content"),
  isActive: boolean("is_active").notNull().default(false),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("api_specs_app_idx").on(t.appId),
  uniqueIndex("api_specs_app_version_idx").on(t.appId, t.version),
]);

export const insertApiSpecSchema = createInsertSchema(apiSpecsTable).omit({ id: true, uploadedAt: true });
export type InsertApiSpec = z.infer<typeof insertApiSpecSchema>;
export type ApiSpec = typeof apiSpecsTable.$inferSelect;

export const apiAppRoleAccessTable = pgTable("api_app_role_access", {
  id: serial("id").primaryKey(),
  appId: integer("app_id").notNull().references(() => apiApplicationsTable.id, { onDelete: "cascade" }),
  roleId: integer("role_id").notNull().references(() => rolesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("api_app_role_access_app_idx").on(t.appId),
  uniqueIndex("api_app_role_access_app_role_idx").on(t.appId, t.roleId),
]);

export const insertApiAppRoleAccessSchema = createInsertSchema(apiAppRoleAccessTable).omit({ id: true, createdAt: true });
export type InsertApiAppRoleAccess = z.infer<typeof insertApiAppRoleAccessSchema>;
export type ApiAppRoleAccess = typeof apiAppRoleAccessTable.$inferSelect;
