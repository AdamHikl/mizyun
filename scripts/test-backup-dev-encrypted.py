#!/usr/bin/env python3
"""Network-free Dev recovery boundary tests. No Docker/systemd/real FS writes.

Run: python3 scripts/test-backup-dev-encrypted.py
Mocks prove command selection and failure handling only; they do not prove an
encrypted remote backup, actual service recovery, or successful database restore.
"""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock, call, patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("dev_backup", Path(__file__).with_name("backup-dev-encrypted.py"))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


def containers():
    entries = []
    for name in (backup.DB, *backup.WRITERS):
        entries.append({
            "Name": "/" + name,
            "Config": {"Labels": {"com.docker.compose.project": "mizyun-dev"}, "Env": []},
            "NetworkSettings": {"Networks": {"mizyun-dev_default": {}}, "Ports": {}},
            "Mounts": [], "State": {"Running": True},
        })
    entries[0]["Config"]["Env"] = ["PGDATA=/var/lib/postgresql/data"]
    entries[0]["NetworkSettings"]["Ports"] = {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "5433"}]}
    entries[0]["Mounts"] = [{"Type": "bind", "Source": str(backup.COMPOSE / "volumes/db/data"), "Destination": "/var/lib/postgresql/data"}]
    next(item for item in entries if item["Name"] == "/mizyun-dev-storage")["Mounts"] = [{"Type": "bind", "Source": str(backup.STORAGE), "Destination": "/var/lib/storage"}]
    return entries


class InspectBoundaryTests(unittest.TestCase):
    def inspect(self, entries, extra_names=(), resolve=None):
        def command(args, **unused):
            if args[:2] == ["docker", "inspect"]:
                self.assertEqual(args[2:], [backup.DB, *backup.WRITERS])
                return json.dumps(entries).encode()
            self.assertEqual(args[:3], ["docker", "ps", "-a"])
            return "\n".join((backup.DB, *backup.WRITERS, *extra_names)).encode()
        with patch.object(backup, "run", side_effect=command) as run, patch.object(Path, "resolve", resolve or (lambda path: path)):
            result = backup.inspect()
            return result, run.call_args_list

    def test_valid_verified_dev_resources_only(self):
        expected = containers()
        result, commands = self.inspect(expected)
        self.assertEqual(result, expected)
        self.assertEqual(len(commands), 2)

    def test_mixed_or_production_network_denied(self):
        for networks in ({"mizyun-dev_default": {}, "supabase_default": {}}, {"supabase_default": {}}):
            with self.subTest(networks=list(networks)):
                entries = containers()
                entries[1]["NetworkSettings"]["Networks"] = networks
                with self.assertRaisesRegex(RuntimeError, "network"):
                    self.inspect(entries)

    def test_wrong_pgdata_or_dev_subdirectory_denied(self):
        entries = containers()
        entries[0]["Config"]["Env"] = ["PGDATA=/var/lib/postgresql/data/production"]
        with self.assertRaisesRegex(RuntimeError, "data mount"):
            self.inspect(entries)
        entries = containers()
        entries[0]["Mounts"][0]["Source"] = str(backup.COMPOSE / "volumes/db/other")
        with self.assertRaisesRegex(RuntimeError, "data mount"):
            self.inspect(entries)

    def test_any_shared_or_production_bind_mount_denied(self):
        for source in ("/srv/mizyun/supabase/volumes/db/data", "/var/lib/mizyun/repo", "/var/lib/mizyun/dev/supabase/volumes-escape"):
            with self.subTest(source=source):
                entries = containers()
                entries[2]["Mounts"].append({"Type": "bind", "Source": source, "Destination": "/unexpected"})
                with self.assertRaisesRegex(RuntimeError, "escapes"):
                    self.inspect(entries)

    def test_symlink_source_and_wrong_named_volume_denied(self):
        entries = containers()
        storage = str(backup.STORAGE)
        with self.assertRaisesRegex(RuntimeError, "symlink"):
            self.inspect(entries, resolve=lambda path: Path("/production/private") if str(path) == storage else path)
        entries[0]["Mounts"].append({"Type": "volume", "Source": "/var/lib/docker/volumes/supabase_db-config/_data", "Name": "supabase_db-config", "Destination": "/etc/postgresql-custom"})
        with self.assertRaisesRegex(RuntimeError, "configuration volume"):
            self.inspect(entries)

    def test_storage_mount_port_and_unknown_writer_denied(self):
        entries = containers()
        next(item for item in entries if item["Name"] == "/mizyun-dev-storage")["Mounts"][0]["Source"] = str(backup.COMPOSE / "volumes/not-storage")
        with self.assertRaisesRegex(RuntimeError, "Storage mount"):
            self.inspect(entries)
        entries = containers()
        entries[0]["NetworkSettings"]["Ports"]["5432/tcp"][0]["HostPort"] = "5432"
        with self.assertRaisesRegex(RuntimeError, "endpoint"):
            self.inspect(entries)
        with self.assertRaisesRegex(RuntimeError, "Unknown Dev writer"):
            self.inspect(containers(), extra_names=("realtime-dev.supabase-realtime",))


