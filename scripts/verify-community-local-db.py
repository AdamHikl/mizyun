#!/usr/bin/env python3
"""Verify current Community migrations in an empty Mac scratch database.

Reads only schema, application grants and migration version numbers from the
local disposable Supabase stack. Never copies user records or targets a remote
host. All fixture/control changes and concurrency checks run in the scratch;
the shared local database is never reset. Docker is required.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = "supabase_db_mizyun"


def command(args, stdin=None):
    if args[0] == "docker":
        # Never inherit a remote Docker context for disposable Mac verification.
        args = ["docker", "--host", "unix://" + str(Path.home() / ".docker/run/docker.sock"), *args[1:]]
    environment = dict(os.environ)
    for option in ("DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"):
        environment.pop(option, None)
    environment["DOCKER_HOST"] = "unix://" + str(Path.home() / ".docker/run/docker.sock")
    result = subprocess.run(args, input=stdin, text=True, capture_output=True, cwd=ROOT, env=environment)
    if result.returncode:
        # Database output can contain synthetic identifiers, never credentials.
        raise RuntimeError(result.stderr[-2000:])
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--logs", type=Path, required=True)
    parser.add_argument("--test", action="append", default=[],
                        help="Run only this database or scratch test filename; repeat to select more")
    parser.add_argument("--skip-concurrency", action="store_true",
                        help="Skip unchanged concurrency suites for focused verification")
    parser.add_argument("--keep-scratch", action="store_true",
                        help="Keep isolated scratch for subsequent local transport verification")
    args = parser.parse_args()
    args.logs.mkdir(parents=True, exist_ok=True)
    db = "mizyun_community_verify_" + uuid.uuid4().hex[:12]

    def sql(statement, database=db):
        return command(["docker", "exec", "-i", CONTAINER, "psql", "-U", "postgres",
                        "-d", database, "-X", "-v", "ON_ERROR_STOP=1", "-At"], statement)

    versions = set(sql("select version from supabase_migrations.schema_migrations;", "postgres").splitlines())
    foundation = {"20260930100000", "20260930110000", "20260930120000"}
    if not foundation <= versions:
        raise RuntimeError("Local stack must contain the reviewed Community foundation migrations")
    schema = command(["docker", "exec", CONTAINER, "pg_dump", "-U", "postgres", "-d", "postgres",
                      "--schema-only", "--no-owner", "--no-privileges"])
    acl = command(["docker", "exec", CONTAINER, "pg_dump", "-U", "postgres", "-d", "postgres",
                   "--schema-only", "--no-owner"])
    grants = [line for line in acl.splitlines() if
              (line.startswith("GRANT ") or line.startswith("REVOKE ")) and
              any(scope in line for scope in (" public.", " auth.", " storage.", "SCHEMA public ", "SCHEMA auth ", "SCHEMA storage ")) and
              "pg_stat_" not in line]
    sql("create database " + db + ";", "postgres")
    accepted = False
    try:
        sql(schema)
        sql("\n".join(grants))
        sql("grant usage on schema extensions to authenticated,anon,service_role;")
        applied = []
        source_hashes = {}
        for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
            version = migration.name.split("_", 1)[0]
            if version not in versions:
                source = migration.read_text()
                source_hashes[str(migration.relative_to(ROOT))] = hashlib.sha256(source.encode()).hexdigest()
                sql(source)
                applied.append(version)
        sql("insert into storage.buckets(id,name,public) values('private-media','private-media',false) on conflict do nothing;")
        sql("insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('community-media','community-media',false,2097152,array['image/jpeg']) on conflict do nothing;")
        # Schema-only copies omit migration seed rows when the source stack has
        # already applied those migrations. Seed controls only in this scratch;
        # each test still explicitly chooses its synthetic enabled/closed state.
        sql("insert into public.community_operations(singleton) values(true) on conflict do nothing;")
        sql("insert into public.community_feature_controls(feature) values('comments'),('groups'),('challenges'),('messaging'),('media'),('routines'),('discovery') on conflict do nothing;")
        total = 0
        tests = sorted((ROOT / "supabase/tests/database").glob("*.sql"))
        if args.test:
            # Multi-transaction fixtures belong only to this isolated harness,
            # never the default db:test inventory in the shared local postgres.
            available = [*tests, *sorted((ROOT / "supabase/tests/scratch").glob("*.sql"))]
            selected = set(args.test)
            if not selected <= {test.name for test in available}:
                raise RuntimeError("Unknown database or scratch test filename")
            tests = [test for test in available if test.name in selected]
        for test in tests:
            source = test.read_text()
            source_hashes[str(test.relative_to(ROOT))] = hashlib.sha256(source.encode()).hexdigest()
            output = sql(source)
            (args.logs / (test.name + ".log")).write_text(output)
            plans = re.findall(r"1\.\.(\d+)", output)
            if "not ok" in output or not plans or "Looks like" in output:
                raise RuntimeError("Failed assertions/plan: " + test.name)
            total += int(plans[-1])
            print(test.name, plans[-1], "PASS", flush=True)
        sql("update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,cohort_required=false;")
        concurrency = sorted((ROOT / "scripts").glob("test-community-*-concurrency.py"))
        for script in ([] if args.skip_concurrency else [ROOT / "scripts/test-community-capacity.py", *concurrency]):
            source = script.read_text()
            source_hashes[str(script.relative_to(ROOT))] = hashlib.sha256(source.encode()).hexdigest()
            source, replaced = re.subn(r"DATABASE\s*=\s*['\"][^'\"]+['\"]", "DATABASE='" + db + "'", source)
            if replaced != 1:
                raise RuntimeError("Scratch target missing/ambiguous: " + script.name)
            output = command(["python3", "-c", source])
            (args.logs / (script.name + ".log")).write_text(output)
            print(output.strip(), flush=True)
        summary = {"scratch_database": db, "base_migrations": sorted(versions),
                   "applied_migrations": applied, "assertions": total, "sql_files": len(tests),
                   "shared_user_data_copied": False, "kept_for_transport": args.keep_scratch,
                   "concurrency_skipped": args.skip_concurrency, "source_sha256": source_hashes}
        (args.logs / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
        print(json.dumps(summary), flush=True)
        accepted = True
    finally:
        if not (accepted and args.keep_scratch):
            sql("drop database " + db + ";", "postgres")
            print("Removed isolated scratch database", flush=True)


if __name__ == "__main__":
    main()
