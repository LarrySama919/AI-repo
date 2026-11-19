"""Standalone, admin-only API for the Skinwise administration dashboard."""

import base64
import binascii
import hashlib
import hmac
import json
import logging
import os
import time
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path as FilePath
from typing import Literal
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, File, HTTPException, Path, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from dotenv import load_dotenv

from database import _auth_token_secret, database_connection

logger = logging.getLogger(__name__)
load_dotenv(FilePath(__file__).resolve().parent / ".env", override=False, interpolate=False)
app = FastAPI(title="Skinwise Admin API", version="1.0")
bearer_auth = HTTPBearer(auto_error=False)
product_image_directory = FilePath(__file__).resolve().parent / "frontend" / "Admin" / "uploads"
max_product_image_bytes = 5 * 1024 * 1024

default_origins = (
    "http://127.0.0.1:8000,http://localhost:8000,"
    "http://127.0.0.1:3000,http://localhost:3000"
)
allowed_origins = [
    origin.strip()
    for origin in os.environ.get("ADMIN_CORS_ORIGINS", default_origins).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)


def verify_access_token(token: str) -> dict | None:
    secret = _auth_token_secret()
    if not token or len(token) > 4096:
        return None
    try:
        header_text, payload_text, signature_text = token.split(".")
        signing_input = f"{header_text}.{payload_text}"
        expected = base64.urlsafe_b64encode(
            hmac.new(secret, signing_input.encode("ascii"), hashlib.sha256).digest()
        ).decode("ascii").rstrip("=")
        if not hmac.compare_digest(signature_text, expected):
            return None
        decode = lambda value: base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
        header = json.loads(decode(header_text))
        payload = json.loads(decode(payload_text))
        if header != {"alg": "HS256", "typ": "JWT"}:
            return None
        if not isinstance(payload, dict) or not isinstance(payload.get("sub"), str):
            return None
        if not payload["sub"].isdecimal() or type(payload.get("exp")) is not int:
            return None
        if payload["exp"] <= int(time.time()):
            return None
        return payload
    except (ValueError, TypeError, UnicodeError, binascii.Error, json.JSONDecodeError):
        return None


def require_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_auth),
) -> dict:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Sign in with an admin account.")
    try:
        claims = verify_access_token(credentials.credentials)
        if claims is None:
            raise HTTPException(status_code=401, detail="Your session is invalid or expired.")
        user_id = int(claims["sub"])
        with database_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT user_id, full_name, email, role, account_status "
                    "FROM users WHERE user_id = %s LIMIT 1",
                    (user_id,),
                )
                user = cursor.fetchone()
    except HTTPException:
        raise
    except Exception:
        logger.error("Admin authentication could not reach the database.")
        raise HTTPException(status_code=503, detail="Admin service is temporarily unavailable.") from None
    if not user or user["account_status"] != "active" or user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access is required.")
    return user


def require_moderator(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_auth),
) -> dict:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Sign in with a moderator account.")
    try:
        claims = verify_access_token(credentials.credentials)
        if claims is None:
            raise HTTPException(status_code=401, detail="Your session is invalid or expired.")
        user_id = int(claims["sub"])
        with database_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT user_id, full_name, email, role, account_status "
                    "FROM users WHERE user_id = %s LIMIT 1",
                    (user_id,),
                )
                user = cursor.fetchone()
    except HTTPException:
        raise
    except Exception:
        logger.exception("Moderator authentication could not reach the database.")
        raise HTTPException(status_code=503, detail="Moderator service is temporarily unavailable.") from None
    if not user or user["account_status"] != "active" or user["role"] != "moderator":
        raise HTTPException(status_code=403, detail="Moderator access is required.")
    return user


def fetch_product_reviews(
    page: int,
    page_size: int,
    date_from: date | None,
    date_to: date | None,
    status_filter: str = "public",
) -> tuple[list[dict], int]:
    filters = []
    params: list[object] = []
    if status_filter == "public":
        filters.append("r.status <> 'hidden'")
    elif status_filter == "hidden":
        filters.append("r.status = 'hidden'")
    if date_from is not None:
        filters.append("r.created_at >= %s")
        params.append(date_from)
    if date_to is not None:
        filters.append("r.created_at < DATE_ADD(%s, INTERVAL 1 DAY)")
        params.append(date_to)
    where_clause = f" WHERE {' AND '.join(filters)}" if filters else ""

    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                f"SELECT COUNT(*) AS total FROM product_reviews r{where_clause}",
                params,
            )
            total = cursor.fetchone()["total"]
            cursor.execute(
                "SELECT r.review_id, r.rating, r.review_text, r.status, r.created_at, "
                "u.full_name AS reviewer_name, p.product_name "
                "FROM product_reviews r "
                "JOIN users u ON u.user_id = r.user_id "
                "JOIN products p ON p.product_id = r.product_id "
                f"{where_clause} "
                "ORDER BY r.created_at DESC, r.review_id DESC LIMIT %s OFFSET %s",
                [*params, page_size, (page - 1) * page_size],
            )
            reviews = cursor.fetchall()
    for review in reviews:
        review["rating"] = int(review["rating"])
        review["created_at"] = review["created_at"].isoformat()
    return reviews, total


