#!/usr/bin/env python3
"""
Pipeline Worker — high-performance streaming ETL.

Architecture:
  Source  → server-side named cursor        (PostgreSQL)
           → native oracledb thin cursor    (Oracle  — no Instant Client required)
           → chunked SQLAlchemy + pandas    (MySQL / MSSQL / others)
  Insert  → COPY via StringIO for full_load  (fastest, no row-by-row overhead)
           → execute_values + ON CONFLICT DO UPDATE for incremental upserts
  Safety  → watermark persisted to /tmp after every committed batch
  Logging → stderr only, never logs row values

Input:  JSON on stdin
Output: JSON on stdout  { success, recordCount, error?, newWatermark? }
"""

import sys
import json
import io
import os
import tempfile
from datetime import datetime, timezone


# ── Helpers ──────────────────────────────────────────────────────────────────

def log(msg: str) -> None:
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


def fail(error_msg: str) -> None:
    log(f"FATAL: {error_msg}")
    print(json.dumps({"success": False, "error": error_msg}))
    sys.exit(1)


def save_watermark(pipeline_id: int, value: str) -> None:
    """Persist watermark to /tmp after each committed batch for crash durability."""
    try:
        path = os.path.join(tempfile.gettempdir(), f"ashika_wm_{pipeline_id}.json")
        with open(path, "w") as f:
            json.dump({"watermark": value, "ts": datetime.now(timezone.utc).isoformat()}, f)
    except Exception:
        pass  # non-fatal


# ── Connection helpers ────────────────────────────────────────────────────────

def build_psycopg2_params(conn: dict) -> dict:
    """Return kwargs for psycopg2.connect()."""
    raw_host = (conn.get("host") or "localhost").strip()
    host = raw_host.split("@")[-1] if "@" in raw_host else raw_host
    return {
        "host": host,
        "port": int(conn.get("port", 5432)),
        "dbname": conn.get("database", "") or "",
        "user": conn.get("username", "") or "",
        "password": conn.get("password", "") or "",
        "connect_timeout": 15,
        "application_name": "ashika_etl_worker",
    }


def build_sqlalchemy_url(conn: dict) -> str:
    """Return a SQLAlchemy URL string (used for non-PostgreSQL and table reflection)."""
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
    elif engine in ("oracle", "oracledb"):
        service = database or "ORCL"
        return f"oracle+oracledb://{user}:{password}@{host}:{port}/?service_name={service}"
    return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{database}"


# ── Field mapping ─────────────────────────────────────────────────────────────

def apply_field_mappings(row_dicts: list, field_mappings: list) -> list:
    """Apply rename + type transforms to a batch of row dicts. Returns new list."""
    if not field_mappings:
        return row_dicts
    import pandas as pd

    df = pd.DataFrame(row_dicts)
    rename_map, transform_map = {}, {}
    for m in field_mappings:
        sf, df_col = m.get("sourceField", ""), m.get("destField", "")
        if sf and df_col:
            rename_map[sf] = df_col
            tt = m.get("transformType", "passthrough")
            if tt and tt != "passthrough":
                transform_map[df_col] = m

    keep = [c for c in rename_map if c in df.columns]
    df = df[keep].rename(columns=rename_map)

    for col, mapping in transform_map.items():
        if col not in df.columns:
            continue
        t = mapping.get("transformType", "passthrough")
        params = mapping.get("transformParams", "") or ""
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
            fmt = (
                params
                .replace("YYYY", "%Y").replace("MM", "%m").replace("DD", "%d")
                .replace("HH", "%H").replace("mm", "%M").replace("ss", "%S")
            ) if params else "%Y-%m-%d"
            df[col] = df[col].dt.strftime(fmt)

    return df.where(df.notna(), other=None).to_dict(orient="records")


def update_watermark(rows: list, watermark_col: str, current: str) -> str:
    """Return the new max watermark value from this batch (as string for storage)."""
    try:
        vals = [r[watermark_col] for r in rows if r.get(watermark_col) is not None]
        if not vals:
            return current
        batch_max = str(max(vals))
        return batch_max if (not current or batch_max > current) else current
    except Exception:
        return current


# ── COPY buffer builder ───────────────────────────────────────────────────────

