"""Handles YOUR app's own login (business owner signs up for your tool).
This is separate from — and never touches — their Etsy/Printify credentials.
"""
import bcrypt
from db import get_connection


def register_user(email: str, password: str) -> bool:
    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt())
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO users (email, password_hash) VALUES (?, ?)",
            (email, password_hash),
        )
        conn.commit()
        return True
    except Exception as e:
        print(f"Could not register: {e}")
        return False
    finally:
        conn.close()


def login_user(email: str, password: str) -> int | None:
    conn = get_connection()
    row = conn.execute(
        "SELECT id, password_hash FROM users WHERE email = ?", (email,)
    ).fetchone()
    conn.close()

    if not row:
        return None

    user_id, password_hash = row
    if bcrypt.checkpw(password.encode(), password_hash):
        return user_id
    return None