def hide_product_review(review_id: int, moderator_id: int, reason: str) -> bool:
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT status FROM product_reviews WHERE review_id = %s",
                (review_id,),
            )
            review = cursor.fetchone()
            if not review or review["status"] == "hidden":
                return False
            cursor.execute(
                "UPDATE product_reviews SET status = 'hidden' "
                "WHERE review_id = %s AND status <> 'hidden'",
                (review_id,),
            )
            changed = cursor.rowcount == 1
            if changed:
                cursor.execute(
                    "INSERT INTO review_moderations "
                    "(review_id, moderator_id, action, reason) VALUES (%s, %s, 'hide', %s)",
                    (review_id, moderator_id, reason),
                )
                write_audit_log(
                    cursor,
                    moderator_id,
                    "product_review_hidden",
                    "product_review",
                    review_id,
                    {"previous_status": review["status"], "reason": reason},
                )
        connection.commit()
    return changed


def restore_product_review(review_id: int, moderator_id: int) -> bool:
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT status FROM product_reviews WHERE review_id = %s",
                (review_id,),
            )
            review = cursor.fetchone()
            if not review or review["status"] != "hidden":
                return False
            cursor.execute(
                "SELECT details FROM staff_audit_logs "
                "WHERE action = 'product_review_hidden' AND target_type = 'product_review' "
                "AND target_id = %s ORDER BY log_id DESC LIMIT 1",
                (review_id,),
            )
            audit = cursor.fetchone()
            details = audit["details"] if audit else {}
            if isinstance(details, str):
                details = json.loads(details)
            previous_status = details.get("previous_status") if isinstance(details, dict) else None
            if previous_status not in {"pending", "approved", "rejected"}:
                previous_status = "approved"
            cursor.execute(
                "UPDATE product_reviews SET status = %s WHERE review_id = %s AND status = 'hidden'",
                (previous_status, review_id),
            )
            changed = cursor.rowcount == 1
            if changed:
                cursor.execute(
                    "INSERT INTO review_moderations "
                    "(review_id, moderator_id, action, reason) VALUES (%s, %s, 'restore', %s)",
                    (review_id, moderator_id, "Review restored by staff."),
                )
                write_audit_log(
                    cursor,
                    moderator_id,
                    "product_review_restored",
                    "product_review",
                    review_id,
                    {"restored_status": previous_status},
                )
        connection.commit()
    return changed


