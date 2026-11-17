"""TiDB connections with verified TLS and credentials from the environment.

Run `python database.py` for a read-only connection check (no model loading).
"""

import os
import ssl
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