def rows_to_copy_buffer(rows: list, columns: list) -> io.StringIO:
    """
    Convert row dicts to a tab-delimited StringIO buffer for:
      COPY table (col1, col2, ...) FROM STDIN WITH (FORMAT TEXT, NULL '\\N')
    NULL values become \\N; special chars are escaped per PostgreSQL TEXT format.
    bytes/bytearray (e.g. Oracle BLOB) are written as PostgreSQL hex-escape \\x<hex>.
    """
    buf = io.StringIO()
    for row in rows:
        parts = []
        for col in columns:
            val = row.get(col)
            if val is None:
                parts.append("\\N")
            elif isinstance(val, (bytes, bytearray)):
                # PostgreSQL TEXT-format COPY: bytea hex notation
                parts.append("\\\\x" + val.hex())
            else:
                s = (
                    str(val)
                    .replace("\\", "\\\\")
                    .replace("\n", "\\n")
                    .replace("\r", "\\r")
                    .replace("\t", "\\t")
                )
                parts.append(s)
        buf.write("\t".join(parts) + "\n")
    buf.seek(0)
    return buf


# ── Destination batch writer ──────────────────────────────────────────────────

def write_pg_batch(
    cur,
    dest_target: str,
    write_cols: list,
    rows: list,
    load_type: str,
    conflict_col_list: list,
    chunk_size: int,
) -> None:
    """
    Write one batch to a PostgreSQL destination.
    • full_load              → COPY via StringIO (fastest pure-insert path)
    • incremental + conflict → execute_values + ON CONFLICT DO UPDATE (upsert)
    • incremental            → execute_values plain append
    """
    from psycopg2.extras import execute_values

    if load_type == "full_load":
        buf = rows_to_copy_buffer(rows, write_cols)
        col_str = ", ".join(f'"{c}"' for c in write_cols)
        cur.copy_expert(
            f'COPY {dest_target} ({col_str}) FROM STDIN WITH (FORMAT TEXT, NULL \'\\N\')',
            buf,
        )

    elif conflict_col_list:
        # Upsert: ON CONFLICT (key_cols) DO UPDATE SET non-key cols = EXCLUDED.col
        update_cols = [c for c in write_cols if c not in conflict_col_list]
        col_str     = ", ".join(f'"{c}"' for c in write_cols)
        conflict_str = ", ".join(f'"{c}"' for c in conflict_col_list)
        if update_cols:
            set_clause = ", ".join(f'"{c}" = EXCLUDED."{c}"' for c in update_cols)
        else:
            # All columns are in the conflict key — do nothing on conflict
            set_clause = None

        if set_clause:
            sql = (
                f'INSERT INTO {dest_target} ({col_str}) VALUES %s '
                f'ON CONFLICT ({conflict_str}) DO UPDATE SET {set_clause}'
            )
        else:
            sql = (
                f'INSERT INTO {dest_target} ({col_str}) VALUES %s '
                f'ON CONFLICT ({conflict_str}) DO NOTHING'
            )
        data = [[row.get(c) for c in write_cols] for row in rows]
        execute_values(cur, sql, data, page_size=chunk_size)

    else:
        # Plain incremental append via execute_values (faster than executemany)
        col_str = ", ".join(f'"{c}"' for c in write_cols)
        sql = f'INSERT INTO {dest_target} ({col_str}) VALUES %s'
        data = [[row.get(c) for c in write_cols] for row in rows]
        execute_values(cur, sql, data, page_size=chunk_size)


def write_sa_batch(sa_engine, sa_table, rows: list) -> None:
    """Fallback writer for non-PostgreSQL destinations using SQLAlchemy."""
    with sa_engine.connect() as conn:
        conn.execute(sa_table.insert(), rows)
        conn.commit()


# ── SQL execution helper (pre/post) ──────────────────────────────────────────