class ProductCreate(BaseModel):
    product_name: str = Field(..., min_length=1, max_length=200)
    brand: str | None = Field(default=None, max_length=100)
    category: str | None = Field(default=None, max_length=100)
    description: str | None = None
    price: Decimal | None = Field(default=None, ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    image_path: str | None = Field(default=None, max_length=500)


class ProductUpdate(BaseModel):
    product_name: str | None = Field(default=None, min_length=1, max_length=200)
    brand: str | None = Field(default=None, max_length=100)
    category: str | None = Field(default=None, max_length=100)
    description: str | None = None
    price: Decimal | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    image_path: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None


class UserUpdate(BaseModel):
    role: Literal["user", "moderator"] | None = None
    account_status: Literal["active", "suspended"] | None = None


class ModeratorUserUpdate(BaseModel):
    account_status: Literal["active", "suspended"]


class ReportUpdate(BaseModel):
    status: Literal["pending", "in_progress", "resolved", "dismissed"]


class ReviewReportUpdate(BaseModel):
    status: Literal["pending", "resolved", "dismissed"]


class ReviewHideRequest(BaseModel):
    reason: Literal[
        "Spam or advertising",
        "Abusive or discriminatory language",
        "Private information",
        "Unrelated to the product or scan",
        "Other clear rule violation",
    ]


class IssueUpdate(BaseModel):
    status: Literal["open", "reviewed"]


class ProfileUpdate(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=3, max_length=255)


def write_audit_log(
    cursor,
    actor_id: int,
    action: str,
    target_type: str | None,
    target_id: int | None,
    details: dict | None = None,
) -> None:
    cursor.execute(
        "INSERT INTO staff_audit_logs "
        "(actor_id, action, target_type, target_id, details) "
        "VALUES (%s, %s, %s, %s, %s)",
        (actor_id, action, target_type, target_id, json.dumps(details or {}, default=str)),
    )


def validate_product_image_path(image_path: str | None) -> str | None:
    if image_path is None:
        return None
    value = image_path.strip()
    parsed = urlsplit(value)
    if (
        not value
        or parsed.scheme.lower() not in {"", "http", "https"}
        or (parsed.scheme and not parsed.netloc)
        or (parsed.netloc and not parsed.scheme)
    ):
        raise HTTPException(status_code=422, detail="Product images must use an HTTP(S) URL or relative path.")
    return value


def validate_product_image_content(content_type: str | None, image_data: bytes) -> str:
    formats = {
        "image/jpeg": ("jpg", lambda data: data.startswith(b"\xff\xd8\xff")),
        "image/png": ("png", lambda data: data.startswith(b"\x89PNG\r\n\x1a\n")),
        "image/webp": (
            "webp",
            lambda data: len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP",
        ),
    }
    image_format = formats.get(content_type or "")
    if image_format is None or not image_format[1](image_data):
        raise HTTPException(status_code=422, detail="Choose a valid JPG, PNG, or WebP image.")
    return image_format[0]


def normalize_dates(rows: list[dict]) -> list[dict]:
    for row in rows:
        for key, value in row.items():
            if hasattr(value, "isoformat"):
                row[key] = value.isoformat()
    return rows


def _week_activity(cursor) -> list[dict]:
    cursor.execute(
        "SELECT DATE(created_at) AS activity_date, COUNT(*) AS total "
        "FROM skin_analyses "
        "WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) "
        "GROUP BY DATE(created_at) ORDER BY activity_date"
    )
    return normalize_dates(cursor.fetchall())


def fetch_admin_overview() -> dict:
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT COUNT(*) AS total_users, "
                "COALESCE(SUM(account_status = 'active'), 0) AS active_users, "
                "COALESCE(SUM(account_status = 'suspended'), 0) AS suspended_users, "
                "COALESCE(SUM(role = 'moderator'), 0) AS moderators "
                "FROM users"
            )
            users = cursor.fetchone()
            cursor.execute(
                "SELECT COUNT(*) AS total_products, "
                "COALESCE(SUM(is_active = 1), 0) AS active_products "
                "FROM products"
            )
            products = cursor.fetchone()
            cursor.execute(
                "SELECT COUNT(*) AS total_scans, "
                "COALESCE(SUM(created_at >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')), 0) "
                "AS scans_this_month, "
                "COALESCE(SUM(created_at >= DATE_FORMAT(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MONTH), "
                "'%Y-%m-01') AND created_at < DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01')), 0) "
                "AS scans_last_month, "
                "COALESCE(SUM(status = 'completed'), 0) AS completed_scans, "
                "COALESCE(SUM(status = 'failed'), 0) AS failed_scans, "
                "AVG(CASE WHEN status = 'completed' AND completed_at IS NOT NULL "
                "THEN TIMESTAMPDIFF(SECOND, created_at, completed_at) END) "
                "AS average_processing_seconds FROM skin_analyses"
            )
            scans = cursor.fetchone()
            cursor.execute(
                "SELECT COUNT(DISTINCT user_id) AS monthly_active_users "
                "FROM skin_analyses WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)"
            )
            monthly_active = cursor.fetchone()
            cursor.execute(
                "SELECT COUNT(*) AS pending_reports FROM support_reports "
                "WHERE status IN ('pending', 'in_progress')"
            )
            support = cursor.fetchone()
            cursor.execute(
                "SELECT COUNT(*) AS pending_review_reports FROM review_reports "
                "WHERE status = 'pending'"
            )
            review_reports = cursor.fetchone()
            cursor.execute(
                "SELECT COUNT(*) AS open_issues FROM ("
                "SELECT a.analysis_id AS issue_id FROM skin_analyses a "
                "WHERE a.status = 'failed' AND COALESCE(("
                "SELECT JSON_UNQUOTE(JSON_EXTRACT(l.details, '$.status')) "
                "FROM staff_audit_logs l WHERE l.action = 'admin_issue_status' "
                "AND l.target_type = 'analysis_issue' AND l.target_id = a.analysis_id "
                "ORDER BY l.log_id DESC LIMIT 1), 'open') <> 'reviewed' "
                "UNION ALL "
                "SELECT i.image_id AS issue_id FROM skin_images i "
                "WHERE i.quality_passed = 0 AND COALESCE(("
                "SELECT JSON_UNQUOTE(JSON_EXTRACT(l.details, '$.status')) "
                "FROM staff_audit_logs l WHERE l.action = 'admin_issue_status' "
                "AND l.target_type = 'image_issue' AND l.target_id = i.image_id "
                "ORDER BY l.log_id DESC LIMIT 1), 'open') <> 'reviewed'"
                ") AS issues"
            )
            issues = cursor.fetchone()
            weekly = _week_activity(cursor)
            cursor.execute(
                "SELECT l.log_id, l.action, l.target_type, l.target_id, l.details, "
                "l.created_at, u.full_name AS actor_name "
                "FROM staff_audit_logs l JOIN users u ON u.user_id = l.actor_id "
                "ORDER BY l.created_at DESC, l.log_id DESC LIMIT 5"
            )
            activity = normalize_dates(cursor.fetchall())
    return {
        "users": users,
        "products": products,
        "scans": scans,
        "monthly_active_users": monthly_active["monthly_active_users"],
        "pending_reports": support["pending_reports"],
        "pending_review_reports": review_reports["pending_review_reports"],
        "open_issues": issues["open_issues"],
        "weekly_scans": weekly,
        "recent_activity": activity,
    }


def fetch_moderator_overview(moderator_id: int) -> dict:
    overview = fetch_admin_overview()
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT COUNT(*) AS total_users, "
                "COALESCE(SUM(account_status = 'active'), 0) AS active_users "
                "FROM users WHERE role = 'user'"
            )
            community_users = cursor.fetchone()
            cursor.execute(
                "SELECT l.log_id, l.action, l.target_type, l.target_id, l.details, "
                "l.created_at, u.full_name AS actor_name "
                "FROM staff_audit_logs l JOIN users u ON u.user_id = l.actor_id "
                "WHERE l.actor_id = %s "
                "ORDER BY l.created_at DESC, l.log_id DESC LIMIT 5",
                (moderator_id,),
            )
            activity = normalize_dates(cursor.fetchall())
    overview["users"]["total_users"] = community_users["total_users"]
    overview["users"]["active_users"] = community_users["active_users"]
    overview["recent_activity"] = activity
    return overview


def fetch_admin_users() -> list[dict]:
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT u.user_id, u.full_name, u.email, u.role, u.account_status, "
                "u.created_at, COUNT(a.analysis_id) AS scan_count "
                "FROM users u LEFT JOIN skin_analyses a ON a.user_id = u.user_id "
                "GROUP BY u.user_id, u.full_name, u.email, u.role, u.account_status, "
                "u.created_at ORDER BY u.created_at DESC, u.user_id DESC"
            )
            return normalize_dates(cursor.fetchall())


def fetch_moderator_users() -> list[dict]:
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT u.user_id, u.full_name, u.email, u.account_status, "
                "u.created_at, COUNT(a.analysis_id) AS scan_count "
                "FROM users u LEFT JOIN skin_analyses a ON a.user_id = u.user_id "
                "WHERE u.role = 'user' "
                "GROUP BY u.user_id, u.full_name, u.email, u.account_status, u.created_at "
                "ORDER BY u.created_at DESC, u.user_id DESC"
            )
            return normalize_dates(cursor.fetchall())


