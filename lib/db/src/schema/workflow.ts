import { pgTable, serial, text, integer, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const DB_CONNECTION_TYPES = ["backoffice", "trading"] as const;
export type DbConnectionType = typeof DB_CONNECTION_TYPES[number];

export const dbConnectionsTable = pgTable("db_connections", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").$type<DbConnectionType>().notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull().default(5432),
  dbName: text("db_name").notNull(),
  schemaName: text("schema_name").notNull().default("public"),
  usernameEnc: text("username_enc").notNull(),
  passwordEnc: text("password_enc").notNull(),
  outputFilePath: text("output_file_path"),
  /** Admin-configurable SELECT query executed during workflow fetch. Must be read-only. */
  fetchQuery: text("fetch_query"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  lastTestSuccess: boolean("last_test_success"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DbConnection = typeof dbConnectionsTable.$inferSelect;

export const DATA_JOB_TYPES = ["fetch", "upload_csv", "push"] as const;
export const DATA_JOB_STATUSES = ["pending", "running", "success", "failed"] as const;

export const dataJobsTable = pgTable("data_jobs", {
  id: serial("id").primaryKey(),
  type: text("type").$type<typeof DATA_JOB_TYPES[number]>().notNull(),
  status: text("status").$type<typeof DATA_JOB_STATUSES[number]>().notNull().default("pending"),
  triggeredBy: integer("triggered_by").references(() => usersTable.id, { onDelete: "set null" }),
  triggeredByEmail: text("triggered_by_email"),
  connectionId: integer("connection_id").references(() => dbConnectionsTable.id, { onDelete: "set null" }),
  connectionName: text("connection_name"),
  recordCount: integer("record_count"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DataJob = typeof dataJobsTable.$inferSelect;

export const dataStagingTable = pgTable("data_staging", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => dataJobsTable.id, { onDelete: "cascade" }),
  rowIndex: integer("row_index").notNull(),
  rawData: jsonb("raw_data").$type<Record<string, unknown>>().notNull(),
  transformedData: jsonb("transformed_data").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DataStaging = typeof dataStagingTable.$inferSelect;

export const TRANSFORM_TYPES = ["string", "number", "date-format"] as const;

export const fieldMappingsTable = pgTable("field_mappings", {
  id: serial("id").primaryKey(),
  backofficeField: text("backoffice_field").notNull(),
  tradingField: text("trading_field").notNull(),
  transformType: text("transform_type").$type<typeof TRANSFORM_TYPES[number]>().notNull().default("string"),
  transformParams: text("transform_params"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("field_mapping_bo_idx").on(t.backofficeField),
]);

export type FieldMapping = typeof fieldMappingsTable.$inferSelect;
