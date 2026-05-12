import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const applicationTypesTable = pgTable("application_types", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ApplicationType = typeof applicationTypesTable.$inferSelect;