def update_moderator_user(user_id: int, update: ModeratorUserUpdate, moderator_id: int) -> dict:
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT role, account_status FROM users WHERE user_id = %s FOR UPDATE",
                (user_id,),
            )
            target = cursor.fetchone()
            if not target:
                raise HTTPException(status_code=404, detail="User not found.")
            if target["role"] != "user":
                raise HTTPException(status_code=403, detail="Moderators can only manage regular user accounts.")
            if target["account_status"] != update.account_status:
                cursor.execute(
                    "UPDATE users SET account_status = %s WHERE user_id = %s",
                    (update.account_status, user_id),
                )
                write_audit_log(
                    cursor,
                    moderator_id,
                    "user_suspended" if update.account_status == "suspended" else "user_reactivated",
                    "user",
                    user_id,
                    {"account_status": update.account_status},
                )
        connection.commit()
    return {"user_id": user_id, "account_status": update.account_status}


def fetch_admin_moderators() -> list[dict]:
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT u.user_id, u.full_name, u.email, u.account_status, u.created_at, "
                "COUNT(DISTINCT m.review_id) AS reviews_handled "
                "FROM users u LEFT JOIN review_moderations m ON m.moderator_id = u.user_id "
                "WHERE u.role = 'moderator' "
                "GROUP BY u.user_id, u.full_name, u.email, u.account_status, u.created_at "
                "ORDER BY u.created_at DESC, u.user_id DESC"
            )
            return normalize_dates(cursor.fetchall())


def fetch_admin_products() -> list[dict]:
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT p.product_id, p.product_name, p.brand, p.category, p.description, "
                "p.price, p.currency, p.image_path, p.is_active, p.created_at, "
                "COUNT(r.review_id) AS review_count "
                "FROM products p LEFT JOIN product_reviews r "
                "ON r.product_id = p.product_id AND r.status <> 'hidden' "
                "GROUP BY p.product_id, p.product_name, p.brand, p.category, p.description, "
                "p.price, p.currency, p.image_path, p.is_active, p.created_at "
                "ORDER BY p.created_at DESC, p.product_id DESC"
            )
            return normalize_dates(cursor.fetchall())


def fetch_scan_records() -> list[dict]:
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT a.analysis_id, a.analysis_type, a.status, a.model_version, "
                "a.error_code, a.error_message, a.guidance_text, a.created_at, "
                "a.completed_at, u.full_name AS user_name "
                "FROM skin_analyses a JOIN users u ON u.user_id = a.user_id "
                "ORDER BY a.created_at DESC, a.analysis_id DESC LIMIT 200"
            )
            return normalize_dates(cursor.fetchall())


def fetch_analysis_summary() -> dict:
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT COUNT(*) AS total, "
                "COALESCE(SUM(status = 'completed'), 0) AS completed, "
                "COALESCE(SUM(status = 'failed'), 0) AS failed, "
                "COALESCE(SUM(status IN ('pending', 'processing')), 0) AS in_progress, "
                "AVG(CASE WHEN status = 'completed' AND completed_at IS NOT NULL "
                "THEN TIMESTAMPDIFF(SECOND, created_at, completed_at) END) "
                "AS average_seconds FROM skin_analyses"
            )
            summary = cursor.fetchone()
            cursor.execute(
                "SELECT COUNT(*) AS total, "
                "COALESCE(SUM(quality_passed = 1), 0) AS passed, "
                "COALESCE(SUM(quality_passed = 0), 0) AS failed "
                "FROM skin_images WHERE quality_passed IS NOT NULL"
            )
            images = cursor.fetchone()
            cursor.execute(
                "SELECT analysis_id, analysis_type, guidance_text, completed_at "
                "FROM skin_analyses WHERE status = 'completed' "
                "ORDER BY completed_at DESC, analysis_id DESC LIMIT 1"
            )
            latest = cursor.fetchone()
            if latest:
                normalize_dates([latest])
            cursor.execute(
                "SELECT DATE(created_at) AS activity_date, "
                "AVG(TIMESTAMPDIFF(SECOND, created_at, completed_at)) AS average_seconds "
                "FROM skin_analyses WHERE status = 'completed' AND completed_at IS NOT NULL "
                "AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY) "
                "GROUP BY DATE(created_at) ORDER BY activity_date"
            )
            processing_trend = normalize_dates(cursor.fetchall())
    return {
        "summary": summary,
        "images": images,
        "latest": latest,
        "processing_trend": processing_trend,
    }


def fetch_admin_issues() -> list[dict]:
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT 'analysis' AS issue_type, a.analysis_id AS target_id, "
                "a.analysis_id, u.full_name AS user_name, 'Analysis failed' AS issue, "
                "COALESCE(a.error_code, a.error_message, 'Analysis failed') AS details, "
                "a.created_at AS detected_at, 'High' AS severity, "
                "COALESCE((SELECT JSON_UNQUOTE(JSON_EXTRACT(l.details, '$.status')) "
                "FROM staff_audit_logs l WHERE l.action = 'admin_issue_status' "
                "AND l.target_type = 'analysis_issue' AND l.target_id = a.analysis_id "
                "ORDER BY l.log_id DESC LIMIT 1), 'open') AS review_status "
                "FROM skin_analyses a JOIN users u ON u.user_id = a.user_id "
                "WHERE a.status = 'failed' "
                "UNION ALL "
                "SELECT 'image' AS issue_type, i.image_id AS target_id, "
                "a.analysis_id, u.full_name AS user_name, 'Image quality check failed' AS issue, "
                "COALESCE(i.quality_reason, 'Image quality check failed') AS details, "
                "i.uploaded_at AS detected_at, 'Medium' AS severity, "
                "COALESCE((SELECT JSON_UNQUOTE(JSON_EXTRACT(l.details, '$.status')) "
                "FROM staff_audit_logs l WHERE l.action = 'admin_issue_status' "
                "AND l.target_type = 'image_issue' AND l.target_id = i.image_id "
                "ORDER BY l.log_id DESC LIMIT 1), 'open') AS review_status "
                "FROM skin_images i JOIN skin_analyses a ON a.analysis_id = i.analysis_id "
                "JOIN users u ON u.user_id = a.user_id WHERE i.quality_passed = 0 "
                "ORDER BY detected_at DESC LIMIT 200"
            )
            return normalize_dates(cursor.fetchall())


