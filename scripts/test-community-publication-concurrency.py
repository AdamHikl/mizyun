#!/usr/bin/env python3
"""Synthetic publication races; coordinator-owned isolated local scratch only."""
import concurrent.futures
import subprocess
import uuid

DATABASE = 'mizyun_issue144145_scratch'
CONTAINER = 'supabase_db_mizyun'

def sql(statement):
    return subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DATABASE, '-v', 'ON_ERROR_STOP=1', '-At'], input=statement, text=True, capture_output=True)

def checked(statement):
    result = sql(statement)
    assert result.returncode == 0, result.stderr[-500:]
    return result.stdout.strip()

def race(statements):
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        return list(pool.map(sql, statements))

users = []
try:
    for mode in ['same-operation', 'two-confirmations', 'source-delete']:
        user, workout, operation = (str(uuid.uuid4()) for _ in range(3))
        users.append(user)
        checked(f"insert into auth.users(id,email) values('{user}','{user}@mizyun.test'); update public.profiles set birth_year=1990 where id='{user}'; insert into public.workouts(id,user_id,name,started_at,completed_at,details) values('{workout}','{user}','Synthetic private source',now()-interval '1 hour',now(),'{{\"workoutLifecycle\":{{\"kind\":\"session\"}}}}');")
        auth = f"begin; set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='{user}';"
        checked(auth + f"select * from public.community_save_profile('race_{uuid.uuid4().hex[:16]}','Synthetic','SY',null,false,true,'2026-09-30'); commit;")
        def publish(op):
            return auth + f"select version from public.community_publish_activity('{workout}','other',(now() at time zone 'UTC')::date::text,null,1,'{op}',0,false); commit;"
        if mode == 'same-operation':
            results = race([publish(operation), publish(operation)])
            assert all(r.returncode == 0 for r in results), 'Same operation replay failed'
            assert checked(f"select count(*) from public.shared_activities where user_id='{user}';") == '1'
            assert checked(f"select used from public.community_publication_usage where user_id='{user}';") == '1'
            print('PASS: simultaneous lost-response retries create one version/card and consume one quota unit')
        elif mode == 'two-confirmations':
            results = race([publish(operation), publish(str(uuid.uuid4()))])
            assert sum(r.returncode == 0 for r in results) == 1, 'Stale preview race has multiple winners'
            assert any('community_conflict' in r.stderr for r in results), 'Expected CAS conflict missing'
            assert checked(f"select count(*) from public.shared_activities where user_id='{user}';") == '1'
            print('PASS: competing initial confirmations have exactly one winner and one stale-preview rejection')
        else:
            results = race([publish(operation), auth + f"delete from public.workouts where id='{workout}'; commit;"])
            assert results[1].returncode == 0, 'Source deletion failed'
            assert results[0].returncode == 0 or 'community_unavailable' in results[0].stderr
            assert checked(f"select count(*) from public.shared_activities where user_id='{user}';") == '0'
            print('PASS: source deletion racing publication leaves no card or subsequent owner delivery')
finally:
    for user in users:
        checked(f"delete from auth.users where id='{user}';")
    print(f'Synthetic scratch accounts removed: {len(users)}')
