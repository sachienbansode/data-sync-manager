#!/usr/bin/env python3
"""
Pipeline Worker — reads data from a source DB and bulk-inserts into a destination DB.
Called by the Node.js API server as a child process.

Input:  JSON on stdin
Output: JSON on stdout  { success, recordCount, error }
Logs:   human-readable progress on stderr (never logs row values)
"""

import sys
import json
from datetime import datetime, timezone


def log(msg):
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{ts}] {msg}", file=sys.stderr, flush=True)


def sanitize_error(e: Exception) -> str:
    """Strip raw SQL, parameter lists and data values from DB exception messages."""
    msg = str(e)
    safe_lines = []
    for line in msg.split("\n"):
        t = line.strip()
        if any(t.startswith(p) for p in (
            "[SQL:", "[parameters:", "(Background on this error",
            "DETAIL:", "HINT:", "CONTEXT:", "LINE ",
        )):
            continue
        if len(t) > 300:
            t = t[:300] + "…"
        if t:
            safe_lines.append(t)
    result = " ".join(safe_lines).strip()
    return (result[:500] + "…") if len(result) > 500 else (result or type(e).__name__)


def fail(error_msg):
    log(f"FATAL: {error_msg}")
    print(json.dumps({"success": False, "error": error_msg}))
    sys.exit(1)


