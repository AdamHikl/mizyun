#!/usr/bin/env python3
"""Synthetic concurrency proof in a coordinator-created isolated local scratch DB."""
import concurrent.futures
import subprocess
import uuid

DATABASE = 'mizyun_issue142_scratch'
CONTAINER = 'supabase_db_mizyun'

def sql(statement):
    return subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DATABASE, '-v', 'ON_ERROR_STOP=1', '-At'], input=statement, text=True, capture_output=True)

users = [str(uuid.uuid4()), str(uuid.uuid4())]
handle = 'race_' + uuid.uuid4().hex[:16]
try:
    for user in users:
        result = sql(f"insert into auth.users(id,email) values('{user}','{user}@mizyun.test'); update public.profiles set birth_year=1990 where id='{user}';")
        assert result.returncode == 0, 'Scratch fixture creation failed'
    def claim(user):
        return sql(f"begin; set local role authenticated; set local request.jwt.claim.sub = '{user}'; select generation from public.community_save_profile('{handle}','Synthetic participant','SP',null,false,true,'2026-09-30'); commit;")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(claim, users))
    assert sum(r.returncode == 0 for r in results) == 1, 'Concurrent equivalent handles did not have exactly one claimant'
    rejected = next(r for r in results if r.returncode != 0)
    assert 'community_handle_taken' in rejected.stderr, 'Unexpected loser result'
    count = sql(f"select count(*) from public.community_profiles where handle='{handle}';")
    assert count.returncode == 0 and count.stdout.strip() == '1', 'Duplicate claimed handle'
    print('PASS: simultaneous handle claims have exactly one winner and one HANDLE_TAKEN rejection')
finally:
    for user in users:
        result = sql(f"delete from auth.users where id='{user}';")
        assert result.returncode == 0, 'Synthetic scratch account cleanup failed'
    print('Synthetic scratch accounts removed: 2')
