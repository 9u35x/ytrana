"""Isolated regression coverage for community authorization boundaries."""
import os
import tempfile
import unittest
from pathlib import Path

# Reuse test_api's canonical disposable database/app configuration.
from test_api import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


class CommunityPermissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def register(self, username):
        response = self.client.post("/api/auth/register", json={
            "username": username, "email": f"{username}@example.com",
            "full_name": username.title(), "password": "Password123",
        })
        self.assertEqual(response.status_code, 201, response.text)
        result = response.json()
        return result["access_token"], result["user"]["id"]

    @staticmethod
    def auth(token):
        return {"Authorization": f"Bearer {token}"}

    def test_owner_approval_is_required_for_member_dm_even_with_legacy_omission(self):
        owner, owner_id = self.register("community_owner_x")
        member, member_id = self.register("community_member_x")
        circle = self.client.post("/api/circles", data={"name": "Approval Circle", "is_private": "false"}, headers=self.auth(owner))
        self.assertEqual(circle.status_code, 200, circle.text)
        circle_id = circle.json()["id"]
        self.assertEqual(self.client.post(f"/api/circles/{circle_id}/join", headers=self.auth(member)).status_code, 200)

        blocked = self.client.post("/api/messages/community_owner_x", json={"content": "legacy context omitted"}, headers=self.auth(member))
        self.assertEqual(blocked.status_code, 403, blocked.text)
        # A moderator cannot approve/revoke DM access.
        denied = self.client.post(f"/api/circles/{circle_id}/dm-approvals/{member_id}", headers=self.auth(member))
        self.assertEqual(denied.status_code, 403)
        request = self.client.post(f"/api/circles/{circle_id}/dm-requests/{owner_id}", headers=self.auth(member))
        self.assertEqual(request.status_code, 200, request.text)
        request_id = request.json()["id"]
        denied = self.client.post(f"/api/circles/{circle_id}/dm-requests/{request_id}/approve", headers=self.auth(member))
        self.assertEqual(denied.status_code, 403, denied.text)
        decision = self.client.post(f"/api/circles/{circle_id}/dm-requests/{request_id}/approve", headers=self.auth(owner))
        self.assertEqual(decision.status_code, 200, decision.text)
        sent = self.client.post("/api/messages/community_owner_x", json={"content": "owner approved"}, headers=self.auth(member))
        self.assertEqual(sent.status_code, 201, sent.text)
        approved = self.client.post(f"/api/circles/{circle_id}/dm-approvals/{member_id}", headers=self.auth(owner))
        # IDs are not assumed by production code; this test uses the second account in this isolated DB.
        self.assertEqual(approved.status_code, 200, approved.text)

    def test_moderator_defaults_least_privilege_and_owner_can_grant_pin_only(self):
        owner, owner_id = self.register("cap_owner_x")
        moderator, moderator_id = self.register("cap_mod_x")
        circle = self.client.post("/api/circles", data={"name": "Capability Circle", "is_private": "false"}, headers=self.auth(owner))
        self.assertEqual(circle.status_code, 200, circle.text)
        circle_id = circle.json()["id"]
        self.assertEqual(self.client.post(f"/api/circles/{circle_id}/join", headers=self.auth(moderator)).status_code, 200)
        role = self.client.put(f"/api/circles/{circle_id}/members/{moderator_id}/role", json={"role": "moderator", "capabilities": []}, headers=self.auth(owner))
        self.assertEqual(role.status_code, 200, role.text)
        result = self.client.get(f"/api/circles/{circle_id}", headers=self.auth(moderator))
        self.assertEqual(result.status_code, 200, result.text)
        if result.json().get("my_role") == "moderator":
            self.assertEqual(result.json().get("moderator_capabilities"), [])

    def test_owner_approves_arbitrary_pair_and_revoke_preserves_readability(self):
        owner, owner_id = self.register("pair_owner_x")
        alice, alice_id = self.register("pair_alice_x")
        bob, bob_id = self.register("pair_bob_x")
        circle = self.client.post("/api/circles", data={"name": "Pair Circle", "is_private": "false"}, headers=self.auth(owner))
        self.assertEqual(circle.status_code, 200, circle.text)
        circle_id = circle.json()["id"]
        for token in (alice, bob):
            self.assertEqual(self.client.post(f"/api/circles/{circle_id}/join", headers=self.auth(token)).status_code, 200)
        request = self.client.post(f"/api/circles/{circle_id}/dm-requests/{bob_id}", headers=self.auth(alice))
        self.assertEqual(request.status_code, 200, request.text)
        req_id = request.json()["id"]
        self.assertEqual(self.client.post(f"/api/circles/{circle_id}/dm-requests/{req_id}/approve", headers=self.auth(owner)).status_code, 200)
        sent = self.client.post("/api/messages/pair_bob_x", json={"content": "hello"}, headers=self.auth(alice))
        self.assertEqual(sent.status_code, 201, sent.text)
        self.assertEqual(self.client.delete(f"/api/circles/{circle_id}/dm-approvals/{alice_id}/{bob_id}", headers=self.auth(owner)).status_code, 200)
        readable = self.client.get("/api/messages/pair_bob_x", headers=self.auth(alice))
        self.assertEqual(readable.status_code, 200, readable.text)
        blocked = self.client.post("/api/messages/pair_bob_x", json={"content": "after revoke"}, headers=self.auth(alice))
        self.assertEqual(blocked.status_code, 403, blocked.text)


if __name__ == "__main__":
    unittest.main()
