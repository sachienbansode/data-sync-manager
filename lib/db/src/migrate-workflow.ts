import pg from "pg";

const { Pool } = pg;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS db_connections (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 5432,
      db_name TEXT NOT NULL,
      schema_name TEXT NOT NULL DEFAULT 'public',
      username_enc TEXT NOT NULL,
      password_enc TEXT NOT NULL,
      output_file_path TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      last_tested_at TIMESTAMPTZ,
      last_test_success BOOLEAN,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS data_jobs (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      triggered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      triggered_by_email TEXT,
      connection_id INTEGER REFERENCES db_connections(id) ON DELETE SET NULL,
      connection_name TEXT,
      record_count INTEGER,
      error_message TEXT,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS data_staging (
      id SERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES data_jobs(id) ON DELETE CASCADE,
      row_index INTEGER NOT NULL,
      raw_data JSONB NOT NULL,
      transformed_data JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS field_mappings (
      id SERIAL PRIMARY KEY,
      backoffice_field TEXT NOT NULL,
      trading_field TEXT NOT NULL,
      transform_type TEXT NOT NULL DEFAULT 'string',
      transform_params TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS field_mapping_bo_idx ON field_mappings(backoffice_field);

    -- Additive migrations: safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
    ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS fetch_query TEXT;

    -- Schedule support (Task #14)
    ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS schedule_enabled BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS schedule_cron TEXT;
    ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS schedule_last_run_at TIMESTAMPTZ;
    ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS schedule_next_run_at TIMESTAMPTZ;

    ALTER TABLE data_jobs ADD COLUMN IF NOT EXISTS triggered_by_schedule BOOLEAN NOT NULL DEFAULT false;

    -- Consecutive failure tracking for scheduled fetches (Task #18)
    ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS schedule_consecutive_failures INTEGER NOT NULL DEFAULT 0;

    -- Write-access control: connections are read-only by default
    ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS allow_writes BOOLEAN NOT NULL DEFAULT false;
  `);

  console.log("Workflow tables created successfully");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
