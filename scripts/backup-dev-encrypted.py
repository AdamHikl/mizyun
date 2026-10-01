#!/usr/bin/env python3
"""Root-only consistent, encrypted pre-migration Dev recovery point.

Run through the Hetzner Ops alias. No environment overrides, shared tunnel
restart, Production resource, deletion/retention, or private age key is used.
The standard isolated backup verifier accepts the resulting .age file.
"""
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import signal
import shutil
import stat
import subprocess
import tempfile
import time
import urllib.request

ROLE = "hetzner-primary-1d36b436-f4d5-4a29-b249-4153975563f3"
REPO = Path("/var/lib/mizyun/dev/repo")
COMPOSE = Path("/var/lib/mizyun/dev/supabase")
STORAGE = COMPOSE / "volumes/storage"
ROOT = Path("/var/lib/mizyun/dev/recovery")
DB = "mizyun-dev-db"
WRITERS = ("mizyun-dev-kong", "mizyun-dev-auth", "mizyun-dev-rest",
           "mizyun-dev-storage", "mizyun-dev-imgproxy")
UNITS = ("mizyun-community-dev-maintenance.timer",
         "mizyun-community-dev-maintenance.service", "mizyun-api-dev.service")
STATE = ROOT / "active-state.json"


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def save_state(value):
    temporary = ROOT / "active-state.tmp"
    with temporary.open("w") as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(STATE)
    directory = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY)
    os.fsync(directory)
    os.close(directory)


def resume_saved():
    if not STATE.exists():
        return
    if STATE.is_symlink() or STATE.stat().st_uid != 0 or stat.S_IMODE(STATE.stat().st_mode) != 0o600:
        raise RuntimeError("Invalid recovery state")
    state = json.loads(STATE.read_text())
    if not set(state["units"]) <= set(UNITS) or not set(state["containers"]) <= set(WRITERS):
        raise RuntimeError("Invalid recovery resources")
    plain = Path(state["plain"])
    if plain.parent != ROOT or not plain.name.startswith(".plain-") or plain.is_symlink():
        raise RuntimeError("Invalid plaintext staging path")
    resumed = True
    for name in reversed(state["containers"]):
        try:
            run(["docker", "start", name])
        except Exception:
            resumed = False
    for unit in reversed(state["units"]):
        try:
            run(["systemctl", "start", unit])
        except Exception:
            resumed = False
    if "mizyun-api-dev.service" in state["units"]:
        healthy = False
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for _ in range(30):
            try:
                with opener.open("http://127.0.0.1:4100/v1/health", timeout=2) as response:
                    healthy = response.status == 200
                if healthy:
                    break
            except Exception:
                pass
            time.sleep(1)
        resumed = resumed and healthy
    if plain.exists():
        shutil.rmtree(plain)
    if not resumed:
        raise RuntimeError("A previously active Dev resource failed to resume; recovery state retained")
    STATE.unlink()
    directory = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY)
    os.fsync(directory)
    os.close(directory)


