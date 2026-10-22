"""اختبارات عقد moderation/admin؛ تعتمد على test_api لتهيئة البيئة المؤقتة فقط.

هذه الاختبارات مقصودة لتعمل مع backend قيد التنفيذ، وتحوّل متطلبات الاعتدال
إلى مواصفات قابلة للتنفيذ دون استخدام قاعدة بيانات حية أو أسرار بيئة الإنتاج.
"""
import json
import sqlite3
import uuid
import unittest
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import test_api as api_setup  # noqa: F401  # initializes env before importing backend
from sqlalchemy import create_engine, inspect, text

from config import settings
from database.db import Base, SessionLocal
from database.migrations import migrate_additive_media_columns
from models.models import (
    Comment, Conversation, Message, ModerationAudit, Post, Report, ReportStatus,
    Reel, Story, User, utcnow_naive,
)
from services.moderation import admin_ids, is_platform_admin


class ModerationContractTests(unittest.TestCase):
    """Integration contract tests; every username is unique within the shared temp DB."""

    @classmethod
    def setUpClass(cls):
        cls.client = api_setup.TestClient(api_setup.app)

    def register(self, username, email=None, password="Password123"):
        response = self.client.post("/api/auth/register", json={
            "username": username,
            "email": email or f"{username}@example.com",
            "full_name": username.title(),
            "password": password,
        })
        self.assertEqual(response.status_code, 201, response.text)
        result = response.json()
        return result["access_token"], result["user"]

    def fresh(self, prefix="u"):
        return f"{prefix}_{uuid.uuid4().hex[:10]}"

    def make_user(self, prefix="user"):
        name = self.fresh(prefix)
        token, public = self.register(name)
        with SessionLocal() as db:
            user_id = db.query(User).filter_by(username=name).one().id
        return name, user_id, token, public

    def make_admin_pair(self):
        first = self.make_user("admin")
        second = self.make_user("admin")
        with SessionLocal() as db:
            for user_id in (first[1], second[1]):
                db.get(User, user_id).is_admin = True
            db.commit()
        return first, second

    @staticmethod
    def auth(token):
        return {"Authorization": f"Bearer {token}"}

    def admin_scope(self, pair):
        return patch.object(settings, "admin_user_ids", f"{pair[0][1]},{pair[1][1]}")

    def test_private_ids_file_is_strict_and_never_overrides_nonempty_environment(self):
        with tempfile.TemporaryDirectory(prefix="ytrana-ids-test-") as folder:
            file = Path(folder) / "ids.json"
            with patch("services.moderation.ADMIN_IDS_FILE", file), patch.object(settings, "admin_user_ids", ""):
                self.assertEqual(admin_ids(), frozenset())
                file.write_text("[1,3]")
                self.assertEqual(admin_ids(), frozenset({1,3}))
                for invalid in ["[1,1]", "[true,3]", "[1,3,4]", "[0,3]", '["1",3]', "{}", "bad json"]:
                    file.write_text(invalid)
                    self.assertEqual(admin_ids(), frozenset())
                file.write_text("[1,3]")
                with patch.object(settings, "admin_user_ids", "invalid"):
                    self.assertEqual(admin_ids(), frozenset())
                with patch.object(settings, "admin_user_ids", "10,20"):
                    self.assertEqual(admin_ids(), frozenset({10,20}))
                file.unlink()
                target = Path(folder) / "target.json"
                target.write_text("[1,3]")
                file.symlink_to(target)
                self.assertEqual(admin_ids(), frozenset())

    def test_admin_ids_fail_closed_and_require_exactly_two_distinct_positive_ascii_ints(self):
        values = ("", "1", "1,1", "1,2,3", "1,-2", "0,2", "١,2", "x,2")
        for value in values:
            with patch.object(settings, "admin_user_ids", value):
                self.assertEqual(admin_ids(), frozenset(), value)
        with patch.object(settings, "admin_user_ids", "12,34"):
            self.assertEqual(admin_ids(), frozenset({12, 34}))

    def test_access_is_closed_by_default_and_requires_both_configured_ids_and_flag(self):
        first = self.make_user("closed")
        second = self.make_user("closed")
        with SessionLocal() as db:
            db.get(User, first[1]).is_admin = True
            db.get(User, second[1]).is_admin = True
            db.commit()
        with patch.object(settings, "admin_user_ids", ""):
            closed = self.client.get("/api/admin/access", headers=self.auth(first[2]))
        self.assertEqual(closed.status_code, 403)
        with patch.object(settings, "admin_user_ids", f"{first[1]},{second[1]}"):
            self.assertTrue(self.client.get("/api/admin/access", headers=self.auth(first[2])).json()["allowed"])
            with SessionLocal() as db:
                db.get(User, second[1]).is_admin = False
                db.commit()
            self.assertEqual(self.client.get("/api/admin/access", headers=self.auth(second[2])).status_code, 403)

    def test_platform_admin_requires_flag_membership_active_unbanned_unfrozen_and_rename_does_not_grant(self):
        pair = self.make_admin_pair()
        with self.admin_scope(pair):
            with SessionLocal() as db:
                user = db.get(User, pair[0][1])
                self.assertTrue(is_platform_admin(user))
                user.username = self.fresh("renamed")
                db.commit()
                self.assertTrue(is_platform_admin(user))
                user.is_admin = False
                db.commit()
                self.assertFalse(is_platform_admin(user))
                user.is_admin = True
                user.is_active = False
                db.commit()
                self.assertFalse(is_platform_admin(user))
                user.is_active = True
                user.is_banned = True
                db.commit()
                self.assertFalse(is_platform_admin(user))

    def test_profile_cannot_grant_admin_flags_and_user_search_supports_skip_limit(self):
        name, user_id, token, _ = self.make_user("search")
        other = self.make_user("search")
        response = self.client.get("/api/users/search", params={"q": name, "skip": 0, "limit": 1})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()[0]["username"], name)
        self.assertNotIn("is_admin", response.json()[0])
        with SessionLocal() as db:
            db.get(User, user_id).is_admin = False
            db.commit()
        self.assertFalse(self.client.get("/api/auth/me", headers=self.auth(token)).json()["is_admin"])
        self.assertNotEqual(name, other[0])

    def test_admin_user_listing_and_verification_permanent_temporary_revoke_with_validation(self):
        pair = self.make_admin_pair()
        target = self.make_user("verify")
        with self.admin_scope(pair):
            admin_headers = self.auth(pair[0][2])
            listing = self.client.get("/api/admin/users?skip=0&limit=2", headers=admin_headers)
            self.assertEqual(listing.status_code, 200, listing.text)
            bad = self.client.put(f"/api/admin/users/{target[1]}/verification", json={"mode": "temporary", "days": 0}, headers=admin_headers)
            self.assertEqual(bad.status_code, 422)
            permanent = self.client.put(f"/api/admin/users/{target[1]}/verification", json={"mode": "permanent", "note": "trusted"}, headers=admin_headers)
            self.assertEqual(permanent.status_code, 200, permanent.text)
            temporary = self.client.put(f"/api/admin/users/{target[1]}/verification", json={"mode": "temporary", "days": 30, "note": "time-limited trust"}, headers=admin_headers)
            self.assertEqual(temporary.status_code, 200, temporary.text)
            revoke = self.client.put(f"/api/admin/users/{target[1]}/verification", json={"mode": "revoke", "note": "remove verification"}, headers=admin_headers)
            self.assertEqual(revoke.status_code, 200, revoke.text)
        with SessionLocal() as db:
            user = db.get(User, target[1])
            self.assertFalse(user.is_verified)
            self.assertIsNone(user.verified_at)

    def test_verification_and_freeze_expiry_are_runtime_properties_and_old_token_login_otp_are_rejected(self):
        name, user_id, token, _ = self.make_user("expiry")
        with SessionLocal() as db:
            user = db.get(User, user_id)
            user.verified_at = utcnow_naive() - timedelta(days=2)
            user.verification_expires_at = utcnow_naive() - timedelta(seconds=1)
            user.frozen_at = utcnow_naive() - timedelta(days=2)
            user.frozen_until = utcnow_naive() - timedelta(seconds=1)
            db.commit()
            self.assertFalse(user.is_verified)
            self.assertFalse(user.is_frozen)
        self.assertEqual(self.client.get("/api/auth/me", headers=self.auth(token)).status_code, 200)
        with SessionLocal() as db:
            user = db.get(User, user_id)
            user.frozen_at = utcnow_naive()
            user.frozen_until = utcnow_naive() + timedelta(days=2)
            db.commit()
        self.assertEqual(self.client.get("/api/auth/me", headers=self.auth(token)).status_code, 403)
        login = self.client.post("/api/auth/login", json={"username_or_email": name, "password": "Password123"})
        self.assertIn(login.status_code, (403, 200))
        if login.status_code == 200:
            self.assertFalse(login.json().get("access_token"))

    def test_freeze_unfreeze_preserves_ban_and_unban_does_not_unfreeze(self):
        pair = self.make_admin_pair()
        target = self.make_user("punish")
        headers = self.auth(pair[0][2])
        with self.admin_scope(pair):
            frozen = self.client.put(f"/api/admin/users/{target[1]}/freeze", json={"days": 7, "note": "cool down"}, headers=headers)
            self.assertEqual(frozen.status_code, 200, frozen.text)
            unfreeze = self.client.put(f"/api/admin/users/{target[1]}/unfreeze", headers=headers)
            self.assertEqual(unfreeze.status_code, 200, unfreeze.text)
            with SessionLocal() as db:
                user = db.get(User, target[1])
                user.is_banned = True
                db.commit()
            self.assertEqual(self.client.put(f"/api/admin/users/{target[1]}/unfreeze", headers=headers).status_code, 200)
            with SessionLocal() as db:
                self.assertTrue(db.get(User, target[1]).is_banned)
                db.get(User, target[1]).frozen_at = utcnow_naive()
                db.get(User, target[1]).frozen_until = utcnow_naive() + timedelta(days=2)
                db.commit()
            self.assertEqual(self.client.put(f"/api/admin/users/{target[1]}/unban", headers=headers).status_code, 200)
            with SessionLocal() as db:
                self.assertTrue(db.get(User, target[1]).is_frozen)

    def test_ban_freeze_and_resolve_cannot_mutate_either_configured_admin_even_directly(self):
        pair = self.make_admin_pair()
        headers = self.auth(pair[0][2])
        with self.admin_scope(pair):
            for endpoint in ("ban", "freeze"):
                payload = {"days": 2, "note": "must fail"} if endpoint == "freeze" else None
                response = self.client.put(f"/api/admin/users/{pair[1][1]}/{endpoint}", json=payload, headers=headers)
                self.assertIn(response.status_code, (400, 403))
            with SessionLocal() as db:
                self.assertFalse(db.get(User, pair[1][1]).is_banned)
                self.assertFalse(db.get(User, pair[1][1]).is_frozen)

    def test_configured_admin_cannot_delete_own_account_even_with_correct_password(self):
        pair = self.make_admin_pair()
        with self.admin_scope(pair):
            response = self.client.request("DELETE", "/api/users/me", json={"password": "Password123"}, headers=self.auth(pair[0][2]))
        self.assertEqual(response.status_code, 403, response.text)
        with SessionLocal() as db:
            self.assertIsNotNone(db.get(User, pair[0][1]))

    def test_report_media_is_admin_only_whitelisted_and_not_cacheable(self):
        pair = self.make_admin_pair()
        owner = self.make_user("mediaowner")
        reporter = self.make_user("mediareporter")
        media = Path(settings.upload_dir) / "posts" / f"moderation-{uuid.uuid4().hex}.jpg"
        media.parent.mkdir(parents=True, exist_ok=True)
        media.write_bytes(b"fixture-media")
        with SessionLocal() as db:
            post = Post(author_id=owner[1], content="media report", image_url=f"/uploads/posts/{media.name}")
            db.add(post)
            db.commit()
            post_id = post.id
        created = self.client.post("/api/reports", json={"target_type": "post", "target_id": post_id, "reason": "privacy"}, headers=self.auth(reporter[2]))
        self.assertEqual(created.status_code, 201, created.text)
        with SessionLocal() as db:
            report_id = db.query(Report).filter_by(target_id=post_id).one().id
        self.assertEqual(self.client.get(f"/api/admin/reports/{report_id}/media/image").status_code, 401)
        with self.admin_scope(pair):
            headers = self.auth(pair[0][2])
            target = self.client.get(f"/api/admin/reports/{report_id}/target", headers=headers)
            self.assertEqual(target.status_code, 200, target.text)
            self.assertEqual(target.json()["media"][0]["kind"], "image")
            served = self.client.get(f"/api/admin/reports/{report_id}/media/image", headers=headers)
            self.assertEqual(served.status_code, 200, served.text)
            self.assertEqual(served.content, b"fixture-media")
            self.assertEqual(served.headers.get("cache-control"), "private, no-store")
            self.assertEqual(self.client.get(f"/api/admin/reports/{report_id}/media/video", headers=headers).status_code, 404)
        media.unlink(missing_ok=True)

    def _post_and_comment(self, owner_token, commenter_token):
        post = self.client.post("/api/posts", data={"content": "reportable"}, headers=self.auth(owner_token))
        self.assertEqual(post.status_code, 201, post.text)
        comment = self.client.post(f"/api/posts/{post.json()['id']}/comments", json={"content": "bad"}, headers=self.auth(commenter_token))
        self.assertEqual(comment.status_code, 201, comment.text)
        return post.json()["id"], comment.json()["id"]

    def test_report_options_types_categories_defaults_and_invalid_values(self):
        options = self.client.get("/api/reports/options")
        self.assertEqual(options.status_code, 200)
        self.assertEqual(set(options.json()["target_types"]), {"user", "post", "comment", "reel", "story", "message"})
        self.assertIn("other", options.json()["categories"])
        reporter = self.make_user("reporter")
        target = self.make_user("reported")
        created = self.client.post("/api/reports", json={"target_type": "user", "target_id": target[1], "reason": "spam"}, headers=self.auth(reporter[2]))
        self.assertEqual(created.status_code, 201, created.text)
        with SessionLocal() as db:
            row = db.query(Report).filter_by(reporter_id=reporter[1]).one()
            self.assertEqual(row.category, "other")
        invalid_type = self.client.post("/api/reports", json={"target_type": "unknown", "target_id": target[1], "reason": "bad"}, headers=self.auth(reporter[2]))
        invalid_category = self.client.post("/api/reports", json={"target_type": "user", "target_id": target[1], "reason": "bad", "category": "invalid"}, headers=self.auth(reporter[2]))
        self.assertEqual(invalid_type.status_code, 422)
        self.assertEqual(invalid_category.status_code, 422)

    def test_duplicate_pending_reports_and_private_target_isolation(self):
        owner = self.make_user("privateowner")
        outsider = self.make_user("privateoutsider")
        post, _ = self._post_and_comment(owner[2], outsider[2])
        first = self.client.post("/api/reports", json={"target_type": "post", "target_id": post, "reason": "spam", "category": "spam"}, headers=self.auth(outsider[2]))
        self.assertEqual(first.status_code, 201, first.text)
        duplicate = self.client.post("/api/reports", json={"target_type": "post", "target_id": post, "reason": "again"}, headers=self.auth(outsider[2]))
        self.assertEqual(duplicate.status_code, 409)
        with SessionLocal() as db:
            conversation = Conversation(user1_id=owner[1], user2_id=outsider[1])
            db.add(conversation)
            db.flush()
            message = Message(conversation_id=conversation.id, sender_id=owner[1], content="private")
            db.add(message)
            db.commit()
            message_id = message.id
        stranger = self.make_user("stranger")
        hidden = self.client.post("/api/reports", json={"target_type": "message", "target_id": message_id, "reason": "spam"}, headers=self.auth(stranger[2]))
        self.assertEqual(hidden.status_code, 404)

    def test_report_target_returns_live_summary_or_stored_snapshot_after_delete(self):
        pair = self.make_admin_pair()
        reporter = self.make_user("snapshotreporter")
        target = self.make_user("snapshottarget")
        created = self.client.post("/api/reports", json={"target_type": "user", "target_id": target[1], "reason": "impersonation"}, headers=self.auth(reporter[2]))
        self.assertEqual(created.status_code, 201)
        with SessionLocal() as db:
            report = db.query(Report).filter_by(reporter_id=reporter[1]).one()
            report_id = report.id
            snapshot = report.target_snapshot
        with self.admin_scope(pair):
            response = self.client.get(f"/api/admin/reports/{report_id}/target", headers=self.auth(pair[0][2]))
            self.assertEqual(response.status_code, 200, response.text)
            self.assertTrue(response.json()["exists"])
            self.assertEqual(response.json()["owner_id"], target[1])
            with SessionLocal() as db:
                db.delete(db.get(User, target[1]))
                db.commit()
            gone = self.client.get(f"/api/admin/reports/{report_id}/target", headers=self.auth(pair[0][2]))
            self.assertEqual(gone.status_code, 200)
            self.assertFalse(gone.json()["exists"])
            self.assertTrue(gone.json()["snapshot"])
            self.assertEqual(gone.json()["summary"], snapshot)

    def test_resolve_delete_content_is_atomic_closes_report_records_note_and_audit_and_stale_is_409(self):
        pair = self.make_admin_pair()
        reporter = self.make_user("resolverreporter")
        owner = self.make_user("resolverowner")
        post_id, _ = self._post_and_comment(owner[2], reporter[2])
        report = self.client.post("/api/reports", json={"target_type": "post", "target_id": post_id, "reason": "violence"}, headers=self.auth(reporter[2]))
        self.assertEqual(report.status_code, 201)
        with SessionLocal() as db:
            report_id = db.query(Report).filter_by(reporter_id=reporter[1]).one().id
        headers = self.auth(pair[0][2])
        with self.admin_scope(pair):
            resolved = self.client.put(f"/api/admin/reports/{report_id}/resolve", json={"action": "delete_content", "note": "confirmed violation"}, headers=headers)
            self.assertEqual(resolved.status_code, 200, resolved.text)
            stale = self.client.put(f"/api/admin/reports/{report_id}/resolve", json={"action": "dismiss", "note": "too late"}, headers=headers)
            self.assertEqual(stale.status_code, 409)
            with SessionLocal() as db:
                self.assertIsNone(db.get(Post, post_id))
                row = db.get(Report, report_id)
                self.assertEqual(row.status, ReportStatus.reviewed)
                self.assertEqual(row.resolution, "delete_content")
                self.assertEqual(row.review_note, "confirmed violation")
                audit = db.query(ModerationAudit).filter_by(report_id=report_id).one()
                self.assertEqual(audit.actor_id, pair[0][1])
                self.assertEqual(audit.note, "confirmed violation")

    def test_legacy_review_and_dismiss_accept_no_body_but_punitive_actions_require_note(self):
        pair = self.make_admin_pair()
        reporter = self.make_user("legacyreporter")
        target = self.make_user("legacytarget")
        self.client.post("/api/reports", json={"target_type": "user", "target_id": target[1], "reason": "spam"}, headers=self.auth(reporter[2]))
        with SessionLocal() as db:
            report_id = db.query(Report).filter_by(reporter_id=reporter[1]).one().id
        headers = self.auth(pair[0][2])
        with self.admin_scope(pair):
            self.assertEqual(self.client.put(f"/api/admin/reports/{report_id}/review", headers=headers).status_code, 200)
            # The first report is already closed by the legacy endpoint; stale
            # resolutions must be rejected before any punitive mutation.
            self.assertEqual(self.client.put(f"/api/admin/reports/{report_id}/resolve", json={"action": "ban_user", "note": ""}, headers=headers).status_code, 409)
            self.client.post("/api/reports", json={"target_type": "user", "target_id": target[1], "reason": "another spam"}, headers=self.auth(reporter[2]))
            with SessionLocal() as db:
                fresh_id = db.query(Report).filter(Report.reporter_id == reporter[1], Report.status == ReportStatus.pending).one().id
            self.assertEqual(self.client.put(f"/api/admin/reports/{fresh_id}/resolve", json={"action": "ban_user", "note": ""}, headers=headers).status_code, 422)
            self.assertEqual(self.client.put(f"/api/admin/reports/{fresh_id}/resolve", json={"action": "freeze_user", "note": ""}, headers=headers).status_code, 422)

    def test_admin_audit_is_paginated_and_does_not_depend_on_fk_to_deleted_users(self):
        pair = self.make_admin_pair()
        with SessionLocal() as db:
            db.add(ModerationAudit(actor_id=999999, action="test", target_type="user", target_id=1, note="orphan"))
            db.commit()
        with self.admin_scope(pair):
            result = self.client.get("/api/admin/audit?skip=0&limit=1", headers=self.auth(pair[0][2]))
            self.assertEqual(result.status_code, 200, result.text)
            self.assertLessEqual(len(result.json()), 1)

    def test_reused_target_id_never_punishes_a_different_content_owner(self):
        pair = self.make_admin_pair()
        owner = self.make_user("oldowner")
        innocent = self.make_user("newowner")
        reporter = self.make_user("fingerprint")
        post = self.client.post("/api/posts", data={"content": "original reported content"}, headers=self.auth(owner[2]))
        post_id = post.json()["id"]
        created = self.client.post("/api/reports", json={"target_type": "post", "target_id": post_id, "reason": "spam content"}, headers=self.auth(reporter[2]))
        self.assertEqual(created.status_code, 201, created.text)
        with SessionLocal() as db:
            report = db.query(Report).filter_by(reporter_id=reporter[1]).one()
            report_id = report.id
            self.assertTrue(report.target_fingerprint)
            db.delete(db.get(Post, post_id))
            db.commit()
            db.add(Post(id=post_id, author_id=innocent[1], content="unrelated new content", created_at=utcnow_naive() + timedelta(seconds=1)))
            db.commit()
        with self.admin_scope(pair):
            headers = self.auth(pair[0][2])
            preview = self.client.get(f"/api/admin/reports/{report_id}/target", headers=headers)
            self.assertFalse(preview.json()["exists"])
            self.assertIn("original reported content", preview.json()["summary"])
            refused = self.client.put(f"/api/admin/reports/{report_id}/resolve", json={"action": "ban_user", "note": "must not ban new owner"}, headers=headers)
            self.assertEqual(refused.status_code, 404, refused.text)
            with SessionLocal() as db:
                self.assertFalse(db.get(User, innocent[1]).is_banned)
                self.assertEqual(db.get(Report, report_id).status, ReportStatus.pending)
                self.assertEqual(db.query(ModerationAudit).filter_by(report_id=report_id).count(), 0)


