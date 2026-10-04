"""Local test harness — a menu instead of a website, so you can prove the
logic works before building any web frontend or OAuth flow.
Run: python main.py
"""
import getpass
from db import init_db, get_connection
import auth
import crypto_utils
import digest_builder
from connectors import printify_connector

init_db()


def register():
    email = input("Email: ").strip()
    password = getpass.getpass("Password: ")
    if auth.register_user(email, password):
        print("Registered. Now log in.")


def login() -> int | None:
    email = input("Email: ").strip()
    password = getpass.getpass("Password: ")
    user_id = auth.login_user(email, password)
    if user_id is None:
        print("Login failed.")
    return user_id


def connect_printify(user_id: int):
    token = getpass.getpass("Paste your Printify API token (input hidden): ").strip()
    encrypted = crypto_utils.encrypt(token)

    conn = get_connection()
    conn.execute(
        """
        INSERT INTO store_connections (user_id, platform, encrypted_token)
        VALUES (?, 'printify', ?)
        ON CONFLICT(user_id, platform) DO UPDATE SET encrypted_token = excluded.encrypted_token
        """,
        (user_id, encrypted),
    )
    conn.commit()
    conn.close()
    print("Printify connected (token stored encrypted, never in plain text).")


def run_digest(user_id: int):
    conn = get_connection()
    rows = conn.execute(
        "SELECT platform, encrypted_token FROM store_connections WHERE user_id = ?",
        (user_id,),
    ).fetchall()
    conn.close()

    results = []
    for platform, encrypted_token in rows:
        token = crypto_utils.decrypt(encrypted_token)
        if platform == "printify":
            result = printify_connector.collect(token)
            result["platform"] = "printify"
            results.append(result)

    print("\n" + digest_builder.build(results) + "\n")


def main():
    print("1) Register  2) Login+use  3) Quit")
    choice = input("> ").strip()

    if choice == "1":
        register()
        return

    if choice == "2":
        user_id = login()
        if user_id is None:
            return
        while True:
            print("\na) Connect Printify  b) Run digest now  c) Log out")
            action = input("> ").strip().lower()
            if action == "a":
                connect_printify(user_id)
            elif action == "b":
                run_digest(user_id)
            elif action == "c":
                break


if __name__ == "__main__":
    main()
