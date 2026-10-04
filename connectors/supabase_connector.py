"""Pulls Postgres database size and Storage bucket usage from a Supabase project."""
import psycopg2
from supabase import create_client
import config


def get_database_size_bytes() -> int | None:
    """Direct Postgres connection -> pg_database_size() of the current database."""
    if not config.SUPABASE_DB_URL:
        return None
    conn = psycopg2.connect(config.SUPABASE_DB_URL, connect_timeout=10)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_database_size(current_database());")
            return cur.fetchone()[0]
    finally:
        conn.close()


def get_storage_bucket_bytes() -> dict:
    """Sums file sizes per bucket via the Supabase Storage API.
    Returns {bucket_name: total_bytes}. Requires the service-role key.
    """
    if not (config.SUPABASE_URL and config.SUPABASE_SERVICE_KEY):
        return {}

    client = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)
    totals = {}
    buckets = client.storage.list_buckets()

    for bucket in buckets:
        bucket_name = bucket.name if hasattr(bucket, "name") else bucket["name"]
        total = 0
        # list() only returns one folder level at a time — walk it recursively.
        stack = [""]
        while stack:
            prefix = stack.pop()
            entries = client.storage.from_(bucket_name).list(prefix)
            for entry in entries:
                metadata = entry.get("metadata")
                if metadata and metadata.get("size") is not None:
                    total += metadata["size"]
                elif entry.get("id") is None:
                    # No id + no size usually means it's a folder — descend into it.
                    child_prefix = f"{prefix}/{entry['name']}" if prefix else entry["name"]
                    stack.append(child_prefix)
        totals[bucket_name] = total

    return totals


def collect() -> dict:
    """Returns whatever Supabase metrics are configured; missing pieces are omitted."""
    result = {}
    try:
        db_bytes = get_database_size_bytes()
        if db_bytes is not None:
            result["database_bytes"] = db_bytes
    except Exception as e:
        result["database_error"] = str(e)

    try:
        buckets = get_storage_bucket_bytes()
        if buckets:
            result["storage_buckets"] = buckets
            result["storage_total_bytes"] = sum(buckets.values())
    except Exception as e:
        result["storage_error"] = str(e)

    return result
