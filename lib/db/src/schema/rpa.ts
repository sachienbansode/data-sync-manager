import { pgTable, serial, text, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const RPA_BOT_TYPES = ["browser_automation", "file_processing", "web_scraping"] as const;
export type RpaBotType = typeof RPA_BOT_TYPES[number];

export const RPA_STEP_TYPES = ["navigate", "fill", "click", "wait", "extract", "screenshot", "select", "key_press", "scroll", "hover"] as const;
export type RpaStepType = typeof RPA_STEP_TYPES[number];

export const RPA_RUN_STATUSES = ["pending", "running", "success", "failed"] as const;
export type RpaRunStatus = typeof RPA_RUN_STATUSES[number];

export const RPA_NOTIFY_ON = ["never", "always", "on_failure"] as const;
export type RpaNotifyOn = typeof RPA_NOTIFY_ON[number];

export const RPA_LOG_LEVELS = ["info", "warn", "error", "debug"] as const;
export type RpaLogLevel = typeof RPA_LOG_LEVELS[number];

export const rpaBotsTable = pgTable("rpa_bots", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  botType: text("bot_type").$type<RpaBotType>().notNull().default("browser_automation"),
  isActive: boolean("is_active").notNull().default(true),
  notifyEmail: text("notify_email"),
  notifyOn: text("notify_on").$type<RpaNotifyOn>().notNull().default("never"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RpaBot = typeof rpaBotsTable.$inferSelect;

export const rpaBotStepsTable = pgTable("rpa_bot_steps", {
  id: serial("id").primaryKey(),
  botId: integer("bot_id").notNull().references(() => rpaBotsTable.id, { onDelete: "cascade" }),
  stepOrder: integer("step_order").notNull().default(0),
  stepType: text("step_type").$type<RpaStepType>().notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("rpa_bot_steps_bot_idx").on(t.botId)]);

export type RpaBotStep = typeof rpaBotStepsTable.$inferSelect;

export const rpaBotCredentialsTable = pgTable("rpa_bot_credentials", {
  id: serial("id").primaryKey(),
  botId: integer("bot_id").notNull().references(() => rpaBotsTable.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  usernameEnc: text("username_enc"),
  passwordEnc: text("password_enc"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("rpa_bot_creds_bot_idx").on(t.botId)]);

export type RpaBotCredential = typeof rpaBotCredentialsTable.$inferSelect;

export const rpaBotRunsTable = pgTable("rpa_bot_runs", {
  id: serial("id").primaryKey(),
  botId: integer("bot_id").notNull().references(() => rpaBotsTable.id, { onDelete: "cascade" }),
  status: text("status").$type<RpaRunStatus>().notNull().default("pending"),
  triggeredBy: integer("triggered_by").references(() => usersTable.id, { onDelete: "set null" }),
  triggeredByEmail: text("triggered_by_email"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  screenshotPath: text("screenshot_path"),
  errorMessage: text("error_message"),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("rpa_bot_runs_bot_idx").on(t.botId)]);

export type RpaBotRun = typeof rpaBotRunsTable.$inferSelect;

export const rpaBotLogsTable = pgTable("rpa_bot_logs", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => rpaBotRunsTable.id, { onDelete: "cascade" }),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  level: text("level").$type<RpaLogLevel>().notNull().default("info"),
  message: text("message").notNull(),
}, (t) => [index("rpa_bot_logs_run_idx").on(t.runId)]);

export type RpaBotLog = typeof rpaBotLogsTable.$inferSelect;

export const rpaCredentialsTable = pgTable("rpa_credentials", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  usernameEnc: text("username_enc"),
  passwordEnc: text("password_enc"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RpaCredential = typeof rpaCredentialsTable.$inferSelect;

export const rpaBotSchedulesTable = pgTable("rpa_bot_schedules", {
  id: serial("id").primaryKey(),
  botId: integer("bot_id").notNull().references(() => rpaBotsTable.id, { onDelete: "cascade" }),
  cronExpr: text("cron_expr").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("rpa_bot_schedules_bot_idx").on(t.botId)]);

export type RpaBotSchedule = typeof rpaBotSchedulesTable.$inferSelect;