def fetch_support_reports() -> list[dict]:
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT r.report_id, r.category, r.subject, r.description, r.status, "
                "r.created_at, r.updated_at, u.full_name AS reporter_name "
                "FROM support_reports r JOIN users u ON u.user_id = r.reporter_id "
                "ORDER BY r.created_at DESC, r.report_id DESC LIMIT 200"
            )
            return normalize_dates(cursor.fetchall())


def fetch_review_reports() -> list[dict]:
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT rr.report_id, rr.review_id, rr.reason, rr.details, rr.status, "
                "rr.created_at, r.rating, r.review_text, reporter.full_name AS reporter_name, "
                "reviewer.full_name AS reviewer_name, p.product_name "
                "FROM review_reports rr "
                "JOIN product_reviews r ON r.review_id = rr.review_id "
                "JOIN users reporter ON reporter.user_id = rr.reporter_id "
                "JOIN users reviewer ON reviewer.user_id = r.user_id "
                "JOIN products p ON p.product_id = r.product_id "
                "ORDER BY rr.created_at DESC, rr.report_id DESC LIMIT 200"
            )
            return normalize_dates(cursor.fetchall())


def fetch_admin_logs() -> list[dict]:
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT l.log_id, l.action, l.target_type, l.target_id, l.details, "
                "l.created_at, u.full_name AS actor_name "
                "FROM staff_audit_logs l JOIN users u ON u.user_id = l.actor_id "
                "ORDER BY l.created_at DESC, l.log_id DESC LIMIT 200"
            )
            return normalize_dates(cursor.fetchall())


@app.get("/api/admin/overview")
def admin_overview(_admin: dict = Depends(require_admin)):
    try:
        return fetch_admin_overview()
    except Exception:
        logger.exception("Admin overview could not be loaded.")
        raise HTTPException(status_code=503, detail="Admin overview is temporarily unavailable.") from None


@app.get("/api/admin/users")
def admin_users(_admin: dict = Depends(require_admin)):
    try:
        return {"users": fetch_admin_users()}
    except Exception:
        logger.exception("Admin user list could not be loaded.")
        raise HTTPException(status_code=503, detail="User data is temporarily unavailable.") from None


@app.get("/api/admin/moderators")
def admin_moderators(_admin: dict = Depends(require_admin)):
    try:
        return {"moderators": fetch_admin_moderators()}
    except Exception:
        logger.exception("Admin moderator list could not be loaded.")
        raise HTTPException(status_code=503, detail="Moderator data is temporarily unavailable.") from None


@app.get("/api/admin/products")
def admin_products(_admin: dict = Depends(require_admin)):
    try:
        return {"products": fetch_admin_products()}
    except Exception:
        logger.exception("Admin product list could not be loaded.")
        raise HTTPException(status_code=503, detail="Product data is temporarily unavailable.") from None


@app.post("/api/admin/product-images", status_code=201)
async def admin_upload_product_image(
    file: UploadFile = File(...),
    _admin: dict = Depends(require_admin),
):
    try:
        image_data = await file.read(max_product_image_bytes + 1)
        if not image_data:
            raise HTTPException(status_code=422, detail="Choose an image file.")
        if len(image_data) > max_product_image_bytes:
            raise HTTPException(status_code=413, detail="Product images must be 5 MB or smaller.")
        extension = validate_product_image_content(file.content_type, image_data)
        filename = f"{uuid.uuid4().hex}.{extension}"
        product_image_directory.mkdir(parents=True, exist_ok=True)
        (product_image_directory / filename).write_bytes(image_data)
        return {"image_path": f"/frontend/Admin/uploads/{filename}"}
    except HTTPException:
        raise
    except OSError:
        logger.exception("Admin product image could not be saved.")
        raise HTTPException(status_code=503, detail="The product image could not be saved.") from None
    finally:
        await file.close()


@app.post("/api/admin/products", status_code=201)
def admin_create_product(product: ProductCreate, admin: dict = Depends(require_admin)):
    try:
        product_name = product.product_name.strip()
        if not product_name:
            raise HTTPException(status_code=422, detail="Product name cannot be blank.")
        image_path = validate_product_image_path(product.image_path)
        with database_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO products "
                    "(product_name, brand, category, description, price, currency, image_path) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (
                        product_name,
                        product.brand,
                        product.category,
                        product.description,
                        product.price,
                        product.currency.upper(),
                        image_path,
                    ),
                )
                product_id = cursor.lastrowid
                write_audit_log(cursor, admin["user_id"], "product_created", "product", product_id)
            connection.commit()
        return {"product_id": product_id}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Admin could not create a product.")
        raise HTTPException(status_code=503, detail="The product could not be saved.") from None