def run_sql_statements(label: str, sql: str, dst_is_pg: bool, dst_params: dict, dst_url: str) -> None:
    stmts = [s.strip() for s in sql.split(";") if s.strip()]
    log(f"[{label}] Executing {len(stmts)} statement(s)")
    if dst_is_pg:
        import psycopg2
        conn = psycopg2.connect(**dst_params)
        try:
            with conn.cursor() as cur:
                for stmt in stmts:
                    log(f"  → {stmt[:120]}{'…' if len(stmt) > 120 else ''}")
                    cur.execute(stmt)
            conn.commit()
        finally:
            conn.close()
    else:
        from sqlalchemy import create_engine, text
        engine = create_engine(dst_url)
        with engine.connect() as conn:
            for stmt in stmts:
                log(f"  → {stmt[:120]}{'…' if len(stmt) > 120 else ''}")
                conn.execute(text(stmt))
            conn.commit()
        engine.dispose()
    log(f"[{label} DONE]")


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    log("Pipeline worker started (streaming / COPY mode)")

    # ── Parse config ──────────────────────────────────────────────────────────
    try:
        config = json.load(sys.stdin)
    except Exception as e:
        fail(f"Failed to parse config: {e}")

    src             = config.get("source", {})
    dst             = config.get("dest", {})
    source_query    = config.get("sourceQuery", "").strip()
    dest_target     = config.get("destTarget", "").strip()
    field_mappings  = config.get("fieldMappings", [])
    chunk_size      = int(config.get("chunkSize", 5000))
    pre_sql         = (config.get("preSqlCommand")    or "").strip()
    post_sql        = (config.get("postSqlCommand")   or "").strip()
    load_type       = (config.get("loadType")         or "full_load").strip()
    conflict_cols   = (config.get("conflictColumns")  or "").strip()
    watermark_col   = (config.get("watermarkColumn")  or "").strip()
    current_wm      = (config.get("currentWatermark") or "").strip()
    pipeline_id     = int(config.get("pipelineId", 0))

    if not source_query:
        fail("sourceQuery is required")
    if not dest_target:
        fail("destTarget is required")

    dest_upper = dest_target.upper().lstrip()
    if dest_upper.startswith("SELECT") or dest_upper.startswith("WITH ") or dest_upper.startswith("("):
        fail(f"destTarget must be a table name (e.g. public.my_table). Received: {dest_target[:80]}")

    src_engine_type = (src.get("engine") or "postgresql").strip()
    dst_engine_type = (dst.get("engine") or "postgresql").strip()
    src_is_pg = src_engine_type in ("postgresql", "postgres")
    dst_is_pg = dst_engine_type in ("postgresql", "postgres")

    conflict_col_list = [c.strip() for c in conflict_cols.split(",") if c.strip()]

    log(f"Source:        {src_engine_type} @ {src.get('host')}:{src.get('port')}/{src.get('database')}")
    log(f"Destination:   {dst_engine_type} @ {dst.get('host')}:{dst.get('port')}/{dst.get('database')}")
    log(f"Dest table:    {dest_target}")
    log(f"Load type:     {load_type}  |  conflict_cols: {conflict_cols or '(none)'}  |  watermark_col: {watermark_col or '(none)'}")

    # Import required libraries
    try:
        import psycopg2
        import pandas as pd
    except ImportError as e:
        fail(f"Missing dependency: {e}. Run: pip install psycopg2-binary pandas")

    dst_pg_params = build_psycopg2_params(dst) if dst_is_pg else {}
    dst_url       = build_sqlalchemy_url(dst)

    # ── PRE-SQL ───────────────────────────────────────────────────────────────
    if pre_sql:
        try:
            run_sql_statements("PRE-SQL", pre_sql, dst_is_pg, dst_pg_params, dst_url)
        except Exception as e:
            fail(f"Pre-load SQL failed: {sanitize_error(e)}")
    else:
        log("[PRE-SQL] Skipped (not configured)")

    # ── Reflect destination table (get column list) ───────────────────────────
    log("[REFLECT] Reading destination table structure")
    if "." in dest_target:
        dst_schema, dst_table_name = dest_target.split(".", 1)
    else:
        dst_schema, dst_table_name = None, dest_target

    try:
        from sqlalchemy import create_engine as sa_engine_fn, Table, MetaData
        reflect_engine = sa_engine_fn(dst_url)
        metadata       = MetaData()
        dst_sa_table   = Table(dst_table_name, metadata, schema=dst_schema, autoload_with=reflect_engine)
        dst_all_cols   = [c.name for c in dst_sa_table.columns]
        reflect_engine.dispose()
        log(f"  Destination columns ({len(dst_all_cols)}): {dst_all_cols}")
    except Exception as e:
        fail(f"Failed to reflect destination table: {sanitize_error(e)}")

    # ── Open destination connection (reused across all batches) ───────────────
    log("[DEST] Opening destination connection")
    dst_conn, dst_cur, dst_sa_engine = None, None, None
    try:
        if dst_is_pg:
            dst_conn = psycopg2.connect(**dst_pg_params)
            dst_conn.autocommit = False
            dst_cur  = dst_conn.cursor()
        else:
            from sqlalchemy import create_engine as sa_dst_fn
            dst_sa_engine = sa_dst_fn(dst_url, pool_size=2, max_overflow=0, pool_pre_ping=True)
    except Exception as e:
        fail(f"Failed to connect to destination: {sanitize_error(e)}")

    # ── Stream source and write batches ───────────────────────────────────────
    total_source   = 0   # rows read from source
    total_inserted = 0   # rows written to destination
    batch_num      = 0
    new_watermark  = current_wm
    write_cols     = None  # determined on first batch

    try:
        if src_is_pg:
            # ── PostgreSQL source: server-side named cursor for true streaming ──
            src_pg_params = build_psycopg2_params(src)
            src_conn = psycopg2.connect(**src_pg_params)
            src_conn.autocommit = True   # prevent idle transaction wrapping the cursor
            src_cur  = src_conn.cursor(name="ashika_etl_src")
            src_cur.arraysize = chunk_size
            log(f"[SRC] Executing query via server-side cursor (arraysize={chunk_size})")
            log(f"  Query: {source_query[:200]}{'…' if len(source_query) > 200 else ''}")
            src_cur.execute(source_query)
            src_col_names = [desc[0] for desc in src_cur.description]
            log(f"  Source columns ({len(src_col_names)}): {src_col_names}")

            while True:
                raw_rows = src_cur.fetchmany(chunk_size)
                if not raw_rows:
                    break
                batch_num += 1
                row_dicts = [dict(zip(src_col_names, row)) for row in raw_rows]

                if field_mappings:
                    row_dicts = apply_field_mappings(row_dicts, field_mappings)

                if write_cols is None:
                    write_cols = [c for c in row_dicts[0].keys() if c in dst_all_cols] if row_dicts else []
                    if not write_cols:
                        fail("No matching columns found between source (after mappings) and destination table")
                    log(f"  Write columns ({len(write_cols)}): {write_cols}")

                if watermark_col:
                    wm_col_check = watermark_col if watermark_col in (row_dicts[0] if row_dicts else {}) else None
                    if wm_col_check:
                        new_watermark = update_watermark(row_dicts, wm_col_check, new_watermark)

                total_source += len(row_dicts)
                filtered = [{k: v for k, v in r.items() if k in write_cols} for r in row_dicts]

                if dst_is_pg:
                    write_pg_batch(dst_cur, dest_target, write_cols, filtered, load_type, conflict_col_list, chunk_size)
                    dst_conn.commit()
                else:
                    write_sa_batch(dst_sa_engine, dst_sa_table, filtered)

                total_inserted += len(filtered)
                log(f"  Batch #{batch_num}: src={len(row_dicts):,} dst={len(filtered):,} (totals src={total_source:,} dst={total_inserted:,})")

                if pipeline_id and new_watermark:
                    save_watermark(pipeline_id, new_watermark)

            src_cur.close()
            src_conn.close()
            log(f"[SRC] Source cursor closed")

        elif src_engine_type in ("oracle", "oracledb"):
            # ── Oracle source: native oracledb thin (no Instant Client needed) ──
            try:
                import oracledb
            except ImportError:
                fail("Missing dependency: oracledb.  Run: pip install oracledb")

            # Fetch LOBs as plain Python str / bytes — avoids LOB object reads
            oracledb.defaults.fetch_lobs = False

            ora_host    = (src.get("host") or "localhost").strip().split("@")[-1]
            ora_port    = int(src.get("port") or 1521)
            ora_service = (src.get("database") or "ORCL").strip()
            ora_user    = (src.get("username") or "").strip()
            ora_pass    = (src.get("password") or "").strip()
            ora_dsn     = f"{ora_host}:{ora_port}/{ora_service}"

            log(f"[SRC] Oracle (oracledb thin) {ora_user}@{ora_dsn}")
            log(f"  Query: {source_query[:200]}{'…' if len(source_query) > 200 else ''}")

            src_ora_conn = oracledb.connect(user=ora_user, password=ora_pass, dsn=ora_dsn)
            src_ora_cur  = src_ora_conn.cursor()
            src_ora_cur.arraysize = chunk_size
            src_ora_cur.execute(source_query)

            # Oracle returns column names in UPPER CASE; lowercase to match PG convention
            src_col_names = [col[0].lower() for col in src_ora_cur.description]
            log(f"  Source columns ({len(src_col_names)}): {src_col_names}")

            while True:
                raw_rows = src_ora_cur.fetchmany(chunk_size)
                if not raw_rows:
                    break
                batch_num += 1
                row_dicts = [dict(zip(src_col_names, row)) for row in raw_rows]

                if field_mappings:
                    row_dicts = apply_field_mappings(row_dicts, field_mappings)

                if write_cols is None:
                    write_cols = [c for c in row_dicts[0].keys() if c in dst_all_cols] if row_dicts else []
                    if not write_cols:
                        fail("No matching columns found between source (after mappings) and destination table")
                    log(f"  Write columns ({len(write_cols)}): {write_cols}")

                if watermark_col:
                    wm_col_check = watermark_col if watermark_col in (row_dicts[0] if row_dicts else {}) else None
                    if wm_col_check:
                        new_watermark = update_watermark(row_dicts, wm_col_check, new_watermark)

                total_source += len(row_dicts)
                filtered = [{k: v for k, v in r.items() if k in write_cols} for r in row_dicts]

                if dst_is_pg:
                    write_pg_batch(dst_cur, dest_target, write_cols, filtered, load_type, conflict_col_list, chunk_size)
                    dst_conn.commit()
                else:
                    write_sa_batch(dst_sa_engine, dst_sa_table, filtered)

                total_inserted += len(filtered)
                log(f"  Batch #{batch_num}: src={len(row_dicts):,} dst={len(filtered):,} (totals src={total_source:,} dst={total_inserted:,})")

                if pipeline_id and new_watermark:
                    save_watermark(pipeline_id, new_watermark)

            src_ora_cur.close()
            src_ora_conn.close()
            log(f"[SRC] Oracle cursor closed")

        else:
            # ── Other non-PG sources (MySQL, MSSQL): chunked SQLAlchemy reads ───
            from sqlalchemy import create_engine as sa_src_fn, text as sa_text
            src_sa_engine = sa_src_fn(build_sqlalchemy_url(src), pool_pre_ping=True)
            log(f"[SRC] Streaming via SQLAlchemy chunks (chunk_size={chunk_size})")
            log(f"  Query: {source_query[:200]}{'…' if len(source_query) > 200 else ''}")

            with src_sa_engine.connect() as src_sa_conn:
                for chunk_df in pd.read_sql_query(sa_text(source_query), src_sa_conn, chunksize=chunk_size):
                    batch_num += 1
                    row_dicts = chunk_df.where(chunk_df.notna(), other=None).to_dict(orient="records")

                    if field_mappings:
                        row_dicts = apply_field_mappings(row_dicts, field_mappings)

                    if write_cols is None:
                        write_cols = [c for c in row_dicts[0].keys() if c in dst_all_cols] if row_dicts else []
                        if not write_cols:
                            fail("No matching columns found between source (after mappings) and destination table")
                        log(f"  Write columns ({len(write_cols)}): {write_cols}")

                    if watermark_col and row_dicts and watermark_col in row_dicts[0]:
                        new_watermark = update_watermark(row_dicts, watermark_col, new_watermark)

                    total_source += len(row_dicts)
                    filtered = [{k: v for k, v in r.items() if k in write_cols} for r in row_dicts]

                    if dst_is_pg:
                        write_pg_batch(dst_cur, dest_target, write_cols, filtered, load_type, conflict_col_list, chunk_size)
                        dst_conn.commit()
                    else:
                        write_sa_batch(dst_sa_engine, dst_sa_table, filtered)

                    total_inserted += len(filtered)
                    log(f"  Batch #{batch_num}: src={len(row_dicts):,} dst={len(filtered):,} (totals src={total_source:,} dst={total_inserted:,})")

                    if pipeline_id and new_watermark:
                        save_watermark(pipeline_id, new_watermark)

            src_sa_engine.dispose()

    except SystemExit:
        raise
    except Exception as e:
        fail(f"ETL failed at batch #{batch_num + 1}: {sanitize_error(e)}")
    finally:
        try:
            if dst_cur:  dst_cur.close()
            if dst_conn: dst_conn.close()
            if dst_sa_engine: dst_sa_engine.dispose()
        except Exception:
            pass

    log(f"[DONE] src={total_source:,} rows read, dst={total_inserted:,} rows written, {batch_num} batch(es)")

    if total_source == 0:
        log("  Source returned 0 rows — nothing inserted.")

    # ── POST-SQL ──────────────────────────────────────────────────────────────
    if post_sql:
        try:
            run_sql_statements("POST-SQL", post_sql, dst_is_pg, dst_pg_params, dst_url)
        except Exception as e:
            fail(f"Post-load SQL failed: {sanitize_error(e)}")
    else:
        log("[POST-SQL] Skipped (not configured)")

    log("Worker completed successfully.")
    result: dict = {"success": True, "recordCount": total_inserted, "sourceRecordCount": total_source}
    if new_watermark and new_watermark != current_wm:
        result["newWatermark"] = new_watermark
    print(json.dumps(result))


if __name__ == "__main__":
    main()
