#!/usr/bin/env python3
"""
Pipeline Worker — reads data from a source DB and bulk-inserts into a destination DB.
Called by the Node.js API server as a child process.

Input:  JSON on stdin
Output: JSON on stdout  { success, recordCount, error }
"""

import sys
import json
import traceback

def main():
    try:
        config = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to parse config: {e}"}))
        sys.exit(1)

    try:
        import pandas as pd
        from sqlalchemy import create_engine, text
    except ImportError as e:
        print(json.dumps({"success": False, "error": f"Missing dependency: {e}. Run: pip install pandas sqlalchemy psycopg2-binary"}))
        sys.exit(1)

    src = config.get("source", {})
    dst = config.get("dest", {})
    source_query = config.get("sourceQuery", "")
    dest_target = config.get("destTarget", "")
    field_mappings = config.get("fieldMappings", [])
    chunk_size = config.get("chunkSize", 5000)

    if not source_query:
        print(json.dumps({"success": False, "error": "sourceQuery is required"}))
        sys.exit(1)
    if not dest_target:
        print(json.dumps({"success": False, "error": "destTarget is required"}))
        sys.exit(1)

    def build_url(conn):
        engine = conn.get("engine", "postgresql")
        host = conn.get("host", "localhost")
        port = conn.get("port", 5432)
        db = conn.get("database", "")
        user = conn.get("username", "")
        password = conn.get("password", "")

        if engine in ("postgresql", "postgres"):
            return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{db}"
        elif engine == "mysql":
            return f"mysql+pymysql://{user}:{password}@{host}:{port}/{db}"
        elif engine in ("mssql", "sqlserver"):
            return f"mssql+pyodbc://{user}:{password}@{host}:{port}/{db}?driver=ODBC+Driver+17+for+SQL+Server"
        else:
            return f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{db}"

    try:
        src_engine = create_engine(build_url(src), pool_pre_ping=True)
        dst_engine = create_engine(build_url(dst), pool_pre_ping=True)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Failed to create DB engines: {e}"}))
        sys.exit(1)

    # Step 1: Fetch data from source using chunked reads
    try:
        chunks = []
        with src_engine.connect() as conn:
            for chunk in pd.read_sql_query(text(source_query), conn, chunksize=chunk_size):
                chunks.append(chunk)
        src_engine.dispose()

        if not chunks:
            df = pd.DataFrame()
        else:
            df = pd.concat(chunks, ignore_index=True)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Source read failed: {e}"}))
        sys.exit(1)

    record_count = len(df)

    if record_count == 0:
        print(json.dumps({"success": True, "recordCount": 0}))
        sys.exit(0)

    # Step 2: Apply field mappings (rename + transform columns)
    if field_mappings:
        rename_map = {}
        transform_map = {}
        for m in field_mappings:
            src_field = m.get("sourceField", "")
            dst_field = m.get("destField", "")
            if src_field and dst_field:
                rename_map[src_field] = dst_field
                if m.get("transformType") and m["transformType"] != "passthrough":
                    transform_map[dst_field] = m

        # Keep only mapped source columns
        keep_cols = [c for c in rename_map.keys() if c in df.columns]
        df = df[keep_cols].rename(columns=rename_map)

        # Apply transforms
        for col, mapping in transform_map.items():
            if col not in df.columns:
                continue
            t = mapping.get("transformType", "passthrough")
            params = mapping.get("transformParams", "")
            if t == "string":
                df[col] = df[col].astype(str).where(df[col].notna(), None)
            elif t == "number":
                df[col] = pd.to_numeric(df[col], errors="coerce")
            elif t == "boolean":
                df[col] = df[col].map(lambda v: str(v).lower() in ("true", "1", "yes", "y") if v is not None else None)
            elif t == "date-format":
                df[col] = pd.to_datetime(df[col], errors="coerce")
                if params:
                    fmt = params.replace("YYYY", "%Y").replace("MM", "%m").replace("DD", "%d").replace("HH", "%H").replace("mm", "%M").replace("ss", "%S")
                    df[col] = df[col].dt.strftime(fmt)
                else:
                    df[col] = df[col].dt.strftime("%Y-%m-%d")

    # Step 3: Bulk insert into destination using to_sql with multi-row inserts
    # Parse schema + table from dest_target (e.g. "public.clients" or just "clients")
    if "." in dest_target:
        schema_part, table_part = dest_target.split(".", 1)
    else:
        schema_part = None
        table_part = dest_target

    try:
        with dst_engine.connect() as conn:
            df.to_sql(
                table_part,
                con=conn,
                schema=schema_part,
                if_exists="append",
                index=False,
                chunksize=chunk_size,
                method="multi",
            )
            conn.commit()
        dst_engine.dispose()
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Destination write failed: {e}"}))
        sys.exit(1)

    print(json.dumps({"success": True, "recordCount": record_count}))

if __name__ == "__main__":
    main()