@app.patch("/api/admin/products/{product_id}")
def admin_update_product(
    update: ProductUpdate,
    product_id: int = Path(..., gt=0),
    admin: dict = Depends(require_admin),
):
    changes = update.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Provide at least one product field to update.")
    if any(changes.get(field) is None for field in ("product_name", "currency", "is_active")):
        raise HTTPException(status_code=422, detail="Product name, currency, and active status cannot be null.")
    if "product_name" in changes and changes["product_name"] is not None:
        changes["product_name"] = changes["product_name"].strip()
        if not changes["product_name"]:
            raise HTTPException(status_code=422, detail="Product name cannot be blank.")
    if "currency" in changes:
        changes["currency"] = changes["currency"].upper()
    if "image_path" in changes:
        changes["image_path"] = validate_product_image_path(changes["image_path"])
    allowed_fields = {
        "product_name", "brand", "category", "description", "price",
        "currency", "image_path", "is_active",
    }
    if not set(changes).issubset(allowed_fields):
        raise HTTPException(status_code=422, detail="The product update contains unsupported fields.")
    assignments = ", ".join(f"{field} = %s" for field in changes)
    values = list(changes.values())
    try:
        with database_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"UPDATE products SET {assignments} WHERE product_id = %s",
                    [*values, product_id],
                )
                if cursor.rowcount == 0:
                    cursor.execute("SELECT product_id FROM products WHERE product_id = %s", (product_id,))
                    if not cursor.fetchone():
                        raise HTTPException(status_code=404, detail="Product not found.")
                write_audit_log(
                    cursor, admin["user_id"], "product_updated", "product", product_id, changes
                )
            connection.commit()
        return {"product_id": product_id}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Admin could not update a product.")
        raise HTTPException(status_code=503, detail="The product could not be updated.") from None


@app.patch("/api/admin/users/{user_id}")
def admin_update_user(
    update: UserUpdate,
    user_id: int = Path(..., gt=0),
    admin: dict = Depends(require_admin),
):
    changes = update.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Provide a role or account status.")
    if any(value is None for value in changes.values()):
        raise HTTPException(status_code=422, detail="Role and account status cannot be null.")
    if user_id == admin["user_id"]:
        raise HTTPException(status_code=403, detail="You cannot change your own admin account here.")
    assignments = ", ".join(f"{field} = %s" for field in changes)
    try:
        with database_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT role FROM users WHERE user_id = %s", (user_id,))
                target = cursor.fetchone()
                if not target:
                    raise HTTPException(status_code=404, detail="User not found.")
                if target["role"] == "admin":
                    raise HTTPException(status_code=403, detail="Admin accounts cannot be changed here.")
                cursor.execute(
                    f"UPDATE users SET {assignments} WHERE user_id = %s",
                    [*changes.values(), user_id],
                )
                write_audit_log(cursor, admin["user_id"], "user_updated", "user", user_id, changes)
            connection.commit()
        return {"user_id": user_id}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Admin could not update a user account.")
        raise HTTPException(status_code=503, detail="The user account could not be updated.") from None


@app.get("/api/admin/scan-records")
def admin_scan_records(_admin: dict = Depends(require_admin)):
    try:
        return {"scans": fetch_scan_records()}
    except Exception:
        logger.exception("Admin scan history could not be loaded.")
        raise HTTPException(status_code=503, detail="Scan history is temporarily unavailable.") from None


@app.get("/api/admin/analysis-summary")
def admin_analysis_summary(_admin: dict = Depends(require_admin)):
    try:
        return fetch_analysis_summary()
    except Exception:
        logger.exception("Admin analysis summary could not be loaded.")
        raise HTTPException(status_code=503, detail="Analysis data is temporarily unavailable.") from None


@app.get("/api/admin/issues")
def admin_issues(_admin: dict = Depends(require_admin)):
    try:
        return {"issues": fetch_admin_issues()}
    except Exception:
        logger.exception("Admin issue queue could not be loaded.")
        raise HTTPException(status_code=503, detail="Analysis issues are temporarily unavailable.") from None


@app.patch("/api/admin/issues/{issue_type}/{target_id}")
def admin_update_issue(
    update: IssueUpdate,
    issue_type: Literal["analysis", "image"],
    target_id: int = Path(..., gt=0),
    admin: dict = Depends(require_admin),
):
    target_table = "skin_analyses" if issue_type == "analysis" else "skin_images"
    target_column = "analysis_id" if issue_type == "analysis" else "image_id"
    issue_filter = "status = 'failed'" if issue_type == "analysis" else "quality_passed = 0"
    target_type = f"{issue_type}_issue"
    try:
        with database_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"SELECT {target_column} FROM {target_table} "
                    f"WHERE {target_column} = %s AND {issue_filter}",
                    (target_id,),
                )
                if not cursor.fetchone():
                    raise HTTPException(status_code=404, detail="Analysis issue not found.")
                write_audit_log(
                    cursor,
                    admin["user_id"],
                    "admin_issue_status",
                    target_type,
                    target_id,
                    {"status": update.status},
                )
            connection.commit()
        return {"issue_type": issue_type, "target_id": target_id, "status": update.status}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Admin could not update issue status.")
        raise HTTPException(status_code=503, detail="The issue status could not be updated.") from None


@app.get("/api/admin/support-reports")
def admin_support_reports(_admin: dict = Depends(require_admin)):
    try:
        return {"reports": fetch_support_reports()}
    except Exception:
        logger.exception("Admin support reports could not be loaded.")
        raise HTTPException(status_code=503, detail="Support reports are temporarily unavailable.") from None


@app.get("/api/admin/review-reports")
def admin_review_reports(_admin: dict = Depends(require_admin)):
    try:
        return {"reports": fetch_review_reports()}
    except Exception:
        logger.exception("Admin product review reports could not be loaded.")
        raise HTTPException(status_code=503, detail="Product review reports are temporarily unavailable.") from None


