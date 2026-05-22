-- =============================================================================
-- Migration: Branch Migration Feature
-- Date:      2026-05-22
-- Summary:   Creates branch_migration table, unique constraints, indexes,
--            RBAC page-permission rows for all roles, and seeds initial data.
-- Idempotent: Safe to re-run — all statements use IF NOT EXISTS / ON CONFLICT.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branch_migration (
    branchcode       VARCHAR(30)  NOT NULL,
    branchname       VARCHAR(200),
    defaultcode      VARCHAR(20),
    email            VARCHAR(200),
    address1         VARCHAR(500),
    ccity            VARCHAR(100),
    npincode         VARCHAR(20),
    migration_status VARCHAR(20)  NOT NULL DEFAULT 'Pending'
                     CONSTRAINT branch_migration_migration_status_check
                     CHECK (migration_status IN ('Migrated', 'Pending', 'Planned')),
    migration_date   DATE,
    created_by       VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
    created_datetime TIMESTAMP    NOT NULL DEFAULT now(),
    updated_by       VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
    updated_datetime TIMESTAMP    NOT NULL DEFAULT now(),
    CONSTRAINT pk_branch_migration PRIMARY KEY (branchcode)
);

-- -----------------------------------------------------------------------------
-- 2. Unique constraints (branchcode is already PK)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_bm_branchname'
    ) THEN
        ALTER TABLE branch_migration
            ADD CONSTRAINT uq_bm_branchname UNIQUE (branchname);
        RAISE NOTICE 'Added constraint uq_bm_branchname';
    ELSE
        RAISE NOTICE 'Constraint uq_bm_branchname already exists — skipped';
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_bm_email'
    ) THEN
        ALTER TABLE branch_migration
            ADD CONSTRAINT uq_bm_email UNIQUE (email);
        RAISE NOTICE 'Added constraint uq_bm_email';
    ELSE
        RAISE NOTICE 'Constraint uq_bm_email already exists — skipped';
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Indexes
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_bm_migration_status ON branch_migration (migration_status);
CREATE INDEX IF NOT EXISTS idx_bm_migration_date   ON branch_migration (migration_date);

-- -----------------------------------------------------------------------------
-- 4. RBAC — page_permissions rows
--    Admin (role_id=1)  → can_access = true
--    All others         → can_access = false
--    Adjust per-role as needed after deploy.
-- -----------------------------------------------------------------------------
INSERT INTO page_permissions (role_id, page_path, page_name, can_access)
SELECT r.id,
       '/operations/branch-migration',
       'Branch Migration',
       (r.name = 'Admin')
FROM   roles r
ON CONFLICT (role_id, page_path) DO NOTHING;

-- Confirm Admin access is enabled (in case row existed with false)
UPDATE page_permissions
SET    can_access = true
WHERE  page_path  = '/operations/branch-migration'
  AND  role_id    = (SELECT id FROM roles WHERE name = 'Admin');

-- -----------------------------------------------------------------------------
-- 5. Seed data  (from branch_migration_1779454425202.xlsx)
--    ON CONFLICT updates every field so re-running reflects any corrections.
-- -----------------------------------------------------------------------------
INSERT INTO branch_migration
    (branchcode, branchname, defaultcode, email,
     address1, ccity, npincode,
     migration_status, migration_date, created_by, updated_by)
VALUES
    ('ONL', 'Direct-Online', 'ONL', NULL,
     NULL, NULL, NULL,
     'Migrated', '2026-05-22', 'SYSTEM', 'SYSTEM'),

    ('302', 'Branch-302',    '302', NULL,
     NULL, NULL, NULL,
     'Pending',  NULL,         'SYSTEM', 'SYSTEM')
ON CONFLICT (branchcode) DO UPDATE SET
    branchname       = EXCLUDED.branchname,
    defaultcode      = EXCLUDED.defaultcode,
    email            = EXCLUDED.email,
    address1         = EXCLUDED.address1,
    ccity            = EXCLUDED.ccity,
    npincode         = EXCLUDED.npincode,
    migration_status = EXCLUDED.migration_status,
    migration_date   = EXCLUDED.migration_date,
    updated_by       = 'SYSTEM',
    updated_datetime = now();

-- -----------------------------------------------------------------------------
-- Verification
-- -----------------------------------------------------------------------------
SELECT 'branch_migration rows' AS check_name, COUNT(*)::text AS result
FROM   branch_migration
UNION ALL
SELECT 'page_permissions rows',               COUNT(*)::text
FROM   page_permissions
WHERE  page_path = '/operations/branch-migration';
