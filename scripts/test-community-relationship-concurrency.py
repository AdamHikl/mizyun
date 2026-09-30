#!/usr/bin/env python3
"""Synthetic transaction races; coordinator must prepare this empty local scratch DB."""
import concurrent.futures
import subprocess
import uuid

DATABASE = 'mizyun_issue143_scratch'
CONTAINER = 'supabase_db_mizyun'
users = []

def sql(statement):
    return subprocess.run(['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DATABASE, '-v', 'ON_ERROR_STOP=1', '-At'], input=statement, text=True, capture_output=True)

def checked(statement):
    result = sql(statement)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()

def member():
    user = str(uuid.uuid4())
    users.append(user)
    checked(f"insert into auth.users(id,email) values('{user}','{user}@mizyun.test'); update public.profiles set birth_year=1990 where id='{user}';")
    checked(actor(user, f"select generation from public.community_save_profile('race_{uuid.uuid4().hex[:16]}','Synthetic member','SM',null,true,true,'2026-09-30');"))
    return user

def actor(user, statement):
    return f"begin; set local role authenticated; set local request.jwt.claim.role='authenticated'; set local request.jwt.claim.sub='{user}'; {statement} commit;"

def race(*statements):
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(statements)) as pool:
        results = list(pool.map(sql, statements))
    assert not any('deadlock' in r.stderr.lower() for r in results), 'Transaction deadlock'
    return results

def request(a, b, operation=None):
    return actor(a, f"select id from public.community_request_follow('{b}',null,'{operation or uuid.uuid4()}');")

try:
    a, b = member(), member()
    operation = str(uuid.uuid4())
    results = race(request(a,b,operation),request(a,b,operation))
    assert all(r.returncode == 0 for r in results), 'Duplicate request failed'
    edge = checked(f"select id from public.community_relationships where follower_user_id='{a}' and target_user_id='{b}';")
    assert results[0].stdout == results[1].stdout, 'Duplicate operation returned different edge'
    print('PASS: simultaneous duplicate operations return one pending edge')
    checked(request(b,a))
    checked(actor(b,f"update public.community_relationships set status='approved' where id='{edge}';"))
    assert checked(f"select string_agg(status,',' order by follower_user_id='{a}' desc) from public.community_relationships where follower_user_id in ('{a}','{b}');") == 'approved,pending'
    print('PASS: crossed requests remain independent approvals')
    for danger in ('cancel','block','withdraw','delete'):
        a,b=member(),member()
        checked(request(a,b))
        edge=checked(f"select id from public.community_relationships where follower_user_id='{a}' and target_user_id='{b}';")
        approve=actor(b,f"update public.community_relationships set status='approved' where id='{edge}';")
        opposing={
            'cancel':actor(a,f"update public.community_relationships set status='canceled' where id='{edge}';"),
            'block':actor(a,f"insert into public.community_blocks(blocker_user_id,blocked_user_id) values('{a}','{b}');"),
            'withdraw':actor(b,"select public.community_withdraw_profile();"),
            'delete':f"delete from auth.users where id='{b}';",
        }[danger]
        results=race(approve,opposing)
        assert all(r.returncode==0 or 'community_unavailable' in r.stderr for r in results), 'Unexpected race rejection'
        count=checked(f"select count(*) from public.community_relationships where id='{edge}' and status='approved';")
        if danger=='cancel':
            assert count=='0' or results[1].returncode!=0, 'Cancel acknowledged but approval survived'
        else:
            assert results[1].returncode==0 and count=='0', 'Forbidden approved relationship survived'
        print('PASS: approval racing',danger,'has no forbidden approved edge')
    target=member()
    for _ in range(29):
        follower=member()
        checked(f"insert into public.community_relationships(follower_user_id,target_user_id,status) values('{follower}','{target}','approved');")
    pending=[member(),member()]
    edges=[]
    for follower in pending:
        checked(request(follower,target))
        edges.append(checked(f"select id from public.community_relationships where follower_user_id='{follower}' and target_user_id='{target}';"))
    results=race(*(actor(target,f"update public.community_relationships set status='approved' where id='{edge}';") for edge in edges))
    assert sum(r.returncode==0 for r in results)==1 and any('community_rate_limited' in r.stderr for r in results), 'Cap race did not reject exactly one approval'
    assert checked(f"select count(*) from public.community_relationships where target_user_id='{target}' and status='approved';")=='30'
    print('PASS: concurrent approval at follower cap admits exactly one')
finally:
    for user in users:
        checked(f"delete from auth.users where id='{user}';")
    print('Synthetic scratch accounts removed:',len(users))
