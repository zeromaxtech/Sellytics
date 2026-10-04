"""Pulls storage bytes and warehouse credit spend from Snowflake's ACCOUNT_USAGE views.

Note: ACCOUNT_USAGE views can lag reality by up to a few hours — this is Snowflake's
own known latency, not a bug here. Fine for a once-a-day digest.
"""
import snowflake.connector
import config


def _connect():
    return snowflake.connector.connect(
        account=config.SNOWFLAKE_ACCOUNT,
        user=config.SNOWFLAKE_USER,
        password=config.SNOWFLAKE_PASSWORD,
        warehouse=config.SNOWFLAKE_WAREHOUSE,
        role=config.SNOWFLAKE_ROLE,
    )


def get_storage_bytes() -> int | None:
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT STORAGE_BYTES + STAGE_BYTES + FAILSAFE_BYTES AS TOTAL_BYTES
            FROM SNOWFLAKE.ACCOUNT_USAGE.STORAGE_USAGE
            ORDER BY USAGE_DATE DESC
            LIMIT 1
            """
        )
        row = cur.fetchone()
        return int(row[0]) if row else None
    finally:
        conn.close()


def get_credits_used_last_24h() -> float | None:
    conn = _connect()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT SUM(CREDITS_USED) AS TOTAL_CREDITS
            FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY
            WHERE START_TIME >= DATEADD(hour, -24, CURRENT_TIMESTAMP())
            """
        )
        row = cur.fetchone()
        return float(row[0]) if row and row[0] is not None else 0.0
    finally:
        conn.close()


def collect() -> dict:
    result = {}
    try:
        bytes_used = get_storage_bytes()
        if bytes_used is not None:
            result["storage_bytes"] = bytes_used
    except Exception as e:
        result["storage_error"] = str(e)

    try:
        credits = get_credits_used_last_24h()
        if credits is not None:
            result["credits_used_24h"] = credits
    except Exception as e:
        result["credits_error"] = str(e)

    return result
