#!/usr/bin/env python3
"""Real Auth/PostgREST acceptance on an EMPTY disposable loopback Supabase stack.

Run --disposable-local-stack [--config /private/tmp/local.json]. Configuration
uses Supabase status keys API_URL, DB_URL, ANON_KEY, SERVICE_ROLE_KEY; without
--config read `pnpm exec supabase status -o json`. Apply current migrations and
explicitly enable growth controls in this isolated stack first, retaining
cohort_required=true and delivery=false. This runner never changes global flags.
An isolated DB alone is insufficient: Auth and PostgREST must both point at it,
with matching local JWT keys. Never expose keys in arguments/output. Existing
Auth users/cohort entries cause preflight failure before any fixture mutation.
DB_URL must name a scratch database starting mizyun_community_; postgres and
ordinary local project databases are rejected even with the attestation flag.
"""

import argparse
import concurrent.futures
import datetime
import json
from pathlib import Path
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


class BoundaryFailure(RuntimeError):
    """Safe diagnostic, without server responses, private IDs or credentials."""


def validate_config(config):
    """Reject remote/mixed targets before any request or synthetic write."""
    for key, schemes in (("API_URL", {"http"}), ("DB_URL", {"postgres", "postgresql"})):
        try:
            target = urllib.parse.urlsplit(config[key])
            port = target.port
        except (KeyError, TypeError, ValueError):
            raise BoundaryFailure("Missing or invalid local target configuration") from None
        if (target.scheme not in schemes
            or target.hostname not in {"localhost", "127.0.0.1", "::1"}
            or port is None or target.fragment or target.query
            or (key == "API_URL" and (target.username is not None or target.password is not None or target.path not in {"", "/"}))
            or (key == "DB_URL" and target.path in {"", "/"})):
            raise BoundaryFailure("Refusing non-loopback, forwarded or ambiguous target")
        if key == "DB_URL" and not re.fullmatch(r"mizyun_community_[a-z0-9_]{1,45}", target.path[1:]):
            raise BoundaryFailure("Disposable database name must start mizyun_community_")
    if not all(isinstance(config.get(key), str) and config[key] for key in ("ANON_KEY", "SERVICE_ROLE_KEY")):
        raise BoundaryFailure("Local Auth keys are required in configuration")
    if config["ANON_KEY"] == config["SERVICE_ROLE_KEY"]:
        raise BoundaryFailure("Distinct anonymous and service keys are required")
    return config


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise BoundaryFailure("Refusing redirected local acceptance request")