def run(args, *, cwd=None, output=None, timeout=180):
    result = subprocess.run(args, cwd=cwd, stdout=output or subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        raise RuntimeError("Dev recovery command failed: " + args[0])
    return result.stdout or b""


def inspect():
    entries = json.loads(run(["docker", "inspect", DB, *WRITERS]))
    for item in entries:
        if item["Config"]["Labels"].get("com.docker.compose.project") != "mizyun-dev":
            raise RuntimeError("Dev compose identity mismatch")
        if set(item["NetworkSettings"]["Networks"]) != {"mizyun-dev_default"}:
            raise RuntimeError("Dev network identity mismatch")
        for mount in item["Mounts"]:
            source = Path(mount["Source"])
            if source.resolve() != source:
                raise RuntimeError("Dev mount contains symlink")
            if mount["Type"] == "bind" and not source.is_relative_to(COMPOSE / "volumes"):
                raise RuntimeError("Dev mount escapes canonical volumes")
            if mount["Type"] == "volume" and (mount.get("Name") != "mizyun-dev_db-config" or str(source) != "/var/lib/docker/volumes/mizyun-dev_db-config/_data"):
                raise RuntimeError("Dev database configuration volume mismatch")
    database = next(item for item in entries if item["Name"] == "/" + DB)
    data = [m for m in database["Mounts"] if m["Destination"] == "/var/lib/postgresql/data"]
    if len(data) != 1 or data[0]["Source"] != str(COMPOSE / "volumes/db/data") or data[0]["Type"] != "bind" or "PGDATA=/var/lib/postgresql/data" not in database["Config"]["Env"]:
        raise RuntimeError("Dev database data mount mismatch")
    if database["NetworkSettings"]["Ports"].get("5432/tcp") != [
            {"HostIp": "127.0.0.1", "HostPort": "5433"}]:
        raise RuntimeError("Dev database endpoint mismatch")
    media = next(item for item in entries if item["Name"] == "/mizyun-dev-storage")
    mounts = [m for m in media["Mounts"] if m["Destination"] == "/var/lib/storage"]
    if len(mounts) != 1 or mounts[0]["Source"] != str(STORAGE) or mounts[0]["Type"] != "bind":
        raise RuntimeError("Dev Storage mount mismatch")
    project_names = set(run(["docker", "ps", "-a", "--filter", "label=com.docker.compose.project=mizyun-dev",
                             "--format", "{{.Names}}"] ).decode().splitlines())
    if project_names != {DB, *WRITERS}:
        raise RuntimeError("Unknown Dev writer; inspect before freezing")
    if not database["State"]["Running"]:
        raise RuntimeError("Dev database is stopped")
    return entries


def main():
    if os.geteuid() != 0:
        raise RuntimeError("Dev backup requires root")
    os.umask(0o077)
    role = Path("/etc/mizyun/host-role")
    if role.is_symlink() or role.stat().st_uid != 0 or role.read_text().strip() != ROLE:
        raise RuntimeError("Hetzner authority mismatch")
    for path in (REPO, COMPOSE, STORAGE):
        if path.resolve() != path or not path.is_dir():
            raise RuntimeError("Dev source path mismatch")
    # Reuse the deploy user's existing lock without replacing its owner/mode.
    lock_path = Path("/tmp/mizyun-deploy-dev.lock")
    fd = os.open(lock_path, os.O_RDWR | os.O_NOFOLLOW)
    lock_stat = os.fstat(fd)
    if not stat.S_ISREG(lock_stat.st_mode) or lock_stat.st_uid != pwd.getpwnam("mizyun-dev-deploy").pw_uid or stat.S_IMODE(lock_stat.st_mode) != 0o664 or lock_stat.st_nlink != 1:
        raise RuntimeError("Invalid Dev deployment lock")
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    entries = inspect()
    for unit in UNITS:
        directory = run(["systemctl", "show", unit, "-p", "WorkingDirectory", "--value"]).decode().strip()
        if unit.endswith(".service") and directory != str(REPO):
            raise RuntimeError("Dev unit working directory mismatch")
    if ROOT.is_symlink():
        raise RuntimeError("Invalid recovery destination")
    ROOT.mkdir(mode=0o700, exist_ok=True)
    if ROOT.resolve() != ROOT or ROOT.stat().st_uid != 0:
        raise RuntimeError("Invalid recovery destination owner")
    ROOT.chmod(0o700)
    if __import__("sys").argv[1:] == ["--resume-only"]:
        resume_saved()
        return
    if __import__("sys").argv[1:]:
        raise RuntimeError("Unexpected backup arguments")
    if STATE.exists():
        raise RuntimeError("Prior recovery state exists; resume before starting")
    if run(["git", "-c", "safe.directory=" + str(REPO), "-C", str(REPO), "status", "--porcelain"]).strip():
        raise RuntimeError("Dev checkout must be pristine")
    recipient_path = Path("/etc/mizyun/backup-age-recipient")
    if recipient_path.resolve() != recipient_path or recipient_path.stat().st_uid != 0 or recipient_path.stat().st_mode & 0o022:
        raise RuntimeError("Invalid public recipient owner/path")
    recipient = recipient_path.read_text().strip()
    if not recipient.startswith("age1") or not recipient.isalnum():
        raise RuntimeError("Invalid public age recipient")
    for command in ("age", "docker", "tar", "getfattr", "getfacl"):
        if shutil.which(command) is None:
            raise RuntimeError("Missing backup tool: " + command)
    if shutil.disk_usage(ROOT).free < 1024 * 1024 * 1024:
        raise RuntimeError("Insufficient Dev backup staging space")
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    release = ROOT / timestamp
    release.mkdir(mode=0o700)  # Never replace an existing archive.
    frozen_units, frozen_containers = [], []
    plain = Path(tempfile.mkdtemp(prefix=".plain-", dir=ROOT))
    def interrupted(_number, _frame):
        raise RuntimeError("Dev backup interrupted")
    for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(number, interrupted)
    save_state({"units": frozen_units, "containers": frozen_containers, "plain": str(plain)})
    try:
        # Remember state BEFORE stopping; resume these exact Dev resources even
        # if a stop, dump or encryption response is lost.
        for unit in UNITS:
            state = run(["systemctl", "show", unit, "-p", "ActiveState", "--value"]).decode().strip()
            if state in ("active", "activating", "reloading"):
                frozen_units.append(unit)
                save_state({"units": frozen_units, "containers": frozen_containers, "plain": str(plain)})
            run(["systemctl", "stop", unit])
        for item in entries:
            name = item["Name"][1:]
            if name in WRITERS and item["State"]["Running"]:
                frozen_containers.append(name)
                save_state({"units": frozen_units, "containers": frozen_containers, "plain": str(plain)})
                run(["docker", "stop", "--time", "30", name])
        remaining = run(["docker", "exec", DB, "psql", "-U", "supabase_admin", "-d", "postgres", "-Atc",
                         "select count(*) from pg_stat_activity where backend_type='client backend' and pid<>pg_backend_pid();"])
        if remaining.strip() != b"0":
            raise RuntimeError("Dev writers remain after freeze")
        with (plain / "database.dump").open("wb") as output:
            run(["docker", "exec", DB, "pg_dump", "-U", "supabase_admin", "-d", "postgres", "--format=custom"], output=output)
        with (plain / "database.dump").open("rb") as source:
            subprocess.run(["docker", "exec", "-i", DB, "pg_restore", "--list"], stdin=source,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=180)
        (plain / "globals.sql").write_bytes(run(["docker", "exec", DB, "pg_dumpall", "-U", "supabase_admin", "--globals-only"]))
        run(["tar", "--xattrs", "--xattrs-include=*", "--acls", "-czf", str(plain / "storage.tar.gz"), "-C", str(STORAGE.parent), "storage"])
        paths = sorted([STORAGE, *STORAGE.rglob("*")])
        files, xattrs, acls = [], [], []
        for path in paths:
            relative = str(path.relative_to(STORAGE.parent))
            if path.is_file() and not path.is_symlink():
                files.append(run(["sha256sum", "--", relative], cwd=STORAGE.parent))
            xattrs.append(run(["getfattr", "--dump", "--match=.*", "--no-dereference", relative], cwd=STORAGE.parent))
            acls.append(run(["getfacl", "--absolute-names", "--numeric", relative], cwd=STORAGE.parent))
        (plain / "storage-files.sha256").write_bytes(b"".join(files))
        (plain / "storage-xattrs.txt").write_bytes(b"".join(xattrs))
        (plain / "storage-acls.txt").write_bytes(b"".join(acls))
        config = ["etc/mizyun/dev.env", "var/lib/mizyun/dev/supabase/.env", "var/lib/mizyun/dev/supabase/docker-compose.yml"]
        if not all(Path("/" + p).is_file() for p in config):
            raise RuntimeError("Missing Dev recovery configuration")
        if any(Path("/" + p).resolve() != Path("/" + p) or Path("/" + p).stat().st_mode & 0o022 for p in config):
            raise RuntimeError("Dev configuration symlink/permissions mismatch")
        run(["tar", "--xattrs", "--acls", "-czf", str(plain / "recovery-config.tar.gz"), "-C", "/", *config])
        tables = run(["docker", "exec", DB, "psql", "-U", "supabase_admin", "-d", "postgres", "-Atc",
                      "select quote_ident(schemaname)||'.'||quote_ident(relname) from pg_stat_user_tables order by 1"]).decode().splitlines()
        counts = []
        for table in tables:
            count = run(["docker", "exec", DB, "psql", "-U", "supabase_admin", "-d", "postgres", "-Atc", "select count(*) from " + table]).decode().strip()
            counts.append(table + "\t" + count + "\n")
        (plain / "table-counts.tsv").write_text("".join(counts))
        sha = run(["git", "-c", "safe.directory=" + str(REPO), "-C", str(REPO), "rev-parse", "HEAD"]).decode().strip()
        (plain / "metadata.txt").write_text(f"created_at={timestamp}\nsource_sha={sha}\ndatabase_container={DB}\nenvironment=dev\nformat_version=1\ncommunity_restore_traffic=closed_until_revocation_reconciliation\n")
        (plain / "container-images.tsv").write_text("".join(item["Name"][1:] + "\t" + item["Config"]["Image"] + "\n" for item in entries))
        (plain / "migration-versions.txt").write_bytes(run(["docker", "exec", DB, "psql", "-U", "supabase_admin", "-d", "postgres", "-Atc", "select version from supabase_migrations.schema_migrations order by version"]))
        manifest = "".join(digest(p) + "  " + p.name + "\n" for p in sorted(plain.iterdir()))
        (plain / "PAYLOAD_SHA256SUMS").write_text(manifest)
        run(["sha256sum", "--check", "PAYLOAD_SHA256SUMS"], cwd=plain)
        archive = release / ("mizyun-dev-" + timestamp + ".tar.gz.age")
        # Both commands must succeed; plaintext never leaves the private staging.
        with subprocess.Popen(["tar", "-czf", "-", "-C", str(plain), "."], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as tar:
            subprocess.run(["age", "--encrypt", "--recipient", recipient, "--output", str(archive)],
                           stdin=tar.stdout, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=180)
            tar.stdout.close()
            if tar.wait(timeout=180):
                raise RuntimeError("Dev archive compression failed")
        ciphertext_digest = digest(archive)
        (release / "SHA256SUMS").write_text(ciphertext_digest + "  " + archive.name + "\n")
        run(["sha256sum", "--check", "SHA256SUMS"], cwd=release)
    finally:
        for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            signal.signal(number, signal.SIG_IGN)
        resume_saved()
    (release / "COMPLETE").write_text(timestamp + "\n")
    for path in release.iterdir():
        with path.open("rb") as stream:
            os.fsync(stream.fileno())
    directory = os.open(release, os.O_RDONLY | os.O_DIRECTORY)
    os.fsync(directory)
    os.close(directory)
    print(json.dumps({"environment": "dev", "source_sha": sha, "archive": str(archive),
                      "ciphertext_sha256": ciphertext_digest, "tables": len(tables)}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Dev pre-migration backup failed: " + type(error).__name__, file=__import__("sys").stderr)
        raise SystemExit(1)