@app.patch("/api/admin/review-reports/{report_id}")
def admin_update_review_report(
    update: ReviewReportUpdate,
    report_id: int = Path(..., gt=0),
    admin: dict = Depends(require_admin),
):
    try:
        with database_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT review_id FROM review_reports WHERE report_id = %s",
                    (report_id,),
                )
                report = cursor.fetchone()
                if not report:
                    raise HTTPException(status_code=404, detail="Product review report not found.")
                cursor.execute(
                    "UPDATE review_reports SET status = %s, "
                    "resolved_at = CASE WHEN %s = 'pending' THEN NULL ELSE UTC_TIMESTAMP() END "
                    "WHERE report_id = %s",
                    (update.status, update.status, report_id),
                )
                if update.status in {"resolved", "dismissed"}:
                    action = "dismiss_report" if update.status == "dismissed" else "resolve_report"
                    cursor.execute(
                        "INSERT INTO review_moderations "
                        "(review_id, report_id, moderator_id, action, reason) "
                        "VALUES (%s, %s, %s, %s, %s)",
                        (
                            report["review_id"],
                            report_id,
                            admin["user_id"],
                            action,
                            f"{admin['role'].capitalize()} marked the report {update.status}.",
                        ),
                    )
                write_audit_log(
                    cursor,
                    admin["user_id"],
                    "review_report_status_changed",
                    "review_report",
                    report_id,
                    {"status": update.status},
                )
            connection.commit()
        return {"report_id": report_id, "status": update.status}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Admin could not update a product review report.")
        raise HTTPException(status_code=503, detail="The product review report could not be updated.") from None


@app.patch("/api/admin/support-reports/{report_id}")
def admin_update_support_report(
    update: ReportUpdate,
    report_id: int = Path(..., gt=0),
    admin: dict = Depends(require_admin),
):
    try:
        with database_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE support_reports SET status = %s, "
                    "resolved_at = CASE WHEN %s IN ('resolved', 'dismissed') "
                    "THEN UTC_TIMESTAMP() ELSE NULL END "
                    "WHERE report_id = %s",
                    (update.status, update.status, report_id),
                )
                if cursor.rowcount == 0:
                    cursor.execute(
                        "SELECT report_id FROM support_reports WHERE report_id = %s",
                        (report_id,),
                    )
                    if not cursor.fetchone():
                        raise HTTPException(status_code=404, detail="Support report not found.")
                write_audit_log(
                    cursor,
                    admin["user_id"],
                    "support_report_status_changed",
                    "support_report",
                    report_id,
                    {"status": update.status},
                )
            connection.commit()
        return {"report_id": report_id, "status": update.status}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Admin could not update a support report.")
        raise HTTPException(status_code=503, detail="The support report could not be updated.") from None


@app.get("/api/admin/logs")
def admin_logs(_admin: dict = Depends(require_admin)):
    try:
        return {"logs": fetch_admin_logs()}
    except Exception:
        logger.exception("Admin audit logs could not be loaded.")
        raise HTTPException(status_code=503, detail="Audit logs are temporarily unavailable.") from None


@app.get("/api/admin/me")
def admin_profile(admin: dict = Depends(require_admin)):
    return {
        "user_id": admin["user_id"],
        "full_name": admin["full_name"],
        "email": admin["email"],
        "role": admin["role"],
    }


def update_staff_profile(update: ProfileUpdate, staff: dict) -> dict:
    full_name = update.full_name.strip()
    email = update.email.strip()
    if not full_name or "@" not in email or any(character.isspace() for character in email):
        raise HTTPException(status_code=422, detail="Enter a valid name and email address.")
    with database_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT user_id FROM users WHERE email = %s AND user_id <> %s",
                (email, staff["user_id"]),
            )
            if cursor.fetchone():
                raise HTTPException(status_code=409, detail="That email is already in use.")
            cursor.execute(
                "UPDATE users SET full_name = %s, email = %s WHERE user_id = %s",
                (full_name, email, staff["user_id"]),
            )
            write_audit_log(
                cursor,
                staff["user_id"],
                f"{staff['role']}_profile_updated",
                "user",
                staff["user_id"],
                {"full_name": full_name, "email": email},
            )
        connection.commit()
    return {
        "user_id": staff["user_id"],
        "full_name": full_name,
        "email": email,
        "role": staff["role"],
    }


@app.patch("/api/admin/me")
def admin_update_profile(update: ProfileUpdate, admin: dict = Depends(require_admin)):
    try:
        return update_staff_profile(update, admin)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Admin profile could not be updated.")
        raise HTTPException(status_code=503, detail="The admin profile could not be updated.") from None


@app.get("/api/admin/product-reviews")
def admin_product_reviews(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    date_from: date | None = None,
    date_to: date | None = None,
    status: Literal["public", "hidden", "all"] = "public",
    _admin: dict = Depends(require_admin),
):
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="Start date must be on or before end date.")
    try:
        reviews, total = fetch_product_reviews(page, page_size, date_from, date_to, status)
    except Exception:
        logger.error("Admin product reviews could not be loaded.")
        raise HTTPException(status_code=503, detail="Product reviews are temporarily unavailable.") from None
    return {
        "reviews": reviews,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": max(1, (total + page_size - 1) // page_size),
    }


@app.post("/api/admin/product-reviews/{review_id}/hide", status_code=204)
def admin_hide_product_review(
    request: ReviewHideRequest,
    review_id: int = Path(..., gt=0),
    admin: dict = Depends(require_admin),
):
    try:
        if not hide_product_review(review_id, admin["user_id"], request.reason):
            raise HTTPException(status_code=404, detail="Review not found.")
    except HTTPException:
        raise
    except Exception:
        logger.error("Admin could not remove a product review.")
        raise HTTPException(status_code=503, detail="The review could not be removed.") from None