class Suite:
    def __init__(self, config):
        self.config = validate_config(config)
        self.base = config["API_URL"].rstrip("/")
        self.users, self.handles, self.passed = [], [], []

    def request(self, method, path, token=None, body=None, service=False,
                prefer="return=representation"):
        if not path.startswith(("/rest/v1/", "/auth/v1/")) or "://" in path:
            raise BoundaryFailure("Invalid acceptance request path")
        key = self.config["SERVICE_ROLE_KEY" if service else "ANON_KEY"]
        request = urllib.request.Request(
            self.base + path, method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={"apikey": key, "Authorization": "Bearer " + (token or key),
                     "Content-Type": "application/json", "Prefer": prefer})
        # Never forward credentials through environment proxies or redirects.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())
        try:
            with opener.open(request, timeout=15) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                return error.code, json.loads(raw) if raw else None
            except (ValueError, UnicodeError):
                return error.code, None

    def check(self, label, condition):
        if not condition:
            raise BoundaryFailure(label)
        self.passed.append(label)

    def rpc(self, token, name, body):
        return self.request("POST", "/rest/v1/rpc/" + name, token, body)

    def preflight(self):
        status, data = self.request("GET", "/auth/v1/admin/users?page=1&per_page=1", service=True)
        self.check("Precondition: disposable stack has no existing Auth users",
                   status == 200 and isinstance(data, dict) and data.get("users") == [])
        status, controls = self.request("GET", "/rest/v1/community_operations?select=*", service=True)
        self.check("Precondition: current Community controls exist",
                   status == 200 and isinstance(controls, list) and len(controls) == 1)
        self.check("Precondition: coordinator enabled only disposable growth controls",
                   all(controls[0].get(key) is True for key in
                       ("enabled", "enrollment", "discovery", "publish", "engagement", "cohort_required"))
                   and controls[0].get("delivery") is False)
        status, cohort = self.request("GET", "/rest/v1/community_pilot_cohort?select=user_id&limit=1", service=True)
        self.check("Precondition: no existing cohort admission", status == 200 and cohort == [])

    def fixture(self, index):
        email = "community-review-" + uuid.uuid4().hex + "@mizyun.test"
        password = secrets.token_urlsafe(28)
        status, data = self.request("POST", "/auth/v1/admin/users", service=True,
                                    body={"email": email, "password": password, "email_confirm": True})
        self.check("Create synthetic account " + str(index),
                   status == 200 and isinstance(data, dict) and isinstance(data.get("id"), str))
        user_id = str(uuid.UUID(data["id"]))
        self.users.append(user_id)
        status, login = self.request("POST", "/auth/v1/token?grant_type=password",
                                     body={"email": email, "password": password})
        self.check("Real Auth password login " + str(index),
                   status == 200 and isinstance(login, dict) and isinstance(login.get("access_token"), str))
        status, profiles = self.request("PATCH", "/rest/v1/profiles?id=eq." + user_id,
                                        body={"birth_year": 1990}, service=True)
        self.check("Synthetic adult source fixture " + str(index),
                   status == 200 and isinstance(profiles, list) and len(profiles) == 1)
        status, _ = self.request("POST", "/rest/v1/community_pilot_cohort",
                                 body={"user_id": user_id}, service=True)
        self.check("Admit only synthetic account " + str(index), status == 201)
        return user_id, login["access_token"]

    def enroll(self, token):
        handle = "rest_" + uuid.uuid4().hex[:19]
        status, existing = self.request("GET", "/rest/v1/community_handle_quarantine?handle=eq." + handle, service=True)
        self.check("Synthetic handle absent before enrollment", status == 200 and existing == [])
        self.handles.append(handle)  # Covers a lost enrollment response too.
        body = {"p_handle": handle, "p_display_name": "Synthetic participant",
                "p_avatar_symbol": "SP", "p_bio": "Private social bio", "p_is_searchable": False,
                "p_adult_declaration": True, "p_terms_version": "2026-09-30"}
        status, _ = self.rpc(token, "community_save_profile", {**body, "p_adult_declaration": False})
        self.check("Refused adult declaration cannot enroll", 400 <= status < 500)
        status, data = self.rpc(token, "community_save_profile", body)
        self.check("Explicit versioned enrollment", status == 200 and isinstance(data, list)
                   and len(data) == 1 and data[0]["status"] == "active" and data[0]["generation"] == 1)
        return data[0]

    def publish_fixture(self, user_id, token, generation):
        now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
        workout = str(uuid.uuid4())
        status, _ = self.request("POST", "/rest/v1/workouts", token,
                                 {"id": workout, "user_id": user_id, "name": "Synthetic private title",
                                  "started_at": (now - datetime.timedelta(seconds=60)).isoformat(),
                                  "completed_at": now.isoformat(), "details": {
                                      "workoutLifecycle": {"kind": "session"}, "privateNote": "Never shared"}})
        self.check("Real owner private workout insertion", status == 201)
        args = {"p_source_workout_id": workout, "p_category": "strength", "p_shared_day": now.date().isoformat(),
                "p_duration_seconds": 60, "p_enrollment_generation": generation,
                "p_operation_id": str(uuid.uuid4()), "p_expected_version": 0,
                "p_expected_revoked": False, "p_workout_details": None}
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.rpc(token, "community_publish_activity", args), range(2)))
        self.check("Concurrent operation commits one exact publication version",
                   all(status == 200 and isinstance(rows, list) and len(rows) == 1 for status, rows in results)
                   and results[0][1][0]["id"] == results[1][1][0]["id"]
                   and all(rows[0]["version"] == 1 for _, rows in results))
        card = results[0][1][0]
        status, replay = self.rpc(token, "community_publish_activity", args)
        self.check("Lost-response replay preserves exact publication", status == 200 and replay == [card])
        status, _ = self.rpc(token, "community_publish_activity", {**args, "p_duration_seconds": None})
        self.check("Operation ID cannot authorize changed content", 400 <= status < 500)
        return workout, card

    def assert_hidden(self, token, card_id, label):
        status, data = self.rpc(token, "community_get_activity", {"p_activity_id": card_id})
        self.check(label + " revokes follower read", status == 200 and data == [])
        status, data = self.request("GET", "/rest/v1/community_reactions?activity_id=eq." + card_id, service=True)
        self.check(label + " removes dependent reactions", status == 200 and data == [])

    def run(self):
        self.preflight()
        ua, a = self.fixture(0)
        ub, b = self.fixture(1)
        uc, c = self.fixture(2)
        status, data = self.rpc(c, "community_get_profile", {"p_user_id": uc})
        self.check("Never-enrolled principal has no implicit profile", status == 200 and data == [])
        author = self.enroll(a)
        self.enroll(b)
        status, data = self.request("GET", "/rest/v1/community_profiles?user_id=eq." + ua, b)
        self.check("Hidden raw social identity denied", status == 200 and data == [])
        status, data = self.request("GET", "/rest/v1/community_invitations", b)
        self.check("Foreign invitation tokens cannot be enumerated", status == 200 and data == [])
        invite = secrets.token_urlsafe(16)
        status, data = self.rpc(a, "community_create_invitation", {"p_token": invite, "p_expires_in_days": 7})
        self.check("Author issues opaque invitation", status == 200 and isinstance(data, list) and len(data) == 1)
        status, data = self.rpc(b, "community_resolve_invitation", {"p_token": invite})
        self.check("Known invite exposes minimal identity", status == 200 and len(data) == 1
                   and data[0]["inviter"]["user_id"] == ua and data[0]["inviter"]["bio"] is None)
        args = {"p_operation_id": str(uuid.uuid4()), "p_target_user_id": ua, "p_invitation_token": None}
        status, _ = self.rpc(b, "community_request_follow", args)
        self.check("Guessed hidden principal cannot authorize request", 400 <= status < 500)
        status, data = self.rpc(b, "community_request_follow", {**args, "p_invitation_token": invite})
        self.check("Invited request uses operation-ID RPC", status == 200 and isinstance(data, list)
                   and len(data) == 1 and data[0]["status"] == "pending")
        edge = data[0]["id"]
        # Approval/reactions are guarded table writes in the actual adapter, not RPCs.
        status, data = self.request("PATCH", "/rest/v1/community_relationships?id=eq." + edge, b, {"status": "approved"})
        self.check("Requester cannot approve outgoing request", 400 <= status < 500 or (status == 200 and data == []))
        status, data = self.request("PATCH", "/rest/v1/community_relationships?id=eq." + edge, a, {"status": "approved"})
        self.check("Recipient deliberately approves relationship", status == 200 and len(data) == 1 and data[0]["status"] == "approved")
        workout, card = self.publish_fixture(ua, a, author["generation"])
        card_id = card["id"]
        status, data = self.rpc(b, "community_get_activity", {"p_activity_id": card_id})
        self.check("Follower snapshot excludes private source identity/details", status == 200 and len(data) == 1
                   and data[0]["source_workout_id"] == "00000000-0000-0000-0000-000000000000"
                   and data[0]["workout_details"] is None and data[0]["duration_seconds"] == 60
                   and "name" not in data[0] and "details" not in data[0])
        for token, label in ((b, "Approved follower"), (c, "Unrelated principal")):
            status, data = self.request("GET", "/rest/v1/workouts?id=eq." + workout, token)
            self.check(label + " cannot load private source", status == 200 and data == [])
        status, data = self.rpc(c, "community_get_activity", {"p_activity_id": card_id})
        self.check("Unrelated principal cannot read publication", status == 200 and data == [])
        reaction = {"activity_id": card_id, "user_id": ub, "reaction": "clap"}
        for _ in range(2):
            status, _ = self.request("POST", "/rest/v1/community_reactions?on_conflict=activity_id,user_id",
                                     b, reaction, prefer="resolution=merge-duplicates,return=representation")
            self.check("Authenticated reaction upsert accepts retry", status in (200, 201))
        status, data = self.request("GET", "/rest/v1/community_reactions?activity_id=eq." + card_id, service=True)
        self.check("Reaction retry leaves one durable row", status == 200 and len(data) == 1 and data[0]["user_id"] == ub)
        status, _ = self.rpc(a, "community_unpublish_activity", {"p_activity_id": card_id, "p_expected_version": card["version"]})
        self.check("Owner unpublishes exact version", status in (200, 204))
        self.assert_hidden(b, card_id, "Explicit unpublish")
        status, _ = self.request("POST", "/rest/v1/community_reactions?on_conflict=activity_id,user_id",
                                 b, reaction, prefer="resolution=merge-duplicates,return=representation")
        self.check("Stale-screen reaction after unpublish denied", 400 <= status < 500)
        workout, card = self.publish_fixture(ua, a, author["generation"])
        status, _ = self.request("POST", "/rest/v1/community_reactions", b,
                                 {**reaction, "activity_id": card["id"]})
        self.check("Follower reacts before source correction", status == 201)
        status, _ = self.request("PATCH", "/rest/v1/workouts?id=eq." + workout, a, {"completed_at": None})
        self.check("Owner corrects private source completion", status == 200)
        self.assert_hidden(b, card["id"], "Direct source correction")
        _, card = self.publish_fixture(ua, a, author["generation"])
        status, _ = self.request("POST", "/rest/v1/community_reactions", b,
                                 {**reaction, "activity_id": card["id"]})
        self.check("Follower reacts before blocking", status == 201)
        status, _ = self.request("POST", "/rest/v1/community_blocks", a, {"blocker_user_id": ua, "blocked_user_id": ub})
        self.check("Author establishes bilateral block", status == 201)
        self.assert_hidden(b, card["id"], "Bilateral block")
        status, data = self.rpc(b, "community_resolve_invitation", {"p_token": invite})
        self.check("Block defeats previously valid invitation", status == 200 and data == [])
        status, data = self.request("GET", "/rest/v1/community_relationships?id=eq." + edge, service=True)
        self.check("Block transactionally removes approved edge", status == 200 and data == [])
        status, _ = self.request("DELETE", "/rest/v1/community_blocks?blocker_user_id=eq." + ua + "&blocked_user_id=eq." + ub, a)
        self.check("Author removes own block", status in (200, 204))
        self.assert_hidden(b, card["id"], "Unblock never restores audience")
        status, data = self.rpc(b, "community_request_follow", {
            "p_operation_id": str(uuid.uuid4()), "p_target_user_id": ua,
            "p_invitation_token": invite})
        self.check("Unblock requires a fresh deliberate request", status == 200 and len(data) == 1
                   and data[0]["status"] == "pending" and data[0]["id"] != edge)
        status, data = self.request("PATCH", "/rest/v1/community_relationships?id=eq." + data[0]["id"],
                                    a, {"status": "approved"})
        self.check("Fresh recipient approval restores only chosen audience", status == 200
                   and len(data) == 1 and data[0]["status"] == "approved")
        status, data = self.rpc(b, "community_get_activity", {"p_activity_id": card["id"]})
        self.check("Current follower can read before withdrawal", status == 200 and len(data) == 1)
        status, _ = self.request("POST", "/rest/v1/community_reactions", b,
                                 {**reaction, "activity_id": card["id"]})
        self.check("Fresh interaction before withdrawal", status == 201)
        status, _ = self.rpc(a, "community_withdraw_profile", {})
        self.check("Author explicitly withdraws enrollment", status in (200, 204))
        self.assert_hidden(b, card["id"], "Community withdrawal")
        status, data = self.rpc(a, "community_get_profile", {"p_user_id": ua})
        self.check("Withdrawal retains honest owner state", status == 200 and len(data) == 1 and data[0]["status"] == "withdrawn")
        status, data = self.rpc(b, "community_resolve_invitation", {"p_token": invite})
        self.check("Withdrawal invalidates old invitations", status == 200 and data == [])
        status, data = self.rpc(a, "community_feed", {"p_limit": 20, "p_before_time": None, "p_before_id": None})
        self.check("Withdrawn principal cannot reopen shared feed", status == 200 and data == [])
        status, data = self.request("GET", "/rest/v1/workouts?user_id=eq." + ua, a)
        self.check("Community withdrawal preserves private tracking", status == 200 and len(data) == 3)

    def cleanup(self):
        failures = 0
        for user_id in reversed(self.users):
            try:
                status, _ = self.request("DELETE", "/auth/v1/admin/users/" + user_id, service=True)
                failures += status not in (200, 204)
            except Exception:
                failures += 1
        for handle in self.handles:
            try:
                status, _ = self.request("DELETE", "/rest/v1/community_handle_quarantine?handle=eq." + handle, service=True)
                failures += status not in (200, 204)
            except Exception:
                failures += 1
        # Verify FK cleanup for only principals created by this process; never
        # delete broadly or run global retention/withdrawal maintenance here.
        for user_id in self.users:
            for table in ("community_pilot_cohort", "community_profiles", "community_withdrawal_jobs"):
                try:
                    status, rows = self.request("GET", "/rest/v1/" + table + "?user_id=eq." + user_id,
                                                service=True)
                    failures += status != 200 or rows != []
                except Exception:
                    failures += 1
        if failures:
            raise BoundaryFailure("Synthetic cleanup incomplete; keep disposable stack isolated and destroy it")
        print("Synthetic account/cohort cleanup completed:", len(self.users))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disposable-local-stack", action="store_true", help="Attest target is an isolated empty disposable stack")
    parser.add_argument("--config", type=Path, help="Private local configuration JSON; keys never printed")
    args = parser.parse_args()
    if not args.disposable_local_stack:
        parser.error("--disposable-local-stack required; do not target the shared local stack")
    try:
        config = json.loads(args.config.read_text()) if args.config else json.loads(subprocess.check_output(
            ["pnpm", "exec", "supabase", "status", "-o", "json"], stderr=subprocess.DEVNULL))
        suite = Suite(config)
        try:
            suite.run()
            print("Local real Auth/PostgREST assertions passed:", len(suite.passed))
        finally:
            suite.cleanup()
    except BoundaryFailure as error:
        print("Community local transport acceptance failed:", error, file=sys.stderr)
        return 1
    except Exception:
        print("Community local transport acceptance failed; inspect isolated services without exposing credentials", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