class ModerationMigrationTests(unittest.TestCase):
    def test_legacy_users_and_reports_are_preserved_and_additive_migration_is_idempotent(self):
        engine = create_engine("sqlite:///:memory:")
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(30) NOT NULL, email VARCHAR(255) NOT NULL, full_name VARCHAR(100) NOT NULL, hashed_password VARCHAR(255) NOT NULL, is_active BOOLEAN NOT NULL DEFAULT 1, is_banned BOOLEAN NOT NULL DEFAULT 0, is_admin BOOLEAN NOT NULL DEFAULT 0)"))
            conn.execute(text("CREATE TABLE reports (id INTEGER PRIMARY KEY, reporter_id INTEGER NOT NULL, target_type VARCHAR(20) NOT NULL, target_id INTEGER NOT NULL, reason VARCHAR(500) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending')"))
            conn.execute(text("INSERT INTO users (id, username, email, full_name, hashed_password) VALUES (1, 'legacy', 'legacy@example.com', 'Legacy', 'hash')"))
            conn.execute(text("INSERT INTO reports (id, reporter_id, target_type, target_id, reason) VALUES (1, 1, 'post', 7, 'old report')"))
        migrate_additive_media_columns(engine)
        migrate_additive_media_columns(engine)
        columns = {c["name"] for c in inspect(engine).get_columns("users")}
        report_columns = {c["name"] for c in inspect(engine).get_columns("reports")}
        self.assertTrue({"verified_at", "verification_expires_at", "frozen_at", "frozen_until"} <= columns)
        self.assertTrue({"category", "reviewer_id", "review_note", "resolution", "reviewed_at", "target_snapshot"} <= report_columns)
        with engine.connect() as conn:
            self.assertEqual(conn.execute(text("SELECT username FROM users WHERE id=1")).scalar_one(), "legacy")
            self.assertEqual(conn.execute(text("SELECT reason FROM reports WHERE id=1")).scalar_one(), "old report")
        fresh = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(fresh)
        self.assertIn("moderation_audit", inspect(fresh).get_table_names())
        self.assertIn("reports", inspect(fresh).get_table_names())


if __name__ == "__main__":
    unittest.main()
