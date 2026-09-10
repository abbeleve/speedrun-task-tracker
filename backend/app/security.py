"""Password hashing and session token helpers.

Passwords are hashed with PBKDF2-HMAC-SHA256 (200k iterations) and a random
per-user salt, so no external hashing library is required. Session tokens are
opaque, cryptographically random hex strings stored in the ``sessions`` table.
"""

import hashlib
import hmac
import secrets
from typing import Optional

_ITERATIONS = 200_000


def hash_password(password: str, salt: Optional[str] = None) -> str:
    """Return ``<salt hex>$<derived key hex>``; a new salt is used if not given."""
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), bytes.fromhex(salt), _ITERATIONS)
    return f'{salt}${dk.hex()}'


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, _ = stored.split('$', 1)
    except ValueError:
        return False
    try:
        return hmac.compare_digest(hash_password(password, salt), stored)
    except (ValueError, TypeError):
        return False


def new_token() -> str:
    return secrets.token_hex(32)
