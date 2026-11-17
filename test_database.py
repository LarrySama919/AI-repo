"""Offline tests: python -m unittest test_database -v."""
import os
import ssl
import unittest
from unittest.mock import MagicMock, patch

import database


class DatabaseTests(unittest.TestCase):
    def test_missing_settings_do_not_expose_secrets(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(database, "load_dotenv"):
            with self.assertRaisesRegex(database.DatabaseConfigurationError, "Missing settings"):
                database.connection_options()

    def test_verified_tls_and_literal_password(self):
        env = dict(DB_HOST="example.test", DB_USER="prefix.root", DB_PASSWORD="a#${literal}",
                   DB_NAME="skinwise", DB_SSL_CA="certs/ca.pem", DB_PORT="4000")
        context = ssl.create_default_context()
        with patch.dict(os.environ, env, clear=True), patch.object(database, "load_dotenv") as dotenv, \
             patch.object(database.Path, "is_file", return_value=True), \
             patch.object(database.ssl, "create_default_context", return_value=context):
            options = database.connection_options()
        self.assertEqual(options["password"], env["DB_PASSWORD"])
        self.assertTrue(options["ssl"].check_hostname)
        self.assertEqual(options["ssl"].verify_mode, ssl.CERT_REQUIRED)
        self.assertFalse(options["autocommit"])
        dotenv.assert_called_once_with(database.ROOT / ".env", override=False, interpolate=False)

    def test_plaintext_is_rejected_and_connection_closed(self):
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value.fetchone.return_value = {"Value": ""}
        with patch.object(database, "connection_options", return_value={}), \
             patch.object(database.pymysql, "connect", return_value=connection):
            with self.assertRaisesRegex(database.DatabaseConfigurationError, "must use TLS"):
                with database.database_connection():
                    self.fail("Plaintext connection was yielded")
        connection.rollback.assert_called_once()
        connection.close.assert_called_once()

    def test_operation_failure_rolls_back_and_closes(self):
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value.fetchone.return_value = {"Value": "TLS_CIPHER"}
        with patch.object(database, "connection_options", return_value={}), \
             patch.object(database.pymysql, "connect", return_value=connection):
            with self.assertRaisesRegex(RuntimeError, "operation failed"):
                with database.database_connection():
                    raise RuntimeError("operation failed")
        connection.rollback.assert_called_once()
        connection.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