class StopDependencyTests(unittest.TestCase):
    def command(self, graph, active):
        def run(args):
            if args[:2] == ["systemctl", "cat"]:
                return b"[Service]\nExecStart=/approved/dev\n"
            if args[-1] == "--value":
                return active.get(args[2], "no").encode()
            return "\n".join(name + "=" + " ".join(graph.get(args[2], {}).get(name, []))
                             for name in [arg.removeprefix("--property=") for arg in args[3:] if arg.startswith("--property=")]).encode()
        return run

    def test_real_shared_tunnel_requires_dev_api_refused_before_any_stop(self):
        graph = {"mizyun-api-dev.service": {"RequiredBy": ["cloudflared.service"]}}
        with patch.object(backup, "run", side_effect=self.command(graph, {"cloudflared.service": "active"})) as run:
            with self.assertRaisesRegex(RuntimeError, "shared dependency"):
                backup.guard_stop_dependencies()
            self.assertTrue(all(c.args[0][:2] in (["systemctl", "show"], ["systemctl", "cat"]) for c in run.call_args_list))

    def test_every_reverse_stop_edge_is_checked(self):
        for kind in ("RequiredBy", "RequisiteOf", "BoundBy", "ConsistsOf", "PropagatesStopTo"):
            with self.subTest(kind=kind), patch.object(backup, "run", side_effect=self.command(
                    {"mizyun-api-dev.service": {kind: ["shared.service"]}}, {"shared.service": "activating"})):
                with self.assertRaisesRegex(RuntimeError, "shared dependency"):
                    backup.guard_stop_dependencies()

    def test_owned_cycle_is_safe_but_inactive_shared_edge_is_refused(self):
        graph = {"mizyun-api-dev.service": {"RequiredBy": [backup.UNITS[0]]},
                 backup.UNITS[0]: {"ConsistsOf": ["mizyun-api-dev.service"]}}
        with patch.object(backup, "run", side_effect=self.command(graph, {unit: "active" for unit in backup.UNITS})):
            backup.guard_stop_dependencies()
        graph['mizyun-api-dev.service']['RequiredBy'].append('shared.service')
        with patch.object(backup, "run", side_effect=self.command(graph, {'shared.service':'inactive'})):
            with self.assertRaisesRegex(RuntimeError, "shared dependency"):
                backup.guard_stop_dependencies()

    def test_missing_dependency_inventory_fails_closed(self):
        with patch.object(backup, "run", return_value=b"RequiredBy=\n"):
            with self.assertRaisesRegex(RuntimeError, "Cannot verify"):
                backup.guard_stop_dependencies()

    def test_unneeded_shared_dependency_and_unknown_state_fail_closed(self):
        for state in ("yes", "", "unexpected"):
            with self.subTest(state=state), patch.object(backup, "run", side_effect=self.command(
                    {"mizyun-api-dev.service": {"Requires": ["shared.service"]}}, {"shared.service": state})):
                with self.assertRaisesRegex(RuntimeError, "dependency"):
                    backup.guard_stop_dependencies()

    def test_custom_stop_and_completion_hooks_are_refused(self):
        for kind in ("ExecStop", "ExecStopPost", "OnSuccess", "OnFailure"):
            with self.subTest(kind=kind), patch.object(backup, "run", side_effect=self.command(
                    {"mizyun-api-dev.service": {kind: ["unreviewed-handler"]}}, {})):
                with self.assertRaisesRegex(RuntimeError, "hooks"):
                    backup.guard_stop_dependencies()

    def test_stop_directive_in_dropin_is_refused_even_when_property_omitted(self):
        original = self.command({}, {})
        def command(args):
            if args[:2] == ["systemctl", "cat"]:
                return b"[Service]\nExecStopPost=/unreviewed/shared-script\n"
            return original(args)
        with patch.object(backup, "run", side_effect=command):
            with self.assertRaisesRegex(RuntimeError, "hooks"):
                backup.guard_stop_dependencies()


class ResumeBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.saved = {
            "units": ["mizyun-community-dev-maintenance.timer", "mizyun-api-dev.service"],
            "containers": ["mizyun-dev-auth", "mizyun-dev-rest"],
            "plain": str(backup.ROOT / ".plain-synthetic"),
        }
        self.state = Mock()
        self.state.exists.return_value = True
        self.state.is_symlink.return_value = False
        self.state.stat.return_value = SimpleNamespace(st_uid=0, st_mode=stat.S_IFREG | 0o600)
        self.state.read_text.side_effect = lambda: json.dumps(self.saved)
        self.plain = Mock()
        self.plain.parent = backup.ROOT
        self.plain.name = ".plain-synthetic"
        self.plain.is_symlink.return_value = False
        self.plain.exists.return_value = True
        self.response = MagicMock()
        self.response.__enter__.return_value = SimpleNamespace(status=200)
        self.opener = Mock()
        self.opener.open.return_value = self.response

    def run_resume(self, run, error=None):
        with patch.object(backup, "STATE", self.state), patch.object(backup, "Path", return_value=self.plain), patch.object(backup, "run", run), patch.object(backup.shutil, "rmtree") as erase, patch.object(backup.urllib.request, "build_opener", return_value=self.opener), patch.object(backup.time, "sleep"), patch.object(backup.os, "open", return_value=19), patch.object(backup.os, "fsync"), patch.object(backup.os, "close"):
            if error:
                with self.assertRaisesRegex(RuntimeError, error):
                    backup.resume_saved()
            else:
                backup.resume_saved()
            return erase

    def expected_starts(self):
        return [call(["docker", "start", "mizyun-dev-rest"]), call(["docker", "start", "mizyun-dev-auth"]), call(["systemctl", "start", "mizyun-api-dev.service"]), call(["systemctl", "start", "mizyun-community-dev-maintenance.timer"])]

    def test_lost_restart_response_attempts_all_and_retains_state_after_plaintext_removal(self):
        def restart(args):
            if args == ["docker", "start", "mizyun-dev-rest"]:
                raise TimeoutError("Response lost after container started")
            return b""
        run = Mock(side_effect=restart)
        erase = self.run_resume(run, error="state retained")
        self.assertEqual(run.call_args_list, self.expected_starts())
        erase.assert_called_once_with(self.plain)
        self.state.unlink.assert_not_called()
        self.opener.open.assert_called_once_with("http://127.0.0.1:4100/v1/health", timeout=2)

    def test_successful_recovery_clears_plaintext_and_state_only_for_saved_active_resources(self):
        run = Mock(return_value=b"")
        erase = self.run_resume(run)
        self.assertEqual(run.call_args_list, self.expected_starts())
        self.assertFalse(any("mizyun-api.service" in args[0][0] for args in run.call_args_list))
        erase.assert_called_once_with(self.plain)
        self.state.unlink.assert_called_once_with()

    def test_health_failure_still_removes_plaintext_and_retains_retry_state(self):
        self.opener.open.side_effect = TimeoutError("Health unavailable")
        run = Mock(return_value=b"")
        erase = self.run_resume(run, error="state retained")
        self.assertEqual(run.call_args_list, self.expected_starts())
        self.assertEqual(self.opener.open.call_count, 30)
        erase.assert_called_once_with(self.plain)
        self.state.unlink.assert_not_called()

    def test_invalid_saved_production_resource_and_staging_link_rejected_without_commands(self):
        for key, value in (("units", "mizyun-api.service"), ("containers", "supabase-db")):
            with self.subTest(key=key):
                original = copy.deepcopy(self.saved)
                self.saved[key].append(value)
                run = Mock()
                self.run_resume(run, error="resources")
                run.assert_not_called()
                self.saved = original
        self.plain.is_symlink.return_value = True
        run = Mock()
        self.run_resume(run, error="staging")
        run.assert_not_called()

    def test_absent_state_is_idempotent_and_bad_owner_mode_rejected(self):
        self.state.exists.return_value = False
        run = Mock()
        erase = self.run_resume(run)
        run.assert_not_called()
        erase.assert_not_called()
        self.state.exists.return_value = True
        for uid, mode in ((501, 0o600), (0, 0o604)):
            with self.subTest(uid=uid, mode=mode):
                self.state.stat.return_value = SimpleNamespace(st_uid=uid, st_mode=stat.S_IFREG | mode)
                self.run_resume(run, error="state")
                run.assert_not_called()


class StreamAndJournalTests(unittest.TestCase):
    def test_large_file_hash_reads_fixed_chunks_never_whole_file(self):
        payload = b"sensitive-synthetic-archive" * 150_000
        reads = []
        class BoundedReader(io.BytesIO):
            def read(self, size=-1):
                reads.append(size)
                if size != 1024 * 1024:
                    raise AssertionError("Unbounded archive read")
                return super().read(size)
        reader = BoundedReader(payload)
        path = Mock()
        path.open.return_value = reader
        path.read_bytes.side_effect = AssertionError("Whole-file read forbidden")
        self.assertEqual(backup.digest(path), hashlib.sha256(payload).hexdigest())
        self.assertGreater(len(reads), 4)
        path.open.assert_called_once_with("rb")
        path.read_bytes.assert_not_called()

    def test_active_state_is_flushed_atomic_and_directory_synced_before_stop(self):
        root, temporary, state, stream = MagicMock(), MagicMock(), MagicMock(), MagicMock()
        root.__truediv__.return_value = temporary
        temporary.open.return_value.__enter__.return_value = stream
        stream.fileno.return_value = 11
        with patch.object(backup, "ROOT", root), patch.object(backup, "STATE", state), patch.object(backup.os, "open", return_value=22) as opened, patch.object(backup.os, "fsync") as sync, patch.object(backup.os, "close") as closed:
            backup.save_state({"units": ["mizyun-api-dev.service"], "containers": [], "plain": "/synthetic"})
        stream.flush.assert_called_once_with()
        self.assertEqual(sync.call_args_list, [call(11), call(22)])
        temporary.replace.assert_called_once_with(state)
        opened.assert_called_once_with(root, backup.os.O_RDONLY | backup.os.O_DIRECTORY)
        closed.assert_called_once_with(22)


if __name__ == "__main__":
    unittest.main()