def main():
    log("Pipeline worker started")

    # ── Parse config ─────────────────────────────────────────────────────────
    try:
        config = json.load(sys.stdin)
    except Exception as e:
        fail(f"Failed to parse config: {e}")

    try:
        import pandas as pd
        from sqlalchemy import create_engine, text, Table, MetaData
    except ImportError as e:
        fail(f"Missing dependency: {e}. Run: pip install pandas sqlalchemy psycopg2-binary")

    src            = config.get("source", {})
    dst            = config.get("dest", {})
    source_query   = config.get("sourceQuery", "").strip()
    dest_target    = config.get("destTarget", "").strip()
    field_mappings = config.get("fieldMappings", [])
    chunk_size     = int(config.get("chunkSize", 5000))
    pre_sql        = (config.get("preSqlCommand")  or "").strip()
    post_sql       = (config.get("postSqlCommand") or "").strip()

    if not source_query:
        fail("sourceQuery is required")
    if not dest_target:
        fail("destTarget is required")

    # Guard: destTarget must be a table reference, never a raw SELECT
    dest_upper = dest_target.upper().lstrip()
    if dest_upper.startswith("SELECT") or dest_upper.startswith("WITH ") or dest_upper.startswith("("):
        fail(
            f"destTarget must be a table name (e.g. 'public.my_table'), not a SQL query. "
            f"Received: {dest_target[:80]}"
        )

    # ── Build connection URLs ─────────────────────────────────────────────────
    def build_url(conn):
        from urllib.parse import quote_plus
        engine   = conn.get("engine", "postgresql")
        raw_host = (conn.get("host") or "localhost").strip()
        host     = raw_host.split("@")[-1] if "@" in raw_host else raw_host
        port     = conn.get("port", 5432)
        database = conn.get("database", "") or ""
        user     = quote_plus(conn.get("username", "") or "")
        password = quote_plus(conn.get("password", "") or "")

        if engine in ("postgresql", "postgres"):
            return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{database}"
        elif engine == "mysql":
            return f"mysql+pymysql://{user}:{password}@{host}:{port}/{database}"
        elif engine in ("mssql", "sqlserver"):
            return f"mssql+pyodbc://{user}:{password}@{host}:{port}/{database}?driver=ODBC+Driver+17+for+SQL+Server"
        else:
            return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{database}"

    log(f"Source:      {src.get('engine','postgresql')} @ {src.get('host')}:{src.get('port')}/{src.get('database')}")
    log(f"Destination: {dst.get('engine','postgresql')} @ {dst.get('host')}:{dst.get('port')}/{dst.get('database')}")
    log(f"Destination table: {dest_target}")

    try:
        src_engine = create_engine(build_url(src), pool_pre_ping=True)
        dst_engine = create_engine(build_url(dst), pool_pre_ping=True)
    except Exception as e:
        fail(f"Failed to create DB engines: {sanitize_error(e)}")

    # ── PRE-SQL on destination ───────────────────────────────────────────────
    if pre_sql:
        log(f"[PRE-SQL] Executing pre-load SQL on destination")
        log(f"  Commands: {pre_sql[:200]}{'...' if len(pre_sql) > 200 else ''}")
        try:
            with dst_engine.connect() as conn:
                for stmt in [s.strip() for s in pre_sql.split(";") if s.strip()]:
                    log(f"  Executing: {stmt[:100]}{'...' if len(stmt) > 100 else ''}")
                    conn.execute(text(stmt))
                conn.commit()
            log("[PRE-SQL DONE] Pre-load SQL completed successfully")
        except Exception as e:
            fail(f"Pre-load SQL failed: {sanitize_error(e)}")
    else:
        log("[PRE-SQL] No pre-load SQL configured — skipping")

    # ── STEP 1: Fetch from source ─────────────────────────────────────────────
    log(f"[STEP 1] Reading source data")
    log(f"  Query: {source_query[:200]}{'...' if len(source_query) > 200 else ''}")

    try:
        chunks = []
        with src_engine.connect() as conn:
            for chunk in pd.read_sql_query(text(source_query), conn, chunksize=chunk_size):
                chunks.append(chunk)
                running = sum(len(c) for c in chunks)
                log(f"  Fetched chunk #{len(chunks)}: {len(chunk)} rows (running total: {running})")
        src_engine.dispose()
        df = pd.concat(chunks, ignore_index=True) if chunks else pd.DataFrame()
    except Exception as e:
        fail(f"Source read failed: {sanitize_error(e)}")

    record_count = len(df)
    log(f"[STEP 1 DONE] Fetched {record_count} rows, {len(df.columns)} column(s): {list(df.columns)}")

    if record_count == 0:
        log("Source returned 0 rows — nothing to insert.")
        # Still run post-SQL if configured
        if post_sql:
            log(f"[POST-SQL] Executing post-load SQL (0 rows case)")
            try:
                with dst_engine.connect() as conn:
                    for stmt in [s.strip() for s in post_sql.split(";") if s.strip()]:
                        conn.execute(text(stmt))
                    conn.commit()
                log("[POST-SQL DONE] Post-load SQL completed")
            except Exception as e:
                fail(f"Post-load SQL failed: {sanitize_error(e)}")
        print(json.dumps({"success": True, "recordCount": 0}))
        sys.exit(0)

    # ── STEP 2: Apply field mappings ──────────────────────────────────────────
    if field_mappings:
        log(f"[STEP 2] Applying {len(field_mappings)} field mapping(s)")
        rename_map    = {}
        transform_map = {}
        for m in field_mappings:
            src_field = m.get("sourceField", "")
            dst_field = m.get("destField", "")
            if src_field and dst_field:
                rename_map[src_field] = dst_field
                tt = m.get("transformType", "passthrough")
                if tt and tt != "passthrough":
                    transform_map[dst_field] = m

        keep_cols = [c for c in rename_map if c in df.columns]
        missing   = [c for c in rename_map if c not in df.columns]
        if missing:
            log(f"  WARNING: source columns not found (skipped): {missing}")
        df = df[keep_cols].rename(columns=rename_map)

        for col, mapping in transform_map.items():
            if col not in df.columns:
                continue
            t      = mapping.get("transformType", "passthrough")
            params = mapping.get("transformParams", "") or ""
            log(f"  Applying transform '{t}' on column '{col}'")
            if t == "string":
                df[col] = df[col].astype(str).where(df[col].notna(), None)
            elif t == "number":
                df[col] = pd.to_numeric(df[col], errors="coerce")
            elif t == "boolean":
                df[col] = df[col].map(
                    lambda v: str(v).lower() in ("true", "1", "yes", "y") if v is not None else None
                )
            elif t == "date-format":
                df[col] = pd.to_datetime(df[col], errors="coerce")
                fmt_str = (
                    params
                    .replace("YYYY", "%Y").replace("MM", "%m").replace("DD", "%d")
                    .replace("HH", "%H").replace("mm", "%M").replace("ss", "%S")
                ) if params else "%Y-%m-%d"
                df[col] = df[col].dt.strftime(fmt_str)

        log(f"[STEP 2 DONE] {len(df.columns)} output column(s): {list(df.columns)}")
    else:
        log("[STEP 2] No field mappings — all source columns passed through")

    # ── STEP 3: INSERT into destination (no DDL) ──────────────────────────────
    if "." in dest_target:
        schema_part, table_part = dest_target.split(".", 1)
    else:
        schema_part = None
        table_part  = dest_target

    log(f"[STEP 3] Inserting {record_count} rows into destination")
    log(f"  Target: schema={schema_part!r}  table={table_part!r}")

    try:
        metadata  = MetaData()
        with dst_engine.connect() as conn:
            log("  Reflecting destination table structure…")
            dst_table = Table(table_part, metadata, schema=schema_part, autoload_with=dst_engine)
            log(f"  Destination columns: {[c.name for c in dst_table.columns]}")

            records  = df.where(df.notna(), other=None).to_dict(orient="records")
            inserted = 0
            batch_num = 0
            for i in range(0, len(records), chunk_size):
                batch = records[i: i + chunk_size]
                batch_num += 1
                conn.execute(dst_table.insert(), batch)
                inserted += len(batch)
                log(f"  Batch #{batch_num}: {len(batch)} rows inserted (total: {inserted})")

            conn.commit()
            log("  Transaction committed.")
        dst_engine.dispose()
    except Exception as e:
        fail(f"Destination write failed: {sanitize_error(e)}")

    log(f"[STEP 3 DONE] Successfully inserted {record_count} rows into {dest_target}")

    # ── POST-SQL on destination ──────────────────────────────────────────────
    if post_sql:
        log(f"[POST-SQL] Executing post-load SQL on destination")
        log(f"  Commands: {post_sql[:200]}{'...' if len(post_sql) > 200 else ''}")
        try:
            with dst_engine.connect() as conn:
                for stmt in [s.strip() for s in post_sql.split(";") if s.strip()]:
                    log(f"  Executing: {stmt[:100]}{'...' if len(stmt) > 100 else ''}")
                    conn.execute(text(stmt))
                conn.commit()
            log("[POST-SQL DONE] Post-load SQL completed successfully")
        except Exception as e:
            fail(f"Post-load SQL failed: {sanitize_error(e)}")
    else:
        log("[POST-SQL] No post-load SQL configured — skipping")

    log("Worker completed successfully.")
    print(json.dumps({"success": True, "recordCount": record_count}))


if __name__ == "__main__":
    main()
