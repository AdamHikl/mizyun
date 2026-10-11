#!/usr/bin/env python3
"""Verify illustrations in a unique, schema-only LOCAL scratch; never reset shared data."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOCKET = Path.home() / ".docker/run/docker.sock"
DOCKER = ["docker", "--host", "unix://" + str(SOCKET), "exec", "-i", "supabase_db_mizyun"]
DATABASE = "mizyun_illustrations_scratch_" + uuid.uuid4().hex[:12]
MIGRATION = ROOT / "supabase/migrations/20261009120000_meal_illustrations.sql"
PRO_MIGRATION = ROOT / "supabase/migrations/20261009150000_pro_meal_visuals.sql"
TEST = ROOT / "supabase/tests/database/0039_meal_illustrations.test.sql"
PRO_TEST = ROOT / "supabase/tests/database/0040_pro_meal_visuals.test.sql"
LOGS = Path("/private/tmp/mizyun-illustrations-sql")


def run(args, data=None):
    result = subprocess.run(args, input=data, text=True, capture_output=True, timeout=90)
    if result.returncode:
        raise RuntimeError(result.stderr[-2500:])
    return result.stdout


def sql(statement, database=DATABASE):
    return run(DOCKER + ["psql", "-h", "/var/run/postgresql", "-U", "postgres", "-d", database, "-X", "-v", "ON_ERROR_STOP=1", "-qAt"], statement).strip()


def race(statements):
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(statements)) as pool:
        return list(pool.map(sql, statements))


def main():
    if not SOCKET.is_socket() or not re.fullmatch(r"mizyun_illustrations_scratch_[0-9a-f]{12}", DATABASE):
        raise RuntimeError("Local disposable scratch only; no remote fallback")
    LOGS.mkdir(parents=True, exist_ok=True)
    migrations = [MIGRATION, PRO_MIGRATION]
    tests = [ROOT / "supabase/tests/database/0034_retained_meal_photos.test.sql", TEST, PRO_TEST]
    schema = run(DOCKER + ["pg_dump", "-h", "/var/run/postgresql", "-U", "postgres", "-d", "postgres", "--schema-only", "--no-owner", "--no-privileges"])
    acl = run(DOCKER + ["pg_dump", "-h", "/var/run/postgresql", "-U", "postgres", "-d", "postgres", "--schema-only", "--no-owner"])
    grants = [line for line in acl.splitlines() if (line.startswith("GRANT ") or line.startswith("REVOKE ")) and any(scope in line for scope in (" public.", " auth.", " storage.", "SCHEMA public ", "SCHEMA auth ", "SCHEMA storage ")) and "pg_stat_" not in line]
    versions = set(sql("select version from supabase_migrations.schema_migrations", "postgres").splitlines())
    created = False
    try:
        sql("create database " + DATABASE, "postgres")
        created = True
        sql(schema)
        sql("\n".join(grants))
        sql("grant usage on schema public,auth,extensions to authenticated,anon,service_role;grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;")
        # Bring the empty scratch to current prerequisites without touching the source stack.
        prerequisites = []
        for path in sorted((ROOT / "supabase/migrations").glob("*.sql")):
            if path not in migrations and path.name.split("_", 1)[0] not in versions:
                sql("begin;" + path.read_text() + "commit;")
                prerequisites.append(path.name)
        # Replays the new feature even if its migration is already in the schema source.
        sql("drop table if exists public.meal_illustrations,public.meal_illustration_user_usage,public.meal_illustration_environment_usage cascade;alter table public.food_entries drop constraint if exists food_entries_illustration_owner_key;do $$declare f record;begin for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'meal_illustration_%' loop execute format('drop function if exists %s cascade',f.signature);end loop;end $$;")
        for path in migrations:
            sql("begin;" + path.read_text() + "commit;")
        print("PASS: forward illustration migration in schema-only local scratch", flush=True)
        sql("insert into storage.buckets(id,name,public) values('private-media','private-media',false) on conflict(id) do nothing;")
        output = "\n".join(sql(path.read_text()) for path in tests)
        (LOGS / "pgtap.log").write_text(output + "\n")
        plans = re.findall(r"1\.\.(\d+)", output)
        if not plans or "not ok" in output or "Looks like" in output:
            raise AssertionError("pgTAP failure; see " + str(LOGS / "pgtap.log"))
        assertions = sum(int(plan) for plan in plans)
        print("PASS: pgTAP " + str(assertions) + " assertions across all three suites", flush=True)
        consent_source = (ROOT / "packages/contracts/src/account.ts").read_text()
        version = re.search(r'CURRENT_AI_CONSENT_VERSION\s*=\s*"([^"]+)"', consent_source).group(1)
        users = [str(uuid.uuid4()) for _ in range(3)]
        meals = [str(uuid.uuid4()) for _ in range(3)]
        for user, meal in zip(users, meals):
            sql(f"set request.jwt.claim.role='service_role';insert into auth.users(id,email) values('{user}','{user}@synthetic.invalid');update public.profiles set birth_year=1990,plan_tier='paid' where id='{user}';insert into public.user_ai_consents(user_id,consent_version,granted,confirmed_adult) values('{user}','{version}',true,true) on conflict(user_id) do update set granted=true,confirmed_adult=true,consent_version=excluded.consent_version,revoked_at=null;insert into public.food_entries(id,user_id,name,consumed_at,confirmed_by_user) values('{meal}','{user}','Synthetic unfamiliar dinner',now(),true);")

        def claim(user, meal, key):
            return f"begin;set local role service_role;select claimed from public.meal_illustration_claim('{user}','{key}','{version}','{meal}');commit;"

        key = "a" * 64
        results = race([claim(users[0], meals[0], key)] * 12)
        assert sum(result.splitlines().count("t") for result in results) == 1
        assert sql(f"select count(*)=1 from public.meal_illustrations where user_id='{users[0]}'") == "t"
        assert sql(f"select attempts=1 from public.meal_illustration_user_usage where user_id='{users[0]}'") == "t"
        print("PASS: twelve simultaneous same-dish requests reserve exactly one attempt", flush=True)
        results = race([claim(users[1], meals[1], "b" * 64), claim(users[2], meals[2], "c" * 64)])
        assert sum(result.splitlines().count("t") for result in results) == 1
        assert sql("select count(*)=2 from public.meal_illustrations where state='generating'") == "t"
        print("PASS: simultaneous accounts cannot exceed two environment jobs", flush=True)
        # Force the ambiguous restart boundary rather than waiting on wall time.
        sql("update public.meal_illustrations set lease_until=now()-interval '1 second'")
        replay = sql(claim(users[0], meals[0], key))
        assert "t" not in replay.splitlines()
        assert sql(f"select state='unknown' from public.meal_illustrations where user_id='{users[0]}'") == "t"
        assert sql(f"select attempts=1 from public.meal_illustration_user_usage where user_id='{users[0]}'") == "t"
        print("PASS: lost/restarted dispatched result stays charged and is not generated again", flush=True)
        sql(f"delete from public.food_entries where id='{meals[0]}'")
        assert sql(f"select count(*)=0 from public.meal_illustrations where user_id='{users[0]}'") == "t"
        assert sql(f"select attempts=1 from public.meal_illustration_user_usage where user_id='{users[0]}'") == "t"
        print("PASS: source erasure removes private artwork without refunding budget", flush=True)
        sql(f"delete from auth.users where id='{users[0]}'")
        assert sql(f"select count(*)=0 from public.meal_illustration_user_usage where user_id='{users[0]}'") == "t"
        assert sql("select sum(attempts)=2 from public.meal_illustration_environment_usage") == "t"
        print("PASS: account erasure removes owned counters and preserves anonymous environment cap", flush=True)
        # Force the pass-row-first approval path while a capability read overlaps it.
        sql(f"set request.jwt.claim.role='service_role';insert into public.beta_pro_requests(user_id,email,status) values('{users[1]}','lock-probe@synthetic.invalid','pending');")
        for _ in range(3):
            sql(f"set request.jwt.claim.role='service_role';update public.beta_pro_requests set status='approved' where user_id='{users[1]}';")
            race([
                f"begin;set local lock_timeout='3s';set local statement_timeout='5s';set local request.jwt.claim.role='service_role';select status from public.beta_pro_requests where user_id='{users[1]}' for update;select pg_sleep(0.1);update public.beta_pro_requests set status='rejected' where user_id='{users[1]}';commit;",
                f"begin;set local lock_timeout='3s';set local statement_timeout='5s';set local request.jwt.claim.role='service_role';select pg_sleep(0.03);select public.meal_visuals_pro('{users[1]}');commit;",
            ])
            assert sql(f"set request.jwt.claim.role='service_role';select public.meal_visuals_pro('{users[1]}');") == "f"
        print("PASS: overlapping pass rejection and Pro reads complete without a lock cycle", flush=True)
        summary = {"database": DATABASE, "shared_records_copied": False, "scratch_only_prerequisite_migrations": prerequisites, "pgtap_assertions": assertions, "race_and_lifecycle_checks": 6, "source_sha256": {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in [*migrations, *tests, Path(__file__)]}}
        (LOGS / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    finally:
        if created:
            sql("drop database " + DATABASE, "postgres")
            print("Removed unique local scratch database", flush=True)


if __name__ == "__main__":
    main()
