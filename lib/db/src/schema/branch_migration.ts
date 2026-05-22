import { pgTable, text, date, timestamp } from "drizzle-orm/pg-core";

export const MIGRATION_STATUSES = ["Migrated", "Pending", "Planned"] as const;
export type MigrationStatus = typeof MIGRATION_STATUSES[number];

export const branchMigrationTable = pgTable("branch_migration", {
  branchcode:       text("branchcode").primaryKey().notNull(),
  branchname:       text("branchname"),
  defaultcode:      text("defaultcode"),
  email:            text("email"),
  address1:         text("address1"),
  ccity:            text("ccity"),
  npincode:         text("npincode"),
  migrationStatus:  text("migration_status").$type<MigrationStatus>().notNull().default("Pending"),
  migrationDate:    date("migration_date"),
  createdBy:        text("created_by").notNull().default("SYSTEM"),
  createdDatetime:  timestamp("created_datetime").notNull().defaultNow(),
  updatedBy:        text("updated_by").notNull().default("SYSTEM"),
  updatedDatetime:  timestamp("updated_datetime").notNull().defaultNow(),
});

export type BranchMigration = typeof branchMigrationTable.$inferSelect;
export type BranchMigrationInsert = typeof branchMigrationTable.$inferInsert;
