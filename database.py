"""TiDB connections with verified TLS and credentials from the environment.

Run `python database.py` for a read-only connection check (no model loading).
"""

import os
import ssl
import base64
import hashlib
import hmac
import json
import secrets
import time
from contextlib import contextmanager
from pathlib import Path

import pymysql
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent


class DatabaseConfigurationError(ValueError):
    """Missing or invalid local configuration; never includes secret values."""


def connection_options():
    # Deployment environment takes precedence over a local .env file.
    load_dotenv(ROOT / ".env", override=False, interpolate=False)
    required = ("DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME", "DB_SSL_CA")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise DatabaseConfigurationError("Missing settings: " + ", ".join(missing))
    try:
        port = int(os.environ.get("DB_PORT", "4000"))
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        raise DatabaseConfigurationError("DB_PORT must be between 1 and 65535.") from None

    ca = Path(os.environ["DB_SSL_CA"]).expanduser()
    if not ca.is_absolute():
        ca = ROOT / ca
    if not ca.is_file():
        raise DatabaseConfigurationError("DB_SSL_CA must point to an existing CA PEM file.")
    try:
        tls = ssl.create_default_context(cafile=str(ca))
    except (OSError, ssl.SSLError):
        raise DatabaseConfigurationError("DB_SSL_CA could not be loaded as a CA certificate.") from None
    tls.minimum_version = ssl.TLSVersion.TLSv1_2
    tls.check_hostname = True
    tls.verify_mode = ssl.CERT_REQUIRED
    return dict(
        host=os.environ["DB_HOST"], port=port,
        user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"],
        database=os.environ["DB_NAME"], ssl=tls,
        charset="utf8mb4", collation="utf8mb4_unicode_ci",
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10, read_timeout=15, write_timeout=15,
        autocommit=False, local_infile=False,
        init_command="SET time_zone = '+00:00'",
    )


@contextmanager
def database_connection():
    """One connection per operation. Explicitly commit writes; otherwise roll back.

    Call from synchronous FastAPI routes/dependencies (or a worker thread).
    Never share this connection between requests.
    """
    connection = pymysql.connect(**connection_options())
    try:
        # Refuse a plaintext connection even with older driver/server behavior.
        with connection.cursor() as cursor:
            cursor.execute("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
            status = cursor.fetchone()
            if not status or not status.get("Value"):
                raise DatabaseConfigurationError("The database connection must use TLS.")
        yield connection
    finally:
        try:
            connection.rollback()
        finally:
            connection.close()


def check_database():
    """Read-only probe. Returns no host, username, password or server error text."""
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1 AS ok")
            if cursor.fetchone()["ok"] != 1:
                raise RuntimeError("Database probe failed.")
    return {"status": "ok", "database": "connected", "tls": "verified"}


def hash_password(password: str) -> str:
    """Hash passwords with scrypt; output fits the users.password_hash column."""
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1,
        dklen=32, maxmem=64 * 1024 * 1024,
    )
    return "scrypt${}${}${}${}${}".format(
        2**14, 8, 1,
        base64.urlsafe_b64encode(salt).decode("ascii").rstrip("="),
        base64.urlsafe_b64encode(digest).decode("ascii").rstrip("="),
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, n, r, p, salt_text, digest_text = encoded.split("$")
        if algorithm != "scrypt":
            return False
        decode = lambda value: base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
        salt, expected = decode(salt_text), decode(digest_text)
        actual = hashlib.scrypt(
            password.encode("utf-8"), salt=salt, n=int(n), r=int(r), p=int(p),
            dklen=len(expected), maxmem=64 * 1024 * 1024,
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, UnicodeError):
        return False


def _auth_token_secret() -> bytes:
    load_dotenv(ROOT / ".env", override=False, interpolate=False)
    secret = os.environ.get("AUTH_TOKEN_SECRET", "")
    if len(secret.encode("utf-8")) < 32:
        raise DatabaseConfigurationError("AUTH_TOKEN_SECRET must contain at least 32 bytes.")
    return secret.encode("utf-8")


def validate_auth_token_config() -> None:
    _auth_token_secret()


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def create_access_token(user: dict) -> str:
    now = int(time.time())
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64url(json.dumps({
        "sub": str(user["user_id"]), "role": user["role"],
        "iat": now, "exp": now + 1800,
    }, separators=(",", ":")).encode())
    signing_input = f"{header}.{payload}"
    signature = _b64url(hmac.new(_auth_token_secret(), signing_input.encode("ascii"), hashlib.sha256).digest())
    return f"{signing_input}.{signature}"


def register_user(full_name: str, email: str, password: str) -> dict:
    password_hash = hash_password(password)
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO users (full_name, email, password_hash) VALUES (%s, %s, %s)",
                (full_name, email, password_hash),
            )
            user_id = cursor.lastrowid
            cursor.execute(
                "SELECT user_id, full_name, email, role, email_verified, account_status "
                "FROM users WHERE user_id = %s",
                (user_id,),
            )
            user = cursor.fetchone()
        connection.commit()
    return user


def authenticate_user(email: str, password: str) -> dict | None:
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT user_id, full_name, email, password_hash, role, email_verified, account_status "
                "FROM users WHERE email = %s LIMIT 1",
                (email,),
            )
            user = cursor.fetchone()
    if not user or not verify_password(password, user["password_hash"]):
        return None
    if user["account_status"] != "active":
        return None
    user.pop("password_hash", None)
    return user


if __name__ == "__main__":
    try:
        check_database()
    except DatabaseConfigurationError as error:
        print(f"Configuration error: {error}")
        raise SystemExit(1)
    except Exception:
        print("Connection failed. Check credentials, CA certificate, network and TiDB IP access.")
        raise SystemExit(1)
    print("Database connected successfully with verified TLS.")
