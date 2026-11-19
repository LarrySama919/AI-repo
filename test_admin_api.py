"""Offline tests: python -m unittest test_admin_api -v."""

import asyncio
import io
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import ValidationError
from starlette.datastructures import Headers, UploadFile

import admin_api
import database


class AdminApiTests(unittest.TestCase):
    def test_signed_token_validation_and_expiration(self):
        secret = b"test-auth-secret-with-at-least-32-bytes"
        with patch.object(database, "_auth_token_secret", return_value=secret), \
             patch.object(admin_api, "_auth_token_secret", return_value=secret), \
             patch.object(database.time, "time", return_value=1000), \
             patch.object(admin_api.time, "time", return_value=1000):
            token = database.create_access_token({"user_id": 42, "role": "admin"})
            self.assertEqual(admin_api.verify_access_token(token)["sub"], "42")
            header, payload, signature = token.split(".")
            altered = f"{header}.{payload}.{'A' if signature[0] != 'A' else 'B'}{signature[1:]}"
            self.assertIsNone(admin_api.verify_access_token(altered))
        with patch.object(admin_api, "_auth_token_secret", return_value=secret), \
             patch.object(admin_api.time, "time", return_value=2800):
            self.assertIsNone(admin_api.verify_access_token(token))

    def test_admin_role_is_read_from_database(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = {
            "user_id": 42, "role": "admin", "account_status": "active"
        }
        context = MagicMock()
        context.__enter__.return_value = connection
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="signed-token")
        with patch.object(admin_api, "verify_access_token", return_value={"sub": "42"}), \
             patch.object(admin_api, "database_connection", return_value=context):
            self.assertEqual(admin_api.require_admin(credentials)["role"], "admin")

    def test_non_admin_is_forbidden(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = {
            "user_id": 42, "role": "user", "account_status": "active"
        }
        context = MagicMock()
        context.__enter__.return_value = connection
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="signed-token")
        with patch.object(admin_api, "verify_access_token", return_value={"sub": "42"}), \
             patch.object(admin_api, "database_connection", return_value=context):
            with self.assertRaises(HTTPException) as raised:
                admin_api.require_admin(credentials)
        self.assertEqual(raised.exception.status_code, 403)

    def test_moderator_role_is_read_from_database(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = {
            "user_id": 42, "role": "moderator", "account_status": "active"
        }
        context = MagicMock()
        context.__enter__.return_value = connection
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="signed-token")
        with patch.object(admin_api, "verify_access_token", return_value={"sub": "42"}), \
             patch.object(admin_api, "database_connection", return_value=context):
            self.assertEqual(admin_api.require_moderator(credentials)["role"], "moderator")

    def test_admin_token_cannot_use_moderator_only_routes(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = {
            "user_id": 42, "role": "admin", "account_status": "active"
        }
        context = MagicMock()
        context.__enter__.return_value = connection
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="signed-token")
        with patch.object(admin_api, "verify_access_token", return_value={"sub": "42"}), \
             patch.object(admin_api, "database_connection", return_value=context):
            with self.assertRaises(HTTPException) as raised:
                admin_api.require_moderator(credentials)
        self.assertEqual(raised.exception.status_code, 403)

    def test_moderator_cannot_change_staff_account_status(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = {"role": "moderator", "account_status": "active"}
        context = MagicMock()
        context.__enter__.return_value = connection
        with patch.object(admin_api, "database_connection", return_value=context):
            with self.assertRaises(HTTPException) as raised:
                admin_api.update_moderator_user(
                    7,
                    admin_api.ModeratorUserUpdate(account_status="suspended"),
                    42,
                )
        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(cursor.execute.call_count, 1)

    def test_moderator_can_suspend_a_regular_user_and_audit_it(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = {"role": "user", "account_status": "active"}
        cursor.rowcount = 1
        context = MagicMock()
        context.__enter__.return_value = connection
        with patch.object(admin_api, "database_connection", return_value=context):
            result = admin_api.update_moderator_user(
                7,
                admin_api.ModeratorUserUpdate(account_status="suspended"),
                42,
            )
        self.assertEqual(result, {"user_id": 7, "account_status": "suspended"})
        update_call = cursor.execute.call_args_list[1]
        self.assertIn("UPDATE users SET account_status", update_call.args[0])
        audit_call = cursor.execute.call_args_list[2]
        self.assertIn("staff_audit_logs", audit_call.args[0])
        self.assertEqual(audit_call.args[1][1], "user_suspended")
        connection.commit.assert_called_once()

    def test_moderator_user_list_excludes_staff_roles(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = []
        context = MagicMock()
        context.__enter__.return_value = connection
        with patch.object(admin_api, "database_connection", return_value=context):
            self.assertEqual(admin_api.fetch_moderator_users(), [])
        self.assertIn("WHERE u.role = 'user'", cursor.execute.call_args.args[0])

    def test_reviews_use_inclusive_dates_and_newest_first_order(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = {"total": 1}
        cursor.fetchall.return_value = [{
            "review_id": 9,
            "rating": 5,
            "review_text": "Great",
            "status": "approved",
            "created_at": datetime(2026, 11, 18, 12, 30),
            "reviewer_name": "Reviewer",
            "product_name": "Product",
        }]
        context = MagicMock()
        context.__enter__.return_value = connection
        with patch.object(admin_api, "database_connection", return_value=context):
            reviews, total = admin_api.fetch_product_reviews(
                2, 5, date(2026, 11, 1), date(2026, 11, 18)
            )
        query = cursor.execute.call_args_list[1].args[0]
        self.assertIn("ORDER BY r.created_at DESC, r.review_id DESC", query)
        self.assertEqual(cursor.execute.call_args_list[1].args[1], [
            date(2026, 11, 1), date(2026, 11, 18), 5, 5
        ])
        self.assertEqual(total, 1)
        self.assertEqual(reviews[0]["rating"], 5)
        self.assertEqual(reviews[0]["created_at"], "2026-11-18T12:30:00")

    def test_all_reviews_filter_omits_status_where_clause(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = {"total": 0}
        cursor.fetchall.return_value = []
        context = MagicMock()
        context.__enter__.return_value = connection
        with patch.object(admin_api, "database_connection", return_value=context):
            reviews, total = admin_api.fetch_product_reviews(1, 10, None, None, "all")
        query = cursor.execute.call_args_list[0].args[0]
        self.assertNotIn(" WHERE ", query)
        self.assertEqual((reviews, total), ([], 0))

    def test_hiding_a_review_records_its_previous_status(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = {"status": "approved"}
        cursor.rowcount = 1
        context = MagicMock()
        context.__enter__.return_value = connection
        with patch.object(admin_api, "database_connection", return_value=context):
            self.assertTrue(admin_api.hide_product_review(11, 42, "Spam or advertising"))
        moderation_call = cursor.execute.call_args_list[2]
        self.assertIn("review_moderations", moderation_call.args[0])
        self.assertEqual(moderation_call.args[1][-1], "Spam or advertising")
        audit_call = cursor.execute.call_args_list[-1]
        self.assertIn("staff_audit_logs", audit_call.args[0])
        self.assertEqual(
            audit_call.args[1][-1],
            '{"previous_status": "approved", "reason": "Spam or advertising"}',
        )
        connection.commit.assert_called_once()

    def test_review_hide_reason_is_limited_to_policy_categories(self):
        request = admin_api.ReviewHideRequest(reason="Spam or advertising")
        self.assertEqual(request.reason, "Spam or advertising")
        with self.assertRaises(ValidationError):
            admin_api.ReviewHideRequest(reason="Low rating")

    def test_restoring_a_review_returns_it_to_its_previous_status(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.side_effect = [
            {"status": "hidden"},
            {"details": {"previous_status": "approved"}},
        ]
        cursor.rowcount = 1
        context = MagicMock()
        context.__enter__.return_value = connection
        with patch.object(admin_api, "database_connection", return_value=context):
            self.assertTrue(admin_api.restore_product_review(11, 42))
        update_call = cursor.execute.call_args_list[2]
        self.assertIn("UPDATE product_reviews SET status = %s", update_call.args[0])
        self.assertEqual(update_call.args[1], ("approved", 11))
        connection.commit.assert_called_once()

    def test_admin_cannot_change_own_account_role(self):
        with self.assertRaises(HTTPException) as raised:
            admin_api.admin_update_user(
                admin_api.UserUpdate(role="moderator"),
                user_id=42,
                admin={"user_id": 42},
            )
        self.assertEqual(raised.exception.status_code, 403)

    def test_product_image_path_rejects_executable_schemes(self):
        self.assertEqual(
            admin_api.validate_product_image_path("../images/product.jpg"),
            "../images/product.jpg",
        )
        self.assertEqual(
            admin_api.validate_product_image_path("https://example.com/product.jpg"),
            "https://example.com/product.jpg",
        )
        with self.assertRaises(HTTPException) as raised:
            admin_api.validate_product_image_path("javascript:alert(1)")
        self.assertEqual(raised.exception.status_code, 422)

    def test_product_upload_accepts_supported_image_signatures(self):
        self.assertEqual(
            admin_api.validate_product_image_content("image/jpeg", b"\xff\xd8\xffdata"),
            "jpg",
        )
        self.assertEqual(
            admin_api.validate_product_image_content("image/png", b"\x89PNG\r\n\x1a\ndata"),
            "png",
        )
        self.assertEqual(
            admin_api.validate_product_image_content("image/webp", b"RIFFxxxxWEBPdata"),
            "webp",
        )
        with self.assertRaises(HTTPException) as raised:
            admin_api.validate_product_image_content("image/png", b"not an image")
        self.assertEqual(raised.exception.status_code, 422)

    def test_product_image_upload_saves_under_static_frontend_path(self):
        image_data = b"\x89PNG\r\n\x1a\nvalid-test-content"
        upload = UploadFile(
            file=io.BytesIO(image_data),
            filename="product.png",
            headers=Headers({"content-type": "image/png"}),
        )
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(admin_api, "product_image_directory", Path(directory)):
                response = asyncio.run(
                    admin_api.admin_upload_product_image(upload, {"user_id": 42})
                )
            filename = response["image_path"].rsplit("/", 1)[-1]
            self.assertTrue(response["image_path"].startswith("/frontend/Admin/uploads/"))
            self.assertEqual((Path(directory) / filename).read_bytes(), image_data)


if __name__ == "__main__":
    unittest.main()
