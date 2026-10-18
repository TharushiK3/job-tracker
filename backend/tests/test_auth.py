import time
import unittest
from unittest.mock import patch

import httpx
import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import get_settings
from app.main import app


class AuthenticationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
        )
        cls.other_private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
        )

        public_key = cls.private_key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("ascii")

        cls.settings = get_settings().model_copy(
            update={
                "clerk_secret_key": SecretStr("sk_test_unit_tests"),
                "clerk_jwt_key": SecretStr(public_key),
                "clerk_issuer": "https://unit-tests.clerk.invalid",
                "clerk_authorized_parties": ["http://localhost:3000"],
            }
        )

    def setUp(self):
        app.dependency_overrides[get_settings] = lambda: self.settings
        self.addCleanup(
            app.dependency_overrides.pop,
            get_settings,
            None,
        )

        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def make_token(self, *, signing_key=None, omit=(), **changes):
        now = int(time.time())

        claims = {
            "iss": self.settings.clerk_issuer,
            "sub": "user_unit_test",
            "sid": "sess_unit_test",
            "azp": "http://localhost:3000",
            "iat": now - 10,
            "nbf": now - 10,
            "exp": now + 60,
            "v": 2,
        }

        claims.update(changes)

        for name in omit:
            claims.pop(name, None)

        key = self.private_key if signing_key is None else signing_key

        return jwt.encode(
            claims,
            key,
            algorithm="RS256",
            headers={"kid": "unit-test-key"},
        )

    def request_me(self, token, scheme="Bearer"):
        return self.client.get(
            "/api/me",
            headers={"Authorization": f"{scheme} {token}"},
        )

    def test_health_is_public(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

    def test_missing_credentials_are_rejected(self):
        response = self.client.get("/api/me")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(
            response.headers["www-authenticate"],
            "Bearer",
        )

    def test_valid_token_returns_only_the_verified_identity(self):
        token = self.make_token()

        for scheme in ("Bearer", "bearer"):
            with self.subTest(scheme=scheme):
                response = self.request_me(token, scheme)

                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    response.json(),
                    {
                        "issuer": self.settings.clerk_issuer,
                        "subject": "user_unit_test",
                    },
                )
                self.assertEqual(
                    response.headers["cache-control"],
                    "no-store",
                )

    def test_token_signed_with_another_key_is_rejected(self):
        token = self.make_token(signing_key=self.other_private_key)

        self.assertEqual(self.request_me(token).status_code, 401)

    def test_invalid_claims_are_rejected(self):
        now = int(time.time())

        cases = [
            (
                "expired",
                {
                    "iat": now - 120,
                    "nbf": now - 120,
                    "exp": now - 60,
                },
                (),
            ),
            (
                "not_yet_active",
                {"nbf": now + 60, "exp": now + 120},
                (),
            ),
            (
                "wrong_issuer",
                {"iss": "https://another-instance.invalid"},
                (),
            ),
            (
                "wrong_origin",
                {"azp": "https://untrusted.example"},
                (),
            ),
            ("missing_origin", {}, ("azp",)),
            ("missing_expiry", {}, ("exp",)),
            ("missing_subject", {}, ("sub",)),
            ("missing_session", {}, ("sid",)),
            ("pending_session", {"sts": "pending"}, ()),
        ]

        for name, changes, omit in cases:
            with self.subTest(case=name):
                token = self.make_token(omit=omit, **changes)

                self.assertEqual(
                    self.request_me(token).status_code,
                    401,
                )

    def test_cookie_without_bearer_credentials_is_rejected(self):
        self.client.cookies.set("__session", self.make_token())

        response = self.client.get("/api/me")

        self.assertEqual(response.status_code, 401)

    def test_malformed_and_unsupported_tokens_are_rejected(self):
        for token in ("not-a-jwt", "not.a.jwt", "oat_unit_test"):
            with self.subTest(token=token):
                self.assertEqual(
                    self.request_me(token).status_code,
                    401,
                )

    def test_verification_outage_returns_service_unavailable(self):
        with (
            patch(
                "app.auth.authenticate_request",
                side_effect=httpx.ConnectError("Temporary failure"),
            ),
            self.assertLogs("app.auth", level="WARNING"),
        ):
            response = self.request_me(self.make_token())

        self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()