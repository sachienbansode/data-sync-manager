import { pgTable, serial, text, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { rolesTable } from "./roles";

export const PII_FIELD_TYPES = [
  "phone",
  "national_id",
  "bank_account",
  "pan_number",
  "email_counterparty",
  "address",
] as const;

export type PiiFieldType = typeof PII_FIELD_TYPES[number];

export const piiFieldPermissionsTable = pgTable("pii_field_permissions", {
  id: serial("id").primaryKey(),
  roleId: integer("role_id").notNull().references(() => rolesTable.id, { onDelete: "cascade" }),
  fieldType: text("field_type").notNull(),
  canUnmask: boolean("can_unmask").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pii_perms_role_field_idx").on(t.roleId, t.fieldType),
]);

export const piiRecordsTable = pgTable("pii_records", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  company: text("company"),
  phone: text("phone"),
  nationalId: text("national_id"),
  bankAccount: text("bank_account"),
  panNumber: text("pan_number"),
  emailCounterparty: text("email_counterparty"),
  address: text("address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PiiRecord = typeof piiRecordsTable.$inferSelect;
export type InsertPiiRecord = typeof piiRecordsTable.$inferInsert;
export type PiiFieldPermission = typeof piiFieldPermissionsTable.$inferSelect;
