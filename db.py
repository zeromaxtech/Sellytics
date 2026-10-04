"""Local SQLite database. This plays the exact role Supabase will play later —
a 'users' table and a 'store_connections' table — so swapping to real Supabase
later is a connection-string change, not a redesign.
"""
import sqlite3

DB_PATH = "local_shop_digest.db"


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db():
    conn = get_connection()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash BLOB NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS store_connections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id),
            platform TEXT NOT NULL,        -- e.g. 'printify'
            encrypted_token BLOB NOT NULL, -- never store raw tokens/passwords
            shop_label TEXT,
            UNIQUE(user_id, platform)
        )
        """
    )
    conn.commit()
    conn.close()
