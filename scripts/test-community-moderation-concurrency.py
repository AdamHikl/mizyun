#!/usr/bin/env python3
"""Coordinator-owned synthetic races in an already prepared empty Mac scratch DB."""
import concurrent.futures
import subprocess
import uuid

DATABASE = 'mizyun_issue148_scratch'
CONTAINER = 'supabase_db_mizyun'

def sql(statement):
    return subprocess.run(['docker','exec','-i',CONTAINER,'psql','-U','postgres','-d',DATABASE,'-v','ON_ERROR_STOP=1','-At'], input=statement,text=True,capture_output=True)

def actor(user, statement, staff=False):
    return sql(f"begin; set local role authenticated; set local request.jwt.claim.sub='{user}'; set local request.jwt.claims='{{\"aal\":\"{'aal2' if staff else 'aal1'}\"}}'; {statement} commit;")

users=[str(uuid.uuid4()) for _ in range(15)]
reporter,staff_a,staff_b,*targets=users
try:
    for i,user in enumerate(users):
        result=sql(f"insert into auth.users(id,email) values('{user}','{user}@mizyun.test'); update public.profiles set birth_year=1990 where id='{user}'; insert into public.community_profiles(user_id,handle,display_name,is_searchable,status,terms_version,terms_accepted_at,adult_declared_at) values('{user}','race_{uuid.uuid4().hex[:16]}','Synthetic member',true,'active','2026-09-30',now(),now());")
        assert result.returncode==0,result.stderr
    assert sql(f"insert into public.community_moderation_staff(user_id,active) values('{staff_a}',true),('{staff_b}',true);").returncode==0
    def submit(target):
        return actor(reporter,f"select id from public.community_submit_report('profile','{target}','spam');")
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        results=list(pool.map(submit,targets))
    assert sum(r.returncode==0 for r in results)==10,'Concurrent reports did not admit exactly ten cases'
    assert all('community_rate_limited' in r.stderr for r in results if r.returncode),'Unexpected quota rejection'
    count=sql(f"select count(*) from public.community_reports where reporter_user_id='{reporter}'; select report_count from public.community_report_usage where user_id='{reporter}';")
    assert count.returncode==0 and count.stdout.strip().splitlines()==['10','10'],count.stdout
    print('PASS: twelve concurrent distinct reports create exactly ten cases and a quota of ten')
    report=sql(f"select id from public.community_reports where reporter_user_id='{reporter}' order by id limit 1;").stdout.strip()
    def claim(user):
        return actor(user,f"select id from public.community_claim_report('{report}');",True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        claims=list(pool.map(claim,[staff_a,staff_b]))
    assert sum(r.returncode==0 for r in claims)==1,'Two operators claimed the same report'
    assert 'community_conflict' in next(r for r in claims if r.returncode).stderr
    print('PASS: concurrent staff claims have exactly one assigned operator')
finally:
    for user in users:
        assert sql(f"delete from auth.users where id='{user}';").returncode==0,'Synthetic Auth cleanup failed'
    print(f'Synthetic scratch accounts removed: {len(users)}')
