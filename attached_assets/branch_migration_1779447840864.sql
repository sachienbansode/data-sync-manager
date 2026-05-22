-- =============================================================================
-- DATABASE  : uat_ananta_staging
-- SCHEMA    : public
-- TABLE     : branch_migration
-- PURPOSE   : Track branch migration status — Migrated / Pending / Planned
-- NOTE      : This output is AI-generated and must be reviewed and approved
--             before business or regulatory use.
-- Run this script connected to database: uat_ananta_staging
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.branch_migration (

    -- ─── Branch Details (from stg.ASK_BRANCHMASTER) ───────────────────────────
    branchcode              VARCHAR(30)         NOT NULL,
    branchname              VARCHAR(200),
    defaultcode             VARCHAR(20),
    email                   VARCHAR(200),
    address1                VARCHAR(500),
    ccity                   VARCHAR(100),
    npincode                VARCHAR(20),

    -- ─── Migration Tracking ───────────────────────────────────────────────────
    migration_status        VARCHAR(20)         NOT NULL DEFAULT 'Pending'
                                CHECK (migration_status IN ('Migrated', 'Pending', 'Planned')),
    migration_date          DATE,

    -- ─── Audit Columns ────────────────────────────────────────────────────────
    created_by              VARCHAR(100)        NOT NULL DEFAULT 'SYSTEM',
    created_datetime        TIMESTAMP           NOT NULL DEFAULT NOW(),
    updated_by              VARCHAR(100)        NOT NULL DEFAULT 'SYSTEM',
    updated_datetime        TIMESTAMP           NOT NULL DEFAULT NOW(),

    -- ─── Constraint ───────────────────────────────────────────────────────────
    CONSTRAINT pk_branch_migration PRIMARY KEY (branchcode)
);

-- ─── Index on migration_status for quick status-based filtering ───────────────
CREATE INDEX IF NOT EXISTS idx_bm_migration_status
    ON public.branch_migration (migration_status);

CREATE INDEX IF NOT EXISTS idx_bm_migration_date
    ON public.branch_migration (migration_date);

-- ─── Comment ─────────────────────────────────────────────────────────────────
COMMENT ON TABLE public.branch_migration IS
    'Tracks branch migration status. '
    'Source: stg.ASK_BRANCHMASTER. migration_status: Migrated / Pending / Planned.';

COMMENT ON COLUMN public.branch_migration.migration_status IS
    'Migrated = branch fully migrated to DWH; Pending = awaiting migration; Planned = scheduled for migration';
COMMENT ON COLUMN public.branch_migration.migration_date   IS
    'Date on which migration was completed or is planned';
COMMENT ON COLUMN public.branch_migration.created_by       IS
    'User or job that inserted the record';
COMMENT ON COLUMN public.branch_migration.updated_by       IS
    'User or job that last updated the record';

-- =============================================================================
-- END OF SCRIPT
-- =============================================================================
