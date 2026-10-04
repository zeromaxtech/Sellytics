"""Encrypts store API tokens before saving them — even in this local SQLite file,
never store a token in plain text. The real key lives in .env, never in code or git.
"""
import os
from cryptography.fernet import Fernet
from dotenv import load_dotenv

load_dotenv()

_key = os.getenv("ENCRYPTION_KEY")
if not _key:
    raise RuntimeError(
        "ENCRYPTION_KEY missing from .env. Generate one with:\n"
        "  python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
    )

_fernet = Fernet(_key.encode())


def encrypt(plain_text: str) -> bytes:
    return _fernet.encrypt(plain_text.encode())


def decrypt(token_bytes: bytes) -> str:
    return _fernet.decrypt(token_bytes).decode()
