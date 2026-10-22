"""اختبارات تكامل محلية غير متصلة بالخدمة المستضافة."""
import io
import json
import os
import tempfile
import unittest
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from io import BytesIO
from unittest.mock import MagicMock, patch

_TEST_TMP = tempfile.TemporaryDirectory(prefix="ytrana-tests-")
_TEST_ROOT = Path(_TEST_TMP.name)
os.environ["SECRET_KEY"] = "local-test-secret-key-not-for-production-123456"
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_ROOT / 'test.db'}"
os.environ["UPLOAD_DIR"] = str(_TEST_ROOT / "uploads")
os.environ["CORS_ORIGINS"] = "http://testserver"

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402
from sqlalchemy import create_engine, inspect, text  # noqa: E402

from main import app  # noqa: E402
from config import settings  # noqa: E402
from database.db import SessionLocal  # noqa: E402
from database.migrations import migrate_additive_media_columns  # noqa: E402
from models.models import User, Post, Comment, Follower, Message, MoodStatus, Story, Reel, Circle, BusinessPage, BusinessProduct  # noqa: E402
from services.otp_service import (  # noqa: E402
    decrypt_totp_secret, email_delivery_ready, send_email_code, sms_delivery_ready,
    start_sms_verification, totp_code, verify_sms_code,
)
from utils.security import create_access_token  # noqa: E402
from wsgi import application as wsgi_application  # noqa: E402


class YtranaApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

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

    @staticmethod
    def auth(token):
        return {"Authorization": f"Bearer {token}"}

    def test_moods_are_seeded_and_admin_flag_is_private_but_available_to_me(self):
        response = self.client.get("/api/moods")
        self.assertEqual(response.status_code, 200)
        self.assertEqual({m["key"] for m in response.json()}, {"happy", "sad", "calm", "energetic", "focused"})

        token, user = self.register("mooduser")
        allowlist_patch = patch.object(settings, "admin_user_ids", f"{user['id']},2147483647")
        allowlist_patch.start()
        self.addCleanup(allowlist_patch.stop)
        self.assertNotIn("is_admin", user)
        me = self.client.get("/api/auth/me", headers=self.auth(token))
        self.assertEqual(me.status_code, 200)
        self.assertFalse(me.json()["is_admin"])
        profile = self.client.get("/api/users/mooduser")
        self.assertNotIn("is_admin", profile.json())
        self.assertNotIn("is_banned", profile.json())

        with SessionLocal() as db:
            account = db.query(User).filter_by(username="mooduser").one()
            account.is_admin = True
            db.commit()
        me = self.client.get("/api/auth/me", headers=self.auth(token))
        self.assertTrue(me.json()["is_admin"])
        self.assertEqual(self.client.get("/api/admin/users", headers=self.auth(token)).status_code, 200)

        status = self.client.post("/api/moods", json={"mood_key": "happy", "note": "يوم جميل"}, headers=self.auth(token))
        self.assertEqual(status.status_code, 201, status.text)
        self.assertEqual(self.client.get("/api/moods/me", headers=self.auth(token)).json()["mood"]["key"], "happy")
        self.assertEqual(self.client.get("/api/moods/me", headers=self.auth(token)).json()["note"], "يوم جميل")

        follower_token, _ = self.register("moodfollower")
        self.assertEqual(self.client.post("/api/users/mooduser/follow", headers=self.auth(follower_token)).status_code, 200)
        visible = self.client.get("/api/moods/feed", headers=self.auth(follower_token))
        self.assertEqual(visible.status_code, 200, visible.text)
        self.assertTrue(any(row["user"]["username"] == "mooduser" and row["note"] == "يوم جميل" for row in visible.json()))

        stranger_token, _ = self.register("moodstranger")
        hidden = self.client.get("/api/moods/feed", headers=self.auth(stranger_token))
        self.assertFalse(any(row["user"]["username"] == "mooduser" for row in hidden.json()))

    def test_social_and_messaging_flows_persist(self):
        alice_token, _ = self.register("alice")
        bob_token, _ = self.register("bob")

        follow = self.client.post("/api/users/bob/follow", headers=self.auth(alice_token))
        self.assertEqual(follow.status_code, 200, follow.text)
        self.assertEqual(self.client.get("/api/notifications/unread-count", headers=self.auth(bob_token)).json()["unread_count"], 1)

        post = self.client.post("/api/posts", data={"content": "أول منشور"}, headers=self.auth(alice_token))
        self.assertEqual(post.status_code, 201, post.text)
        post_id = post.json()["id"]
        comment = self.client.post(f"/api/posts/{post_id}/comments", json={"content": "تعليق"}, headers=self.auth(bob_token))
        self.assertEqual(comment.status_code, 201, comment.text)
        like = self.client.post(f"/api/posts/{post_id}/like", headers=self.auth(bob_token))
        self.assertEqual(like.status_code, 200, like.text)

        sent = self.client.post("/api/messages/bob", json={"content": "مرحبًا"}, headers=self.auth(alice_token))
        self.assertEqual(sent.status_code, 201, sent.text)
        inbox = self.client.get("/api/messages/alice", headers=self.auth(bob_token))
        self.assertEqual(inbox.status_code, 200, inbox.text)
        self.assertEqual(inbox.json()[0]["content"], "مرحبًا")
        self.assertTrue(inbox.json()[0]["is_read"])

        feed = self.client.get("/api/posts/feed", headers=self.auth(alice_token))
        self.assertEqual(feed.status_code, 200)
        self.assertEqual(feed.json()[0]["id"], post_id)

    def test_follow_lists_are_api_backed_and_paginated(self):
        owner_token, _ = self.register("listowner")
        first_token, first = self.register("listfirst")
        second_token, second = self.register("listsecond")
        third_token, third = self.register("listthird")
        for token in (first_token, second_token, third_token):
            self.assertEqual(
                self.client.post("/api/users/listowner/follow", headers=self.auth(token)).status_code,
                200,
            )

        first_page = self.client.get("/api/users/listowner/followers?skip=0&limit=2")
        self.assertEqual(first_page.status_code, 200, first_page.text)
        self.assertEqual([row["username"] for row in first_page.json()], ["listfirst", "listsecond"])
        second_page = self.client.get("/api/users/listowner/followers?skip=2&limit=2")
        self.assertEqual([row["username"] for row in second_page.json()], ["listthird"])

        self.assertEqual(self.client.post("/api/users/listfirst/follow", headers=self.auth(owner_token)).status_code, 200)
        following = self.client.get("/api/users/listowner/following?skip=0&limit=20")
        self.assertEqual(following.status_code, 200, following.text)
        self.assertEqual([row["username"] for row in following.json()], ["listfirst"])
        self.assertNotIn("is_admin", following.json()[0])

    def test_notifications_can_be_marked_read_and_are_private_to_recipient(self):
        first_token, _ = self.register("notiffirst")
        second_token, _ = self.register("notifsecond")
        recipient_token, _ = self.register("notifowner")
        self.assertEqual(self.client.post("/api/users/notifowner/follow", headers=self.auth(first_token)).status_code, 200)
        self.assertEqual(self.client.post("/api/users/notifowner/follow", headers=self.auth(second_token)).status_code, 200)

        rows = self.client.get("/api/notifications", headers=self.auth(recipient_token)).json()
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(not row["is_read"] for row in rows))
        notification_id = rows[0]["id"]
        self.assertEqual(self.client.put(f"/api/notifications/{notification_id}/read", headers=self.auth(recipient_token)).status_code, 200)
        self.assertEqual(self.client.get("/api/notifications/unread-count", headers=self.auth(recipient_token)).json()["unread_count"], 1)
        self.assertEqual(self.client.put("/api/notifications/read-all", headers=self.auth(recipient_token)).status_code, 200)
        self.assertEqual(self.client.get("/api/notifications/unread-count", headers=self.auth(recipient_token)).json()["unread_count"], 0)
        self.assertEqual(self.client.put(f"/api/notifications/{rows[1]['id']}/read", headers=self.auth(first_token)).status_code, 404)

    def test_user_search_orders_exact_and_prefix_matches_and_hides_inactive_accounts(self):
        self.register("searchneedle")
        self.register("searchneedle_early")
        self.register("searchneedle_offline")
        self.register("searchneedle_blocked")
        with SessionLocal() as db:
            db.query(User).filter_by(username="searchneedle_offline").one().is_active = False
            db.query(User).filter_by(username="searchneedle_blocked").one().is_banned = True
            db.commit()

        response = self.client.get("/api/users/search?q=%40SEARCHNEEDLE&limit=10")
        self.assertEqual(response.status_code, 200, response.text)
        names = [row["username"] for row in response.json()]
        self.assertEqual(names[:2], ["searchneedle", "searchneedle_early"])
        self.assertNotIn("searchneedle_offline", names)
        self.assertNotIn("searchneedle_blocked", names)
        page = self.client.get("/api/users/search?q=searchneedle&skip=1&limit=1")
        self.assertEqual([row["username"] for row in page.json()], ["searchneedle_early"])
        self.assertEqual(self.client.get("/api/users/search?q=%25").json(), [])

    def test_image_upload_checks_real_format_and_deletes_with_account(self):
        token, _ = self.register("imageuser")
        stream = io.BytesIO()
        Image.new("RGB", (8, 8), color="red").save(stream, format="JPEG")
        good = self.client.post(
            "/api/users/me/avatar", headers=self.auth(token),
            files={"file": ("avatar.jpg", stream.getvalue(), "image/jpeg")},
        )
        self.assertEqual(good.status_code, 200, good.text)
        avatar_url = good.json()["avatar_url"]
        saved_avatar = _TEST_ROOT / "uploads" / avatar_url.removeprefix("/uploads/")
        self.assertTrue(saved_avatar.is_file())

        fake = self.client.post(
            "/api/users/me/avatar", headers=self.auth(token),
            files={"file": ("fake.png", b"not actually an image", "image/png")},
        )
        self.assertEqual(fake.status_code, 400)

        post = self.client.post("/api/posts", data={"content": "صورة"}, headers=self.auth(token))
        self.assertEqual(post.status_code, 201)
        post_id = post.json()["id"]
        story_response = self.client.post(
            "/api/stories", headers=self.auth(token), data={"caption": "قصة الحساب"},
            files={"image": ("story.jpg", stream.getvalue(), "image/jpeg")},
        )
        self.assertEqual(story_response.status_code, 201, story_response.text)
        story_file = _TEST_ROOT / "uploads" / story_response.json()["image_url"].removeprefix("/uploads/")
        reel_fixture = (Path(__file__).parent / "fixtures" / "reel-smoke.mp4").read_bytes()
        reel_response = self.client.post(
            "/api/reels", headers=self.auth(token), data={"caption": "ريل الحساب"},
            files={"video": ("reel.mp4", reel_fixture, "video/mp4")},
        )
        self.assertEqual(reel_response.status_code, 201, reel_response.text)
        reel_file = _TEST_ROOT / "uploads" / reel_response.json()["video_url"].removeprefix("/uploads/")
        friend_token, _ = self.register("imagefriend")
        self.assertEqual(self.client.post("/api/users/imageuser/follow", headers=self.auth(friend_token)).status_code, 200)
        self.assertEqual(self.client.post(
            f"/api/posts/{post_id}/comments", json={"content": "تعليق تابع"}, headers=self.auth(friend_token)
        ).status_code, 201)
        self.assertEqual(self.client.post(
            "/api/messages/imageuser", json={"content": "رسالة تابعة"}, headers=self.auth(friend_token)
        ).status_code, 201)
        owned_media = {
            "circle_image": _TEST_ROOT / "uploads" / "circles" / "account-circle.jpg",
            "circle_cover": _TEST_ROOT / "uploads" / "circles" / "account-circle-cover.jpg",
            "business_page": _TEST_ROOT / "uploads" / "business" / "account-business.jpg",
            "business_cover": _TEST_ROOT / "uploads" / "business" / "account-business-cover.jpg",
            "business_product": _TEST_ROOT / "uploads" / "business" / "account-product.jpg",
        }
        for media_path in owned_media.values():
            media_path.parent.mkdir(parents=True, exist_ok=True)
            media_path.write_bytes(b"test-media")
        with SessionLocal() as db:
            owner = db.query(User).filter_by(username="imageuser").one()
            db.add(Circle(
                name="دائرة الحساب", creator_id=owner.id,
                image_url="/uploads/circles/account-circle.jpg",
                cover_url="/uploads/circles/account-circle-cover.jpg",
            ))
            business_page = BusinessPage(
                owner_id=owner.id, name="صفحة الحساب",
                image_url="/uploads/business/account-business.jpg",
                cover_url="/uploads/business/account-business-cover.jpg",
            )
            db.add(business_page)
            db.flush()
            db.add(BusinessProduct(
                page_id=business_page.id, name="منتج الحساب",
                image_url="/uploads/business/account-product.jpg",
            ))
            db.commit()
        with SessionLocal() as db:
            deleted_user_id = db.query(User).filter_by(username="imageuser").one().id
        deleted = self.client.request("DELETE", "/api/users/me", json={"password": "Password123"}, headers=self.auth(token))
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertFalse(saved_avatar.exists())
        self.assertFalse(story_file.exists())
        self.assertFalse(reel_file.exists())
        for media_path in owned_media.values():
            self.assertFalse(media_path.exists(), f"account-owned media left behind: {media_path}")
        with SessionLocal() as db:
            self.assertIsNone(db.query(User).filter_by(username="imageuser").first())
            self.assertIsNone(db.query(Post).filter_by(id=post_id).first())
            self.assertEqual(db.query(Comment).filter(Comment.post_id == post_id).count(), 0)
            self.assertEqual(db.query(Follower).filter(Follower.following_id == deleted_user_id).count(), 0)
            self.assertEqual(db.query(Message).count(), 0)
            self.assertEqual(db.query(Story).filter(Story.author_id == deleted_user_id).count(), 0)
            self.assertEqual(db.query(Reel).filter(Reel.author_id == deleted_user_id).count(), 0)

    def test_privacy_and_account_deletion_pages_are_public_and_use_approved_support_email(self):
        response = self.client.get("/privacy.html")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("سياسة الخصوصية", response.text)
        self.assertIn('href="mailto:300asq@gmail.com"', response.text)
        self.assertIn('href="account-deletion.html"', response.text)
        self.assertNotIn("[أضف بريد دعم عام قبل النشر]", response.text)

        deletion = self.client.get("/account-deletion.html")
        self.assertEqual(deletion.status_code, 200, deletion.text)
        self.assertIn("حذف حساب Ytrana", deletion.text)
        self.assertIn('href="settings.html"', deletion.text)
        self.assertIn('href="mailto:300asq@gmail.com"', deletion.text)

    def test_invalid_signed_subject_returns_401_and_negative_limit_is_bounded(self):
        token = create_access_token({"sub": "not-an-integer"})
        self.assertEqual(self.client.get("/api/auth/me", headers=self.auth(token)).status_code, 401)
        self.assertEqual(self.client.get("/api/posts/explore?limit=-1").status_code, 200)

    def test_password_length_is_limited_to_bcrypt_capacity(self):
        response = self.client.post("/api/auth/register", json={
            "username": "longpassword",
            "email": "long@example.com",
            "full_name": "Long Password",
            "password": "A1" + "x" * 71,
        })
        self.assertEqual(response.status_code, 422)

    def test_email_otp_enrollment_and_login_challenge_are_one_time(self):
        token, _ = self.register("emailotp")
        with patch("routes.auth.email_delivery_ready", return_value=True), patch("routes.auth.deliver_otp") as deliver:
            started = self.client.post("/api/auth/mfa/email/start", json={}, headers=self.auth(token))
            self.assertEqual(started.status_code, 200, started.text)
            setup_code = deliver.call_args.args[2]
            self.assertEqual(self.client.post("/api/auth/mfa/email/confirm", json={
                "challenge_id": started.json()["challenge_id"], "code": setup_code,
            }, headers=self.auth(token)).status_code, 200)

            login = self.client.post("/api/auth/login", json={
                "username_or_email": "emailotp", "password": "Password123",
            })
            self.assertEqual(login.status_code, 200, login.text)
            challenge = login.json()
            self.assertTrue(challenge["requires_otp"])
            self.assertEqual(challenge["available_methods"], ["email"])
            self.assertIsNone(challenge["access_token"])

            send = self.client.post("/api/auth/login/otp/start", json={
                "challenge_id": challenge["challenge_id"], "method": "email",
            })
            self.assertEqual(send.status_code, 200, send.text)
            login_code = deliver.call_args.args[2]
            verified = self.client.post("/api/auth/login/otp/verify", json={
                "challenge_id": challenge["challenge_id"], "code": login_code,
            })
            self.assertEqual(verified.status_code, 200, verified.text)
            self.assertTrue(verified.json()["access_token"])
            replay = self.client.post("/api/auth/login/otp/verify", json={
                "challenge_id": challenge["challenge_id"], "code": login_code,
            })
            self.assertEqual(replay.status_code, 400)

    def test_sms_otp_verifies_phone_before_enabling_sms_factor(self):
        token, _ = self.register("smsotp")
        phone = "+9647701234567"
        with patch("routes.auth.sms_delivery_ready", return_value=True), \
                patch("routes.auth.deliver_otp") as deliver, \
                patch("routes.auth.verify_sms_code", return_value=True) as verify:
            started = self.client.post("/api/auth/mfa/sms/start", json={
                "phone_number": phone,
            }, headers=self.auth(token))
            self.assertEqual(started.status_code, 200, started.text)
            deliver.assert_called_once_with("sms", phone, None)
            confirmed = self.client.post("/api/auth/mfa/sms/confirm", json={
                "challenge_id": started.json()["challenge_id"], "code": "123456",
            }, headers=self.auth(token))
            self.assertEqual(confirmed.status_code, 200, confirmed.text)
            verify.assert_called_once_with(phone, "123456")
            status_response = self.client.get("/api/auth/mfa", headers=self.auth(token))
            self.assertTrue(status_response.json()["sms_enabled"])
            self.assertTrue(status_response.json()["phone_verified"])
            login = self.client.post("/api/auth/login", json={
                "username_or_email": "smsotp", "password": "Password123",
            })
            challenge = login.json()
            self.assertEqual(challenge["available_methods"], ["sms"])
            started_login = self.client.post("/api/auth/login/otp/start", json={
                "challenge_id": challenge["challenge_id"], "method": "sms",
            })
            self.assertEqual(started_login.status_code, 200, started_login.text)
            verify.reset_mock()
            completed_login = self.client.post("/api/auth/login/otp/verify", json={
                "challenge_id": challenge["challenge_id"], "code": "654321",
            })
            self.assertEqual(completed_login.status_code, 200, completed_login.text)
            self.assertTrue(completed_login.json()["access_token"])
            verify.assert_called_once_with(phone, "654321")

    def test_twilio_verify_adapter_uses_v2_endpoints_with_mocked_responses(self):
        send_response = MagicMock()
        send_response.__enter__.return_value = send_response
        send_response.status = 201
        send_response.read.return_value = b'{"status":"pending"}'
        check_response = MagicMock()
        check_response.__enter__.return_value = check_response
        check_response.status = 200
        check_response.read.return_value = b'{"status":"approved","valid":true}'
        service_sid = "VA" + "1" * 32
        phone = "+9647701234567"
        with patch("services.otp_service.settings.twilio_account_sid", "AC" + "2" * 32), \
                patch("services.otp_service.settings.twilio_auth_token", "test-auth-token"), \
                patch("services.otp_service.settings.twilio_verify_service_sid", service_sid), \
                patch("services.otp_service.urlopen", side_effect=[send_response, check_response]) as request_call:
            start_sms_verification(phone)
            self.assertTrue(verify_sms_code(phone, "123456"))

        requests = [call.args[0] for call in request_call.call_args_list]
        self.assertEqual(requests[0].full_url, f"https://verify.twilio.com/v2/Services/{service_sid}/Verifications")
        self.assertEqual(requests[0].data, b"To=%2B9647701234567&Channel=sms")
        self.assertEqual(requests[1].full_url, f"https://verify.twilio.com/v2/Services/{service_sid}/VerificationCheck")
        self.assertEqual(requests[1].data, b"To=%2B9647701234567&Code=123456")
        self.assertTrue(requests[0].get_header("Authorization").startswith("Basic "))

    def test_brevo_email_adapter_uses_transactional_email_api_without_live_sending(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.status = 201
        response.read.return_value = b'{"messageId":"mocked"}'
        with patch("services.otp_service.settings.brevo_api_key", "test-brevo-key"), \
                patch("services.otp_service.settings.brevo_sender_email", "verified@example.com"), \
                patch("services.otp_service.settings.brevo_sender_name", "Ytrana"), \
                patch("services.otp_service.urlopen", return_value=response) as request_call:
            send_email_code("recipient@example.com", "123456")

        request = request_call.call_args.args[0]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(request.full_url, "https://api.brevo.com/v3/smtp/email")
        self.assertEqual(request.get_header("Api-key"), "test-brevo-key")
        self.assertEqual(payload["sender"], {"email": "verified@example.com", "name": "Ytrana"})
        self.assertEqual(payload["to"], [{"email": "recipient@example.com"}])
        self.assertIn("123456", payload["textContent"])

    def test_email_and_sms_stay_disabled_without_provider_settings(self):
        with patch("services.otp_service.settings.brevo_api_key", ""), \
                patch("services.otp_service.settings.brevo_sender_email", ""), \
                patch("services.otp_service.settings.twilio_account_sid", ""), \
                patch("services.otp_service.settings.twilio_auth_token", ""), \
                patch("services.otp_service.settings.twilio_verify_service_sid", ""):
            self.assertFalse(email_delivery_ready())
            self.assertFalse(sms_delivery_ready())

    def test_totp_secret_is_encrypted_and_replayed_codes_are_rejected(self):
        token, _ = self.register("totpuser")
        setup = self.client.post("/api/auth/mfa/totp/setup", json={}, headers=self.auth(token))
        self.assertEqual(setup.status_code, 200, setup.text)
        secret = setup.json()["secret"]
        with SessionLocal() as db:
            account = db.query(User).filter_by(username="totpuser").one()
            self.assertNotEqual(account.pending_totp_secret, secret)
            self.assertEqual(decrypt_totp_secret(account.pending_totp_secret), secret)

        confirm = self.client.post("/api/auth/mfa/totp/confirm", json={
            "code": totp_code(secret),
        }, headers=self.auth(token))
        self.assertEqual(confirm.status_code, 200, confirm.text)
        login = self.client.post("/api/auth/login", json={
            "username_or_email": "totpuser", "password": "Password123",
        })
        challenge_id = login.json()["challenge_id"]
        start = self.client.post("/api/auth/login/otp/start", json={
            "challenge_id": challenge_id, "method": "totp",
        })
        self.assertEqual(start.status_code, 200, start.text)
        with SessionLocal() as db:
            account = db.query(User).filter_by(username="totpuser").one()
            last_step = account.totp_last_step
        new_step = max(int(time.time()) // 30, (last_step or -1) + 1)
        code = totp_code(secret, new_step)
        verified = self.client.post("/api/auth/login/otp/verify", json={
            "challenge_id": challenge_id, "code": code,
        })
        self.assertEqual(verified.status_code, 200, verified.text)
        replay_login = self.client.post("/api/auth/login", json={
            "username_or_email": "totpuser", "password": "Password123",
        }).json()
        self.client.post("/api/auth/login/otp/start", json={
            "challenge_id": replay_login["challenge_id"], "method": "totp",
        })
        replay = self.client.post("/api/auth/login/otp/verify", json={
            "challenge_id": replay_login["challenge_id"], "code": code,
        })
        self.assertIn(replay.status_code, (400, 429))

    def test_private_circle_membership_and_post_access_are_enforced(self):
        owner_token, _ = self.register("circleowner")
        member_token, _ = self.register("circlemember")
        outsider_token, _ = self.register("circleoutsider")
        created = self.client.post("/api/circles", data={
            "name": "دائرة خاصة", "description": "مجتمع باهتمامات مشتركة", "is_private": "true",
        }, headers=self.auth(owner_token))
        self.assertEqual(created.status_code, 200, created.text)
        circle_id = created.json()["id"]
        self.assertNotIn("hashed_password", created.text)
        self.assertEqual(self.client.get(f"/api/circles/{circle_id}", headers=self.auth(outsider_token)).status_code, 404)
        self.assertEqual(self.client.get("/api/circles").json(), [])

        join = self.client.post(f"/api/circles/{circle_id}/join", headers=self.auth(member_token))
        self.assertEqual(join.json()["membership_status"], "pending")
        self.assertEqual(self.client.get(f"/api/circles/{circle_id}/posts", headers=self.auth(member_token)).status_code, 404)
        pending = self.client.get(f"/api/circles/{circle_id}/members?status_filter=pending", headers=self.auth(owner_token))
        self.assertEqual(pending.status_code, 200, pending.text)
        self.assertNotIn("hashed_password", pending.text)
        member_id = pending.json()[0]["user"]["id"]
        approve = self.client.post(f"/api/circles/{circle_id}/members/{member_id}/approve", headers=self.auth(owner_token))
        self.assertEqual(approve.status_code, 200, approve.text)

        post = self.client.post("/api/posts", data={"content": "منشور دائرة", "circle_id": str(circle_id)}, headers=self.auth(member_token))
        self.assertEqual(post.status_code, 201, post.text)
        post_id = post.json()["id"]
        self.assertEqual(post.json()["circle_id"], circle_id)
        self.assertEqual(self.client.get(f"/api/posts/{post_id}", headers=self.auth(outsider_token)).status_code, 404)
        self.assertEqual(self.client.post(f"/api/posts/{post_id}/like", headers=self.auth(outsider_token)).status_code, 404)
        self.assertEqual(self.client.get(f"/api/posts/{post_id}/comments").status_code, 404)
        self.assertEqual(self.client.get(f"/api/posts/{post_id}", headers=self.auth(member_token)).status_code, 200)
        self.assertEqual(self.client.put(f"/api/circles/{circle_id}/pin/{post_id}", headers=self.auth(owner_token)).status_code, 200)
        self.assertEqual(self.client.get(f"/api/circles/{circle_id}", headers=self.auth(owner_token)).json()["pinned_post_id"], post_id)

    def test_private_circle_media_is_not_served_from_public_upload_paths(self):
        owner_token, _ = self.register("mediacircleowner")
        member_token, _ = self.register("mediacirclemember")
        outsider_token, _ = self.register("mediacircleoutsider")
        image = BytesIO()
        Image.new("RGB", (5, 5), color=(210, 30, 80)).save(image, format="PNG")
        png_bytes = image.getvalue()

        circle_response = self.client.post("/api/circles", data={
            "name": "دائرة صور خاصة", "description": "اختبار حماية الوسائط", "is_private": "true",
        }, files={"image": ("circle.png", png_bytes, "image/png")}, headers=self.auth(owner_token))
        self.assertEqual(circle_response.status_code, 200, circle_response.text)
        circle_id = circle_response.json()["id"]
        self.assertTrue(circle_response.json()["image_url"].startswith("/api/private-media/"))
        self.assertEqual(self.client.get(circle_response.json()["image_url"]).status_code, 401)
        self.assertEqual(self.client.get(circle_response.json()["image_url"], headers=self.auth(owner_token)).status_code, 200)
        with SessionLocal() as db:
            raw_circle_image = db.query(Circle).filter_by(id=circle_id).one().image_url
        self.assertEqual(self.client.get(raw_circle_image).status_code, 404)

        self.client.post(f"/api/circles/{circle_id}/join", headers=self.auth(member_token))
        member = self.client.get(f"/api/circles/{circle_id}", headers=self.auth(member_token)).json()
        self.assertIsNone(member["image_url"])
        self.assertEqual(self.client.get(f"/api/private-media/circles/{circle_id}/image", headers=self.auth(member_token)).status_code, 404)
        pending = self.client.get(f"/api/circles/{circle_id}/members?status_filter=pending", headers=self.auth(owner_token)).json()[0]
        self.client.post(f"/api/circles/{circle_id}/members/{pending['user']['id']}/approve", headers=self.auth(owner_token))

        post_response = self.client.post("/api/posts", data={
            "content": "صورة داخل الدائرة", "circle_id": str(circle_id),
        }, files={"image": ("private-post.png", png_bytes, "image/png")}, headers=self.auth(member_token))
        self.assertEqual(post_response.status_code, 201, post_response.text)
        post = post_response.json()
        self.assertTrue(post["image_url"].startswith("/api/private-media/posts/"))
        self.assertEqual(self.client.get(post["image_url"], headers=self.auth(member_token)).status_code, 200)
        self.assertEqual(self.client.get(post["image_url"], headers=self.auth(outsider_token)).status_code, 404)
        with SessionLocal() as db:
            raw_post_image = db.query(Post).filter_by(id=post["id"]).one().image_url
        self.assertEqual(self.client.get(raw_post_image).status_code, 404)

    def test_challenges_require_admin_and_accept_one_real_post_per_user(self):
        admin_token, admin_user = self.register("challengeadmin")
        allowlist_patch = patch.object(settings, "admin_user_ids", f"{admin_user['id']},2147483647")
        allowlist_patch.start()
        self.addCleanup(allowlist_patch.stop)
        participant_token, _ = self.register("challengeuser")
        with SessionLocal() as db:
            db.query(User).filter_by(id=admin_user["id"]).one().is_admin = True
            db.commit()
        now = datetime.now(timezone.utc)
        payload = {
            "title": "تحدي القراءة الأسبوعي", "description": "شارك ما قرأت اليوم",
            "starts_at": (now - timedelta(hours=1)).isoformat(),
            "ends_at": (now + timedelta(days=2)).isoformat(),
        }
        self.assertEqual(self.client.post("/api/challenges", json=payload, headers=self.auth(participant_token)).status_code, 403)
        created = self.client.post("/api/challenges", json=payload, headers=self.auth(admin_token))
        self.assertEqual(created.status_code, 200, created.text)
        challenge_id = created.json()["id"]
        self.assertEqual(created.json()["state"], "active")
        submission = self.client.post("/api/posts", data={"content": "أنهيت فصلاً", "challenge_id": str(challenge_id)}, headers=self.auth(participant_token))
        self.assertEqual(submission.status_code, 201, submission.text)
        self.assertEqual(submission.json()["challenge_id"], challenge_id)
        duplicate = self.client.post("/api/posts", data={"content": "مشاركة مكررة", "challenge_id": str(challenge_id)}, headers=self.auth(participant_token))
        self.assertEqual(duplicate.status_code, 409)
        board = self.client.get(f"/api/challenges/{challenge_id}/posts")
        self.assertEqual(board.status_code, 200, board.text)
        self.assertEqual(board.json()[0]["rank"], 1)
        badges = self.client.get("/api/challenges/mine/achievements", headers=self.auth(participant_token))
        self.assertEqual(badges.status_code, 200, badges.text)
        self.assertEqual(badges.json()[0]["challenge"]["id"], challenge_id)
        self.assertNotIn("hashed_password", self.client.get("/api/auth/me", headers=self.auth(admin_token)).text)
        self.assertEqual(self.client.put(f"/api/challenges/{challenge_id}/pause", headers=self.auth(admin_token)).status_code, 200)

    def test_business_page_follow_products_and_posts_use_real_owner_permissions(self):
        owner_token, owner = self.register("businessowner")
        visitor_token, _ = self.register("businessvisitor")
        created = self.client.post("/api/business/pages", data={
            "name": "متجر تجريبي", "description": "خدمات محلية", "contact_phone": "+9647701234567",
        }, headers=self.auth(owner_token))
        self.assertEqual(created.status_code, 200, created.text)
        self.assertNotIn("hashed_password", created.text)
        page_id = created.json()["id"]
        first_view = self.client.get(f"/api/business/pages/{page_id}", headers=self.auth(visitor_token))
        second_view = self.client.get(f"/api/business/pages/{page_id}", headers=self.auth(visitor_token))
        self.assertEqual(first_view.status_code, 200, first_view.text)
        self.assertEqual(second_view.json()["views_count"], 1)
        self.assertEqual(self.client.post(f"/api/business/pages/{page_id}/follow", headers=self.auth(visitor_token)).status_code, 200)

        product = self.client.post(f"/api/business/pages/{page_id}/products", json={
            "name": "خدمة تصميم", "description": "تصميم هوية بسيطة", "price": "25000 د.ع",
        }, headers=self.auth(owner_token))
        self.assertEqual(product.status_code, 200, product.text)
        product_id = product.json()["id"]
        self.assertEqual(self.client.put(f"/api/business/products/{product_id}", json={
            "name": "خدمة معدلة", "description": "تفاصيل جديدة", "price": None,
        }, headers=self.auth(visitor_token)).status_code, 403)

        business_post = self.client.post("/api/posts", data={"content": "إعلان عن الخدمة", "business_id": str(page_id)}, headers=self.auth(owner_token))
        self.assertEqual(business_post.status_code, 201, business_post.text)
        self.assertEqual(business_post.json()["business"]["name"], "متجر تجريبي")
        self.assertEqual(self.client.get("/api/posts/feed", headers=self.auth(visitor_token)).json()[0]["id"], business_post.json()["id"])
        self.assertEqual(self.client.post(f"/api/posts/{business_post.json()['id']}/like", headers=self.auth(visitor_token)).status_code, 200)
        stats = self.client.get(f"/api/business/pages/{page_id}", headers=self.auth(owner_token)).json()
        self.assertEqual(stats["followers_count"], 1)
        self.assertEqual(stats["posts_count"], 1)
        self.assertEqual(stats["likes_count"], 1)

    def test_disabled_user_cannot_sign_in(self):
        self.register("inactive")
        with SessionLocal() as db:
            account = db.query(User).filter_by(username="inactive").one()
            account.is_active = False
            db.commit()
        response = self.client.post("/api/auth/login", json={
            "username_or_email": "inactive", "password": "Password123"
        })
        self.assertEqual(response.status_code, 403)

    def test_story_expiration_and_reel_upload_likes_views_and_permissions(self):
        author_token, author = self.register("storyauthor")
        viewer_token, _ = self.register("storyviewer")
        image = io.BytesIO()
        Image.new("RGB", (12, 12), color="blue").save(image, format="JPEG")
        story_response = self.client.post(
            "/api/stories", headers=self.auth(author_token), data={"caption": "قصة مؤقتة"},
            files={"image": ("story.jpg", image.getvalue(), "image/jpeg")},
        )
        self.assertEqual(story_response.status_code, 201, story_response.text)
        story = story_response.json()
        created = datetime.fromisoformat(story["created_at"])
        expires = datetime.fromisoformat(story["expires_at"])
        self.assertEqual(expires - created, timedelta(hours=24))
        story_file = _TEST_ROOT / "uploads" / story["image_url"].removeprefix("/uploads/")
        self.assertTrue(story_file.is_file())

        self.assertEqual(self.client.post("/api/users/storyauthor/follow", headers=self.auth(viewer_token)).status_code, 200)
        feed = self.client.get("/api/stories/feed", headers=self.auth(viewer_token))
        self.assertEqual(feed.status_code, 200, feed.text)
        self.assertEqual([row["id"] for row in feed.json()], [story["id"]])
        for _ in range(2):
            viewed = self.client.post(f"/api/stories/{story['id']}/view", headers=self.auth(viewer_token))
            self.assertEqual(viewed.status_code, 200, viewed.text)
        self.assertEqual(viewed.json()["views_count"], 1)
        self.assertEqual(self.client.delete(f"/api/stories/{story['id']}", headers=self.auth(viewer_token)).status_code, 403)

        with SessionLocal() as db:
            row = db.query(Story).filter_by(id=story["id"]).one()
            row.expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=1)
            db.commit()
        expired_feed = self.client.get("/api/stories/feed", headers=self.auth(viewer_token))
        self.assertEqual(expired_feed.status_code, 200)
        self.assertEqual(expired_feed.json(), [])
        # Expiry now archives instead of deleting the owner's story and media.
        self.assertTrue(story_file.exists())
        with SessionLocal() as db:
            self.assertTrue(db.query(Story).filter_by(id=story["id"]).one().is_archived)
        archived = self.client.get("/api/account/archive?kind=stories", headers=self.auth(author_token))
        self.assertTrue(any(item["id"] == story["id"] for item in archived.json()))
        self.assertEqual(self.client.get(story["image_url"]).status_code, 404)

        invalid = self.client.post(
            "/api/reels", headers=self.auth(author_token), data={"caption": "غير صالح"},
            files={"video": ("bad.mp4", b"not a video", "video/mp4")},
        )
        self.assertEqual(invalid.status_code, 400)
        fixture = (Path(__file__).parent / "fixtures" / "reel-smoke.mp4").read_bytes()
        created_reel = self.client.post(
            "/api/reels", headers=self.auth(author_token), data={"caption": "ريل تجريبي", "mood_key": "happy"},
            files={"video": ("reel.mp4", fixture, "video/mp4")},
        )
        self.assertEqual(created_reel.status_code, 201, created_reel.text)
        reel = created_reel.json()
        self.assertEqual(reel["mood_key"], "happy")
        video_file = _TEST_ROOT / "uploads" / reel["video_url"].removeprefix("/uploads/")
        self.assertEqual(video_file.read_bytes(), fixture)
        self.assertEqual(self.client.get(reel["video_url"]).status_code, 200)

        for _ in range(2):
            self.assertEqual(self.client.post(f"/api/reels/{reel['id']}/like", headers=self.auth(viewer_token)).status_code, 200)
            viewed_reel = self.client.post(f"/api/reels/{reel['id']}/view", headers=self.auth(viewer_token))
            self.assertEqual(viewed_reel.status_code, 200)
        reel_feed = self.client.get("/api/reels/feed", headers=self.auth(viewer_token))
        self.assertEqual(reel_feed.status_code, 200, reel_feed.text)
        self.assertEqual(reel_feed.json()[0]["likes_count"], 1)
        self.assertEqual(reel_feed.json()[0]["views_count"], 1)
        self.assertTrue(reel_feed.json()[0]["liked_by_me"])
        self.assertEqual(self.client.delete(f"/api/reels/{reel['id']}", headers=self.auth(viewer_token)).status_code, 403)
        self.assertEqual(self.client.delete(f"/api/reels/{reel['id']}", headers=self.auth(author_token)).status_code, 200)
        self.assertFalse(video_file.exists())

    def test_video_posts_and_stories_support_moods_and_clean_up_uploaded_media(self):
        token, _ = self.register("videocreator")
        fixture = (Path(__file__).parent / "fixtures" / "reel-smoke.mp4").read_bytes()
        post_response = self.client.post(
            "/api/posts", headers=self.auth(token), data={"content": "فيديو سعيد", "mood_key": "happy"},
            files={"video": ("post.mp4", fixture, "video/mp4")},
        )
        self.assertEqual(post_response.status_code, 201, post_response.text)
        post = post_response.json()
        self.assertEqual(post["mood_key"], "happy")
        post_file = _TEST_ROOT / "uploads" / post["video_url"].removeprefix("/uploads/")
        self.assertTrue(post_file.is_file())
        self.assertEqual(self.client.get(post["video_url"]).status_code, 200)

        story_response = self.client.post(
            "/api/stories", headers=self.auth(token), data={"caption": "فيديو حزين", "mood_key": "sad"},
            files={"video": ("story.mp4", fixture, "video/mp4")},
        )
        self.assertEqual(story_response.status_code, 201, story_response.text)
        story = story_response.json()
        self.assertEqual(story["mood_key"], "sad")
        story_file = _TEST_ROOT / "uploads" / story["video_url"].removeprefix("/uploads/")
        self.assertTrue(story_file.is_file())

        invalid_mood = self.client.post(
            "/api/posts", headers=self.auth(token), data={"content": "محتوى", "mood_key": "calm"}
        )
        self.assertEqual(invalid_mood.status_code, 400)

        image = io.BytesIO()
        Image.new("RGB", (8, 8), color="green").save(image, format="JPEG")
        both_media = self.client.post(
            "/api/posts", headers=self.auth(token), data={"content": "صورة وفيديو"},
            files={"image": ("post.jpg", image.getvalue(), "image/jpeg"),
                   "video": ("post.mp4", fixture, "video/mp4")},
        )
        self.assertEqual(both_media.status_code, 400)

        self.assertEqual(self.client.delete(f"/api/posts/{post['id']}", headers=self.auth(token)).status_code, 200)
        self.assertEqual(self.client.delete(f"/api/stories/{story['id']}", headers=self.auth(token)).status_code, 200)
        self.assertFalse(post_file.exists())
        self.assertFalse(story_file.exists())

    def test_additive_media_migration_preserves_legacy_rows_and_is_idempotent(self):
        legacy_path = _TEST_ROOT / "legacy-schema.db"
        legacy_engine = create_engine(f"sqlite:///{legacy_path}")
        with legacy_engine.begin() as connection:
            connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(30), email VARCHAR(255))"))
            connection.execute(text("INSERT INTO users (id, username, email) VALUES (1, 'legacy', 'legacy@example.com')"))
            connection.execute(text("CREATE TABLE posts (id INTEGER PRIMARY KEY, content TEXT)"))
            connection.execute(text("CREATE TABLE stories (id INTEGER PRIMARY KEY, caption TEXT)"))
            connection.execute(text("CREATE TABLE reels (id INTEGER PRIMARY KEY, video_url VARCHAR(255))"))
            connection.execute(text("CREATE TABLE challenges (id INTEGER PRIMARY KEY, title VARCHAR(120))"))
            connection.execute(text("INSERT INTO posts (id, content) VALUES (1, 'قديم')"))
            connection.execute(text("INSERT INTO stories (id, caption) VALUES (1, 'قصة قديمة')"))
            connection.execute(text("INSERT INTO reels (id, video_url) VALUES (1, '/uploads/reels/old.mp4')"))
            connection.execute(text("INSERT INTO challenges (id, title) VALUES (1, 'تحدٍ قديم')"))

        migrate_additive_media_columns(legacy_engine)
        migrate_additive_media_columns(legacy_engine)
        inspector = inspect(legacy_engine)
        self.assertIn("video_url", {column["name"] for column in inspector.get_columns("posts")})
        self.assertIn("mood_key", {column["name"] for column in inspector.get_columns("posts")})
        self.assertIn("video_url", {column["name"] for column in inspector.get_columns("stories")})
        self.assertIn("mood_key", {column["name"] for column in inspector.get_columns("stories")})
        self.assertIn("mood_key", {column["name"] for column in inspector.get_columns("reels")})
        self.assertIn("period", {column["name"] for column in inspector.get_columns("challenges")})
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        self.assertTrue({"phone_number", "phone_verified", "email_otp_enabled", "sms_otp_enabled", "totp_secret", "pending_totp_secret", "totp_last_step"}.issubset(user_columns))
        with legacy_engine.connect() as connection:
            self.assertEqual(connection.execute(text("SELECT username FROM users WHERE id=1")).scalar_one(), "legacy")
            self.assertEqual(connection.execute(text("SELECT email_otp_enabled FROM users WHERE id=1")).scalar_one(), 0)
            self.assertEqual(connection.execute(text("SELECT content FROM posts WHERE id=1")).scalar_one(), "قديم")
            self.assertEqual(connection.execute(text("SELECT caption FROM stories WHERE id=1")).scalar_one(), "قصة قديمة")
            self.assertEqual(connection.execute(text("SELECT video_url FROM reels WHERE id=1")).scalar_one(), "/uploads/reels/old.mp4")
            self.assertEqual(connection.execute(text("SELECT title FROM challenges WHERE id=1")).scalar_one(), "تحدٍ قديم")
            self.assertEqual(connection.execute(text("SELECT period FROM challenges WHERE id=1")).scalar_one(), "weekly")
        legacy_engine.dispose()

    def test_new_community_pages_are_served_with_arabic_html(self):
        for page in ("community.html", "circles.html", "challenges.html", "business.html"):
            response = self.client.get(f"/{page}")
            self.assertEqual(response.status_code, 200, f"{page}: {response.text[:200]}")
            self.assertIn('lang="ar"', response.text)
            self.assertIn("community.css", response.text)

    def test_wsgi_bridge_preserves_http_status_and_health_response(self):
        environ = {
            "REQUEST_METHOD": "GET", "PATH_INFO": "/api/health", "QUERY_STRING": "",
            "CONTENT_LENGTH": "0", "wsgi.input": BytesIO(b""),
            "SERVER_NAME": "localhost", "SERVER_PORT": "8000", "SERVER_PROTOCOL": "HTTP/1.1",
            "wsgi.url_scheme": "http",
        }
        captured = {}
        body = b"".join(wsgi_application(environ, lambda status, headers: captured.update(status=status, headers=headers)))
        self.assertEqual(captured["status"], "200 OK")
        self.assertEqual(json.loads(body)["status"], "ok")

        environ["PATH_INFO"] = "/missing-route"
        wsgi_application(environ, lambda status, headers: captured.update(status=status, headers=headers))
        self.assertEqual(captured["status"], "404 Not Found")

        environ["PATH_INFO"] = "/login.html"
        page = b"".join(wsgi_application(environ, lambda status, headers: captured.update(status=status, headers=headers)))
        self.assertEqual(captured["status"], "200 OK")
        self.assertIn("تسجيل الدخول".encode("utf-8"), page)


if __name__ == "__main__":
    unittest.main()
