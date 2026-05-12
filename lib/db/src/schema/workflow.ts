import { pgTable, serial, text, integer, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/** Reference table for AWS region codes and display names. */
export const awsRegionsTable = pgTable("aws_regions", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),       // e.g. "us-east-1"
  name: text("name").notNull(),       // e.g. "US East (N. Virginia)"
  regionGroup: text("region_group").notNull(), // e.g. "US East"
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [uniqueIndex("aws_regions_code_idx").on(t.code)]);

export const DB_CONNECTION_TYPES = ["backoffice", "trading"] as const;
export type DbConnectionType = string;

export const DB_ENGINES = ["postgresql", "mysql", "mssql", "oracle", "s3", "sftp", "csv"] as const;
export type DbEngine = typeof DB_ENGINES[number];

/** A DB connection is purely a credential store — one connection = one application/database.
 *  The same connection can be reused across many data objects and pipelines. */
export const dbConnectionsTable = pgTable("db_connections", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  dbEngine: text("db_engine").$type<DbEngine>().notNull().default("postgresql"),
  host: text("host"),
  port: integer("port").default(5432),
  dbName: text("db_name"),
  schemaName: text("schema_name").default("public"),
  usernameEnc: text("username_enc"),
  passwordEnc: text("password_enc"),
  /** Extra engine-specific params (bucket, region, remotePath, etc.) stored as JSON */
  extraParams: jsonb("extra_params").$type<Record<string, string>>(),
  /** Legacy: SELECT-only query for fetching data from this connection (kept for compat) */
  fetchQuery: text("fetch_query"),
  /** Legacy: Local file path where transformed CSV output is written (kept for compat) */
  outputFilePath: text("output_file_path"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
  lastTestSuccess: boolean("last_test_success"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DbConnection = typeof dbConnectionsTable.$inferSelect;

export const CONNECTION_OBJECT_TYPES = ["table", "query"] as const;
export type ConnectionObjectType = typeof CONNECTION_OBJECT_TYPES[number];

/** Step 2: A named data object tied to a connection.
 *  objectType='table' → objectValue is a table/view name (SELECT * FROM schema.objectValue).
 *  objectType='query' → objectValue is a full SQL SELECT statement.
 *  One connection can have many objects; objects are reused across pipelines. */
export const connectionObjectsTable = pgTable("connection_objects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  connectionId: integer("connection_id").notNull().references(() => dbConnectionsTable.id, { onDelete: "cascade" }),
  objectType: text("object_type").$type<ConnectionObjectType>().notNull().default("table"),
  /** For 'table': table/view name. For 'query': full SELECT SQL. */
  objectValue: text("object_value").notNull(),
  description: text("description"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ConnectionObject = typeof connectionObjectsTable.$inferSelect;

export const DATA_JOB_TYPES = ["fetch", "upload_csv", "push", "pipeline"] as const;
export const DATA_JOB_STATUSES = ["pending", "running", "success", "failed"] as const;

export const dataJobsTable = pgTable("data_jobs", {
  id: serial("id").primaryKey(),
  type: text("type").$type<typeof DATA_JOB_TYPES[number]>().notNull(),
  status: text("status").$type<typeof DATA_JOB_STATUSES[number]>().notNull().default("pending"),
  triggeredBy: integer("triggered_by").references(() => usersTable.id, { onDelete: "set null" }),
  triggeredByEmail: text("triggered_by_email"),
  triggeredBySchedule: boolean("triggered_by_schedule").notNull().default(false),
  connectionId: integer("connection_id").references(() => dbConnectionsTable.id, { onDelete: "set null" }),
  connectionName: text("connection_name"),
  pipelineId: integer("pipeline_id"),
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

export const TRANSFORM_TYPES = ["string", "number", "date-format", "boolean", "passthrough"] as const;

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

export const PIPELINE_STATUSES = ["active", "inactive"] as const;

/** Step 3: A data pipeline moves data from a source object to a destination object.
 *  Source and destination are connection objects (Step 2).
 *  Legacy fields (sourceConnectionId, sourceTable, sourceQuery, destConnectionId, destTarget) kept for backward compat. */
export const dataPipelinesTable = pgTable("data_pipelines", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  /** Source data object (Step 2). Takes precedence over legacy sourceConnectionId/sourceTable/sourceQuery. */
  sourceObjectId: integer("source_object_id").references(() => connectionObjectsTable.id, { onDelete: "set null" }),
  /** Destination data object (Step 2). Takes precedence over legacy destConnectionId/destTarget. */
  destObjectId: integer("dest_object_id").references(() => connectionObjectsTable.id, { onDelete: "set null" }),
  /** Legacy: The source DB connection (credentials). */
  sourceConnectionId: integer("source_connection_id").references(() => dbConnectionsTable.id, { onDelete: "set null" }),
  /** Legacy: The destination DB connection (credentials). */
  destConnectionId: integer("dest_connection_id").references(() => dbConnectionsTable.id, { onDelete: "set null" }),
  /** Legacy: Simple table name on the source. */
  sourceTable: text("source_table"),
  /** Legacy: Custom SELECT query overriding sourceTable. */
  sourceQuery: text("source_query"),
  /** Legacy: Target table on the destination. */
  destTarget: text("dest_target"),
  status: text("status").$type<typeof PIPELINE_STATUSES[number]>().notNull().default("inactive"),
  scheduleEnabled: boolean("schedule_enabled").notNull().default(false),
  scheduleCron: text("schedule_cron"),
  scheduleLastRunAt: timestamp("schedule_last_run_at", { withTimezone: true }),
  scheduleNextRunAt: timestamp("schedule_next_run_at", { withTimezone: true }),
  /** Number of consecutive scheduled run failures (reset on success). */
  scheduleConsecutiveFailures: integer("schedule_consecutive_failures").notNull().default(0),
  /** Comma-separated email addresses to notify on successful pipeline run */
  notifyOnSuccess: text("notify_on_success"),
  /** Comma-separated email addresses to notify on failed pipeline run */
  notifyOnFailure: text("notify_on_failure"),
  /** 'full_load' truncates destination before insert; 'incremental' appends/upserts */
  loadType: text("load_type").$type<"full_load" | "incremental">().notNull().default("full_load"),
  /** SQL commands to run on destination before the main data transfer (e.g. TRUNCATE, DELETE) */
  preSqlCommand: text("pre_sql_command"),
  /** SQL commands to run on destination after the main data transfer (e.g. ANALYZE, UPDATE flags) */
  postSqlCommand: text("post_sql_command"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DataPipeline = typeof dataPipelinesTable.$inferSelect;

/** Field-level mappings for a pipeline (source field → destination field). */
export const pipelineFieldMappingsTable = pgTable("pipeline_field_mappings", {
  id: serial("id").primaryKey(),
  pipelineId: integer("pipeline_id").notNull().references(() => dataPipelinesTable.id, { onDelete: "cascade" }),
  sourceField: text("source_field").notNull(),
  destField: text("dest_field").notNull(),
  transformType: text("transform_type").$type<typeof TRANSFORM_TYPES[number]>().notNull().default("passthrough"),
  transformParams: text("transform_params"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PipelineFieldMapping = typeof pipelineFieldMappingsTable.$inferSelect;
