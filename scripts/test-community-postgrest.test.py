#!/usr/bin/env python3
"""Network-free regressions for target refusal and cleanup failure boundaries."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("community_postgrest", Path(__file__).with_name("test-community-postgrest.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

CONFIG = {"API_URL": "http://127.0.0.1:55439", "DB_URL": "postgresql://test:test@127.0.0.1:54322/mizyun_community_transport",
          "ANON_KEY": "synthetic-anon", "SERVICE_ROLE_KEY": "synthetic-service"}


class BoundaryTests(unittest.TestCase):
    def test_all_local_targets_accept(self):
        self.assertEqual(module.validate_config(CONFIG), CONFIG)

    def test_remote_or_mixed_urls_rejected_before_requests(self):
        for key, target in (
            ("API_URL", "https://mizyun-supabase-dev.phiskel.com"),
            ("API_URL", "http://127.0.0.1.example.com:55439"),
            ("API_URL", "http://127.0.0.1:55439/rest/v1"),
            ("API_URL", "http://127.0.0.1:55439?forward=remote"),
            ("API_URL", "http://user:secret@127.0.0.1:55439"),
            ("API_URL", "http://@127.0.0.1:55439"),
            ("API_URL", "http://127.0.0.1"),
            ("DB_URL", "postgresql://test:test@remote.example:5432/mizyun_community_transport"),
            ("DB_URL", "postgresql://test:test@127.0.0.1:54322/postgres"),
            ("DB_URL", "postgresql://test:test@127.0.0.1:54322/mizyun_community_transport/another"),
            ("DB_URL", "postgresql://test:test@127.0.0.1:54322/mizyun_community_transport?host=remote"),
            ("DB_URL", "postgresql://test:test@127.0.0.1:54322/mizyun_community_transport#remote"),
        ):
            with self.subTest(key=key, target=target), self.assertRaises(module.BoundaryFailure):
                module.Suite({**CONFIG, key: target})

    def test_redirect_refuses_forwarding(self):
        with self.assertRaises(module.BoundaryFailure):
            module.NoRedirects().redirect_request(None, None, 302, "redirect", {}, "https://remote.example")

    def test_closed_controls_refuse_before_fixture_writes(self):
        suite = module.Suite(CONFIG)
        calls = []
        def request(method, path, **kwargs):
            calls.append(method)
            if path.startswith("/auth/"):
                return 200, {"users": []}
            return 200, [{"enabled": False}]
        suite.request = request
        with self.assertRaises(module.BoundaryFailure):
            suite.preflight()
        self.assertEqual(calls, ["GET", "GET"])
        self.assertEqual(suite.users, [])

    def test_existing_auth_users_refuse_before_other_requests(self):
        suite = module.Suite(CONFIG)
        suite.request = lambda *args, **kwargs: (200, {"users": [{"id": "existing"}]})
        with self.assertRaises(module.BoundaryFailure):
            suite.preflight()
        self.assertEqual(suite.users, [])

    def test_cleanup_continues_after_failure_and_reports_incomplete(self):
        suite = module.Suite(CONFIG)
        suite.users = ["first", "second"]
        suite.handles = ["rest_created"]
        paths = []
        def request(method, path, **kwargs):
            paths.append(path)
            return (500, None) if path.endswith("second") else (200, [])
        suite.request = request
        with self.assertRaises(module.BoundaryFailure):
            suite.cleanup()
        self.assertEqual(paths[:3], ["/auth/v1/admin/users/second", "/auth/v1/admin/users/first",
                                    "/rest/v1/community_handle_quarantine?handle=eq.rest_created"])
        self.assertIn("/rest/v1/community_pilot_cohort?user_id=eq.first", paths)
        self.assertIn("/rest/v1/community_pilot_cohort?user_id=eq.second", paths)

    def test_cleanup_detects_remaining_synthetic_cohort(self):
        suite = module.Suite(CONFIG)
        suite.users = ["created"]
        def request(method, path, **kwargs):
            if path.startswith("/rest/v1/community_pilot_cohort"):
                return 200, [{"user_id": "created"}]
            return 200, []
        suite.request = request
        with self.assertRaises(module.BoundaryFailure):
            suite.cleanup()


if __name__ == "__main__":
    unittest.main()