@app.post("/api/admin/product-reviews/{review_id}/restore", status_code=204)
def admin_restore_product_review(
    review_id: int = Path(..., gt=0),
    admin: dict = Depends(require_admin),
):
    try:
        if not restore_product_review(review_id, admin["user_id"]):
            raise HTTPException(status_code=404, detail="Hidden review not found.")
    except HTTPException:
        raise
    except Exception:
        logger.exception("Admin could not restore a product review.")
        raise HTTPException(status_code=503, detail="The review could not be restored.") from None


@app.get("/api/moderator/overview")
def moderator_overview(moderator: dict = Depends(require_moderator)):
    try:
        return fetch_moderator_overview(moderator["user_id"])
    except Exception:
        logger.exception("Moderator overview could not be loaded.")
        raise HTTPException(status_code=503, detail="Moderator overview is temporarily unavailable.") from None


@app.get("/api/moderator/users")
def moderator_users(_moderator: dict = Depends(require_moderator)):
    try:
        return {"users": fetch_moderator_users()}
    except Exception:
        logger.exception("Moderator user list could not be loaded.")
        raise HTTPException(status_code=503, detail="User data is temporarily unavailable.") from None


@app.patch("/api/moderator/users/{user_id}")
def moderator_update_user(
    update: ModeratorUserUpdate,
    user_id: int = Path(..., gt=0),
    moderator: dict = Depends(require_moderator),
):
    try:
        return update_moderator_user(user_id, update, moderator["user_id"])
    except HTTPException:
        raise
    except Exception:
        logger.exception("Moderator could not update a user account.")
        raise HTTPException(status_code=503, detail="The account status could not be updated.") from None


@app.get("/api/moderator/products")
def moderator_products(_moderator: dict = Depends(require_moderator)):
    try:
        return {"products": fetch_admin_products()}
    except Exception:
        logger.exception("Moderator product list could not be loaded.")
        raise HTTPException(status_code=503, detail="Product data is temporarily unavailable.") from None


@app.post("/api/moderator/product-images", status_code=201)
async def moderator_upload_product_image(
    file: UploadFile = File(...),
    moderator: dict = Depends(require_moderator),
):
    return await admin_upload_product_image(file, moderator)


@app.post("/api/moderator/products", status_code=201)
def moderator_create_product(
    product: ProductCreate,
    moderator: dict = Depends(require_moderator),
):
    return admin_create_product(product, moderator)


@app.patch("/api/moderator/products/{product_id}")
def moderator_update_product(
    update: ProductUpdate,
    product_id: int = Path(..., gt=0),
    moderator: dict = Depends(require_moderator),
):
    return admin_update_product(update, product_id, moderator)


@app.get("/api/moderator/product-reviews")
def moderator_product_reviews(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    date_from: date | None = None,
    date_to: date | None = None,
    status: Literal["public", "hidden", "all"] = "public",
    moderator: dict = Depends(require_moderator),
):
    return admin_product_reviews(page, page_size, date_from, date_to, status, moderator)


@app.post("/api/moderator/product-reviews/{review_id}/hide", status_code=204)
def moderator_hide_product_review(
    request: ReviewHideRequest,
    review_id: int = Path(..., gt=0),
    moderator: dict = Depends(require_moderator),
):
    return admin_hide_product_review(request, review_id, moderator)


@app.post("/api/moderator/product-reviews/{review_id}/restore", status_code=204)
def moderator_restore_product_review(
    review_id: int = Path(..., gt=0),
    moderator: dict = Depends(require_moderator),
):
    return admin_restore_product_review(review_id, moderator)


@app.get("/api/moderator/review-reports")
def moderator_review_reports(_moderator: dict = Depends(require_moderator)):
    try:
        return {"reports": fetch_review_reports()}
    except Exception:
        logger.exception("Moderator product review reports could not be loaded.")
        raise HTTPException(status_code=503, detail="Product review reports are temporarily unavailable.") from None


@app.patch("/api/moderator/review-reports/{report_id}")
def moderator_update_review_report(
    update: ReviewReportUpdate,
    report_id: int = Path(..., gt=0),
    moderator: dict = Depends(require_moderator),
):
    return admin_update_review_report(update, report_id, moderator)


@app.get("/api/moderator/support-reports")
def moderator_support_reports(_moderator: dict = Depends(require_moderator)):
    try:
        return {"reports": fetch_support_reports()}
    except Exception:
        logger.exception("Moderator support reports could not be loaded.")
        raise HTTPException(status_code=503, detail="Support reports are temporarily unavailable.") from None


@app.patch("/api/moderator/support-reports/{report_id}")
def moderator_update_support_report(
    update: ReportUpdate,
    report_id: int = Path(..., gt=0),
    moderator: dict = Depends(require_moderator),
):
    return admin_update_support_report(update, report_id, moderator)


@app.get("/api/moderator/me")
def moderator_profile(moderator: dict = Depends(require_moderator)):
    return {
        "user_id": moderator["user_id"],
        "full_name": moderator["full_name"],
        "email": moderator["email"],
        "role": moderator["role"],
    }


@app.patch("/api/moderator/me")
def moderator_update_profile(
    update: ProfileUpdate,
    moderator: dict = Depends(require_moderator),
):
    try:
        return update_staff_profile(update, moderator)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Moderator profile could not be updated.")
        raise HTTPException(status_code=503, detail="The moderator profile could not be updated.") from None
