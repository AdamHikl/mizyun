#!/usr/bin/env python3
"""Current-schema real Auth/PostgREST/Storage acceptance; disposable loopback ONLY.

python3 scripts/test-community-expansion-postgrest.py --disposable-local-stack
  --config /private/tmp/private-local-config.json

Requires existing core Suite preconditions: empty Auth/cohort, current migrations,
enabled core growth controls with cohort_required=true and delivery=false. The
same isolated API must route /auth/v1, /rest/v1 and /storage/v1. GoTrue must enable
TOTP enrollment and verification. Expansion flags are changed ONLY after those
preconditions. Keys, synthetic passwords, tokens and TOTP secret stay in memory
or an owner-only temporary file. No JWTs are fabricated; staff uses real GoTrue.
Coordinator owns execution and final container/database destruction. Safe output
contains assertion labels/counts only. A failure never counts as skipped/passed.
"""

import argparse
import base64
import datetime
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile
import time
import uuid

spec = importlib.util.spec_from_file_location("community_transport", Path(__file__).with_name("test-community-postgrest.py"))
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)
BoundaryFailure = transport.BoundaryFailure


class ExpansionSuite(transport.Suite):
    def request(self, method, path, *args, **kwargs):
        status, data = super().request(method, path, *args, **kwargs)
        # Media explicitly verifies Auth erasure for one of our own fixtures.
        if method == "DELETE" and path.startswith("/auth/v1/admin/users/") and path.rsplit("/", 1)[-1] in self.users and status == 404:
            return 200, None
        return status, data

    def ok_rpc(self, token, name, operation=None, args=None, body=None):
        status, data = self.rpc(token, name, body if body is not None else {"p_operation": operation, "p_args": args or {}})
        if status != 200 and isinstance(data, dict):
            code = str(data.get("code", ""))
            if re.fullmatch(r"[A-Z0-9]{5}", code):
                print("RPC safe diagnostic:", name, status, code, flush=True)
            message = str(data.get("message", ""))
            safe = re.fullmatch(r'column reference "([a-z_]+)" is ambiguous', message)
            if safe:
                print("Ambiguous SQL identifier:", safe.group(1), flush=True)
            elif re.fullmatch(r"community_[a-z_]+", message):
                print("Community domain rejection:", message, flush=True)
        self.check("Authorized RPC " + name + (" / " + operation if operation else ""), status == 200 or (name == "community_withdraw_profile" and status == 204))
        if isinstance(data, list) and len(data) == 1 and "result" in data[0]:
            return data[0]["result"]
        return data

    def denied_rpc(self, token, name, operation, args, label):
        status, _ = self.rpc(token, name, {"p_operation": operation, "p_args": args})
        self.check(label, 400 <= status < 500)

    def service_write(self, method, table, body=None):
        status, data = self.request(method, "/rest/v1/" + table, body=body, service=True)
        self.check("Disposable synthetic fixture write", status in (200, 201, 204))
        return data

    def mfa(self, uid, token):
        self.service_write("POST", "community_moderation_staff", {"user_id": uid, "active": True})
        status, enrollment = self.request("POST", "/auth/v1/factors", token, {"factor_type": "totp", "friendly_name": "Disposable staff TOTP"})
        self.check("Real GoTrue TOTP enrollment enabled", status == 200 and isinstance(enrollment, dict) and "totp" in enrollment)
        factor = str(uuid.UUID(enrollment["id"]))
        secret = enrollment["totp"]["secret"]
        status, challenge = self.request("POST", "/auth/v1/factors/" + factor + "/challenge", token, {})
        self.check("Real GoTrue TOTP challenge", status == 200 and isinstance(challenge, dict) and "id" in challenge)
        # RFC6238 SHA1/30s/6 digits. This verifies a server-enrolled synthetic
        # factor, never signs or forges a privileged JWT.
        key = base64.b32decode(secret + "=" * ((8 - len(secret) % 8) % 8), casefold=True)
        digest = hmac.new(key, struct.pack(">Q", int(time.time()) // 30), hashlib.sha1).digest()
        offset = digest[-1] & 15
        code = str((struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7fffffff) % 1000000).zfill(6)
        status, verified = self.request("POST", "/auth/v1/factors/" + factor + "/verify", token, {"challenge_id": challenge["id"], "code": code})
        self.check("Real GoTrue TOTP verification issues staff session", status == 200 and isinstance(verified, dict) and isinstance(verified.get("access_token"), str))
        issued = verified["access_token"]
        payload = issued.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * ((4 - len(payload) % 4) % 4)))
        self.check("GoTrue issued named aal2 session", claims.get("aal") == "aal2" and claims.get("sub") == uid)
        return issued

    def media(self, people, staff):
        descriptor, name = tempfile.mkstemp(prefix="community-expansion-media-", suffix=".json")
        try:
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "w") as output:
                json.dump({**self.config, "USERS": [{"id": uid, "token": token} for uid, token in people], "STAFF_TOKEN": staff, "DISPOSABLE_LOCAL_STACK": True}, output)
            environment = {key: value for key, value in os.environ.items() if key.upper() not in {"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NODE_USE_ENV_PROXY"}}
            completed = subprocess.run(["pnpm", "exec", "tsx", str(Path(__file__).with_name("test-community-media-storage.ts")), "--config", name], cwd=Path(__file__).resolve().parent.parent, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=240)
            # Never forward arbitrary child stderr/HTTP bodies; child failure
            # is an aggregate failed acceptance, not a credential-gated skip.
            if completed.returncode:
                safe_stage = re.search(r"Community media real Storage acceptance failed at ([a-zA-Z ,]+);", completed.stderr.decode())
                if safe_stage:
                    print("Media acceptance failed stage:", safe_stage.group(1), flush=True)
                    safe_http = re.search(r"category ([A-Za-z]+/[a-z_]+); HTTP ([0-9]+) (/[a-zA-Z0-9_./-]+)", completed.stderr.decode())
                    if safe_http:
                        print("Media safe diagnostic:", " ".join(safe_http.groups()), flush=True)
                else:
                    print("Media acceptance child failed before safe stage diagnostics", flush=True)
            self.check("Real Sharp/Auth/MFA/private Storage media harness", completed.returncode == 0)
            summary = completed.stdout.decode().strip()
            if re.fullmatch(r"Community media real Storage assertions passed: [0-9]+", summary):
                print(summary)
        finally:
            Path(name).unlink(missing_ok=True)

    def run(self):
        self.preflight()
        self.service_write("PATCH", "community_feature_controls?feature=in.(comments,groups,routines,messaging,challenges,media,discovery)", {"enabled": True})
        people = [self.fixture(i) for i in range(4)]
        profiles = [self.enroll(token) for _, token in people]
        (ua, a), (ub, b), (uc, c), (ud, d) = people
        staff = self.mfa(ud, d)
        self.service_write("POST", "community_relationships", [{"follower_user_id": ua, "target_user_id": ub, "status": "approved"}, {"follower_user_id": ub, "target_user_id": ua, "status": "approved"}, {"follower_user_id": ub, "target_user_id": uc, "status": "approved"}])
        for token in (a, b):
            self.ok_rpc(token, "community_messaging_rpc", "preferences", {"enabled": True})
        message_id = str(uuid.uuid4())
        send = {"id": message_id, "peerId": ub, "text": "Synthetic bounded hello"}
        first = self.ok_rpc(a, "community_messaging_rpc", "send", send)
        self.check("Real message lost-response retry", self.ok_rpc(a, "community_messaging_rpc", "send", send) == first)
        page = self.ok_rpc(b, "community_messaging_rpc", "list", {"peerId": ua})
        self.check("Real recipient receives exact text", page["messages"][0]["text"] == send["text"])
        self.denied_rpc(c, "community_messaging_rpc", "list", {"peerId": ua}, "Unrelated thread denied")
        self.denied_rpc(None, "community_messaging_rpc", "list", {"peerId": ua}, "Anonymous thread denied")
        _, card = self.publish_fixture(ua, a, profiles[0]["generation"])
        activity = card["id"]
        self.ok_rpc(a, "community_comments", "settings", {"activityId": activity, "enabled": True})
        comment_id = str(uuid.uuid4())
        comment = {"id": comment_id, "activityId": activity, "operationId": str(uuid.uuid4()), "expectedVersion": 0, "body": "Synthetic encouragement", "mentions": []}
        self.check("Real bounded comment persisted", self.ok_rpc(b, "community_comments", "upsert", comment)["version"] == 1)
        comments = self.ok_rpc(a, "community_comments", "list", {"activityId": activity})
        self.check("Post author receives bounded comment", comments["items"][0]["body"] == comment["body"])
        for token, label in ((None, "Anonymous"), (c, "Unrelated")):
            self.denied_rpc(token, "community_comments", "list", {"activityId": activity}, label + " comments denied")
        group = self.ok_rpc(a, "community_groups_rpc", "create", {"operationId": str(uuid.uuid4()), "name": "Synthetic private group", "rules": "Be kind"})["group"]
        gid = group["id"]
        # Use actual invitation and explicit join with fresh membership CAS.
        own = self.ok_rpc(a, "community_groups_rpc", "read", {"groupId": gid})
        own_version = next(m["membershipVersion"] for m in own["members"] if m["userId"] == ua)
        self.ok_rpc(a, "community_groups_rpc", "invite", {"groupId": gid, "targetUserId": ub, "membershipVersion": own_version})
        invited = self.ok_rpc(b, "community_groups_rpc", "list")["groups"][0]
        self.ok_rpc(b, "community_groups_rpc", "join", {"groupId": gid, "membershipVersion": invited["membershipVersion"]})
        joined = self.ok_rpc(b, "community_groups_rpc", "read", {"groupId": gid})
        member_version = next(m["membershipVersion"] for m in joined["members"] if m["userId"] == ub)
        self.ok_rpc(b, "community_groups_rpc", "post", {"groupId": gid, "membershipVersion": member_version, "operationId": str(uuid.uuid4()), "body": "Synthetic group encouragement", "acceptedAudience": True})
        self.check("Real group member page includes opted-in post", len(self.ok_rpc(a, "community_groups_rpc", "read", {"groupId": gid})["posts"]) == 1)
        for token, label in ((None, "Anonymous"), (c, "Unrelated")):
            self.denied_rpc(token, "community_groups_rpc", "read", {"groupId": gid}, label + " group denied")
        day = datetime.datetime.now(datetime.timezone.utc).date()
        cid = str(uuid.uuid4())
        self.ok_rpc(a, "community_challenges_rpc", "create", {"id": cid, "groupId": gid, "title": "Synthetic consistency", "startDay": day.isoformat(), "endDay": (day + datetime.timedelta(days=6)).isoformat(), "timezone": "UTC", "goalDays": 3, "confirmed": True})
        self.ok_rpc(b, "community_challenges_rpc", "join", {"id": cid, "confirmed": True})
        progress = self.ok_rpc(b, "community_challenges_rpc", "contribute", {"id": cid, "day": day.isoformat(), "kind": "rest", "confirmed": True})
        self.check("Real deliberate rest declaration receives credit", progress["challenge"]["myProgress"] == 1)
        for token, label in ((None, "Anonymous"), (c, "Unrelated")):
            self.denied_rpc(token, "community_challenges_rpc", "get", {"id": cid}, label + " challenge denied")
        routine_id = str(uuid.uuid4())
        status, _ = self.request("POST", "/rest/v1/workouts", a, {"id": routine_id, "user_id": ua, "name": "PRIVATE TITLE", "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "notes": "PRIVATE NOTE", "details": {"workoutLifecycle": {"kind": "routine"}, "injury": "PRIVATE", "coachPlan": {"exercises": [{"name": "Squat", "targetSets": 3, "targetReps": "8-12", "targetLoad": "10 kg", "restSeconds": 60}]}}})
        self.check("Real private routine source insertion", status == 201)
        preview = self.ok_rpc(a, "community_routines", "preview", {"sourceWorkoutId": routine_id, "title": "Strength"})
        share = self.ok_rpc(a, "community_routines", "publish", {"sourceWorkoutId": routine_id, "sourceUpdatedAt": preview["sourceUpdatedAt"], "snapshot": preview["snapshot"], "confirmed": True, "operationId": str(uuid.uuid4())})
        self.check("Real routine projection excludes private health/source metadata", "PRIVATE" not in json.dumps(share) and "sourceWorkoutId" not in share)
        self.ok_rpc(b, "community_routines", "get", {"id": share["id"]})
        imported = self.ok_rpc(b, "community_routines", "import", {"id": share["id"], "version": 1, "confirmed": True})
        self.check("Real private independent import retry", self.ok_rpc(b, "community_routines", "import", {"id": share["id"], "version": 1, "confirmed": True})["workoutId"] == imported["workoutId"])
        for token, label in ((None, "Anonymous"), (c, "Unrelated")):
            self.denied_rpc(token, "community_routines", "get", {"id": share["id"]}, label + " routine denied")
        self.service_write("PATCH", "community_profiles?user_id=eq." + ua, {"is_searchable": True})
        self.ok_rpc(a, "community_broader_discovery_rpc", "preferences", {"enabled": True})
        discovery = self.ok_rpc(c, "community_broader_discovery_rpc", "search", {"prefix": profiles[0]["handle"]})
        self.check("Real discovery uses separate opt-in minimal projection", len(discovery["profiles"]) == 1 and "bio" not in discovery["profiles"][0])
        self.denied_rpc(None, "community_broader_discovery_rpc", "search", {"prefix": profiles[0]["handle"]}, "Anonymous broader discovery denied")
        self.media(people, staff)
        # Media restores only synthetic edges removed by its block regression.
        status, _ = self.request("POST", "/rest/v1/community_blocks", b, {"blocker_user_id": ub, "blocked_user_id": ua})
        self.check("Real synthetic bilateral block", status == 201)
        self.denied_rpc(b, "community_messaging_rpc", "list", {"peerId": ua}, "Real block revokes thread")
        self.denied_rpc(b, "community_comments", "list", {"activityId": activity}, "Real block revokes comments")
        self.denied_rpc(b, "community_challenges_rpc", "get", {"id": cid}, "Real block revokes challenge")
        self.denied_rpc(b, "community_routines", "get", {"id": share["id"]}, "Real block revokes routine")
        self.denied_rpc(b, "community_groups_rpc", "read", {"groupId": gid}, "Block of group owner denies protected group page")
        self.service_write("DELETE", "community_broader_discovery_usage?user_id=eq." + ub)
        hidden = self.ok_rpc(b, "community_broader_discovery_rpc", "search", {"prefix": profiles[0]["handle"]})
        self.check("Real block revokes separate discovery result", hidden["profiles"] == [])
        self.ok_rpc(a, "community_withdraw_profile", body={})
        for name, operation, args in (("community_messaging_rpc", "list", {"peerId": ub}), ("community_comments", "list", {"activityId": activity}), ("community_challenges_rpc", "get", {"id": cid}), ("community_routines", "get", {"id": share["id"]}), ("community_broader_discovery_rpc", "search", {"prefix": profiles[0]["handle"]})):
            self.denied_rpc(a, name, operation, args, "Withdrawn principal denied " + name)
        own_groups = self.ok_rpc(a, "community_groups_rpc", "list")
        self.check("Withdrawn group management exposes only generic label", all(g["name"] == "Private group" for g in own_groups["groups"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disposable-local-stack", action="store_true")
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    if not args.disposable_local_stack:
        parser.error("Explicit --disposable-local-stack attestation required")
    try:
        info = args.config.stat()
        if info.st_mode & 0o077 or info.st_uid != os.getuid():
            raise BoundaryFailure("Config must be owner-only (0600)")
        suite = ExpansionSuite(json.loads(args.config.read_text()))
        try:
            suite.run()
            print("Community expansion real Auth/PostgREST assertions passed:", len(suite.passed))
        finally:
            suite.cleanup()
    except BoundaryFailure as error:
        print("Community expansion acceptance failed:", error, file=sys.stderr)
        return 1
    except Exception:
        print("Community expansion acceptance failed; inspect isolated services without exposing credentials", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
