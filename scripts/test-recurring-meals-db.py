#!/usr/bin/env python3
"""Real PostgreSQL recurrence acceptance in a fresh, schema-only LOCAL scratch.
No user data is copied. Never resets or migrates the shared/remote database.
"""
import concurrent.futures
import os
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOCKET = Path.home() / '.docker/run/docker.sock'
DOCKER = ['docker', '--host', 'unix://' + str(SOCKET), 'exec', '-i', 'supabase_db_mizyun']
DATABASE = 'mizyun_recurring_scratch_' + uuid.uuid4().hex[:12]
checks = 0

def command(args, data=None):
    result = subprocess.run(args, input=data, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-2500:])
    return result.stdout

def sql(statement, database=DATABASE):
    return command(DOCKER + ['psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt'], statement).strip()

def check(statement, label):
    global checks
    out = sql(statement)
    if out.splitlines()[-1:] != ['t']:
        raise AssertionError(label + ': ' + out[-500:])
    checks += 1
    print('PASS: ' + label, flush=True)

def user(statement, uid='10000000-0000-4000-8000-000000000001'):
    return "begin;set local role authenticated;set local request.jwt.claim.sub='" + uid + "';set local request.jwt.claim.role='authenticated';" + statement + ';commit;'

def denied(statement, label, role='authenticated', uid='10000000-0000-4000-8000-000000000002', code=None):
    global checks
    result = subprocess.run(DOCKER + ['psql', '-U', 'postgres', '-d', DATABASE, '-v', 'ON_ERROR_STOP=1', '-qAt'],
        input="begin;set local role " + role + ";set local request.jwt.claim.sub='" + uid + "';set local request.jwt.claim.role='" + role + "';" + statement + ';commit;', text=True, capture_output=True)
    if result.returncode == 0 or (code and code not in result.stderr):
        raise AssertionError(label + ': ' + result.stdout[-500:] + result.stderr[-500:])
    checks += 1
    print('PASS: ' + label, flush=True)

def tick(at='2026-10-03 12:00:00+00'):
    return "set request.jwt.claim.sub='';set request.jwt.claim.role='service_role';select generated from public.recurring_meal_tick('" + at + "')"

U='10000000-0000-4000-8000-000000000001'; V='10000000-0000-4000-8000-000000000002'
F='20000000-0000-4000-8000-000000000001'; S='30000000-0000-4000-8000-000000000001'
created=False
try:
    if not SOCKET.is_socket():
        raise RuntimeError('Local Docker socket unavailable; no remote fallback permitted')
    # Schema only, no records and no global role changes. Extension ACLs are unrelated.
    schema=command(DOCKER+['pg_dump','-U','postgres','-d','postgres','--schema-only','--no-owner','--no-privileges'])
    sql('create database '+DATABASE, 'postgres'); created=True
    sql(schema)
    sql("grant usage on schema public,auth,extensions to authenticated,anon,service_role;grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;grant select,insert,update,delete on public.food_entries to authenticated;alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;")
    sql('begin;'+(ROOT/'supabase/migrations/20261003100000_recurring_meals.sql').read_text()+'commit;')
    print('PASS: forward migration with permissive Supabase function defaults',flush=True)
    sql(f"insert into auth.users(id,email) values('{U}','recurring-a@synthetic.invalid'),('{V}','recurring-b@synthetic.invalid');insert into public.food_entries(id,user_id,name,consumed_at,calories_kcal,protein_g,confirmed_by_user,details) values('{F}','{U}','Synthetic breakfast',now(),400,null,true,'{{\"portionWeightG\":100}}');")
    create=f"select id from public.recurring_meal_create('{S}','{F}','10:00','UTC',array[0,1,2,3,4,5,6])"
    sql(user(create))
    check(user(create.replace('select id','select id=\''+S+'\'')), 'same-operation replay')
    denied(f"select * from public.recurring_meal_snapshot('{U}','{F}')",'internal snapshot denied under permissive defaults')
    denied(f"select public.recurring_meal_admit('{U}')",'internal admission denied')
    denied("select * from public.recurring_meal_tick()",'ordinary user cannot run worker')
    denied(f"select * from public.recurring_meal_snapshot('{U}','{F}')",'anonymous internal snapshot denied',role='anon')
    denied(create,'foreign source denied',code='recurring_not_found')
    denied(f"select * from public.recurring_meal_create('{S}','{F}','11:00','UTC',array[6])",'changed replay conflicts',uid=U,code='recurring_conflict')
    denied(f"select * from public.recurring_meal_create(gen_random_uuid(),'{F}','25:00','UTC',array[6])",'invalid direct RPC time',uid=U,code='recurring_invalid')
    denied(f"select * from public.recurring_meal_create(gen_random_uuid(),'{F}','10:00','Unknown/Zone',array[6])",'invalid direct RPC timezone',uid=U,code='recurring_invalid')
    for zone in ['Factory','localtime','posix/Etc/UTC']:
        denied(f"select * from public.recurring_meal_create(gen_random_uuid(),'{F}','10:00','{zone}',array[6])",'non-client timezone denied '+zone,uid=U,code='recurring_invalid')
    denied(f"select * from public.recurring_meal_create(gen_random_uuid(),'{F}','10:00','UTC',array[6,6])",'duplicate weekdays denied',uid=U,code='recurring_invalid')
    check(user('select count(*)=0 from public.recurring_meal_schedules',V),'RLS hides foreign schedules')
    check(user(f"select count(*)=0 from public.recurring_meal_update('{S}','{{\"enabled\":false}}')",V),'foreign update hidden')
    check(user(f"select not ok from public.recurring_meal_stop('{S}')",V),'foreign stop denied')
    check(user(f"select not ok from public.recurring_meal_skip('{S}',current_date)",V),'foreign skip denied')
    denied(f"insert into public.recurring_meal_schedules(id,user_id,name,template,initial_request,local_time,time_zone,weekdays) values(gen_random_uuid(),'{V}','Forged','{{}}','{{}}','10:00','UTC',array[6])",'direct schedule write denied')
    # Synthetic clock fixtures are owner maintenance in scratch only.
    sql(f"update public.recurring_meal_schedules set effective_from='2026-10-01' where id='{S}';")
    check(tick().replace('select generated','select generated=1'),'tick creates one meal')
    check(tick().replace('select generated','select generated=0'),'duplicate tick creates nothing')
    check(f"select protein_g is null and calories_kcal=400 and details->'recurringMeal'->>'scheduleId'='{S}' from public.food_entries where id=(select food_entry_id from public.recurring_meal_occurrences where schedule_id='{S}')",'null nutrients and automatic provenance preserved')
    sql(f"delete from public.food_entries where id=(select food_entry_id from public.recurring_meal_occurrences where schedule_id='{S}');")
    check(tick().replace('select generated','select generated=0'),'deleted occurrence cannot resurrect')
    check(f"select count(*)=1 and bool_and(food_entry_id is null) from public.recurring_meal_occurrences where schedule_id='{S}'",'ledger survives meal deletion')
    check(user('select count(*)=0 from public.recurring_meal_occurrences',V),'RLS hides foreign ledger')
    # Pause / resume / prospective edit.
    sql(user(f"select * from public.recurring_meal_update('{S}','{{\"enabled\":false}}')"))
    check(tick('2026-10-04 12:00+00').replace('select generated','select generated=0'),'pause prevents generation')
    sql(user(f"select * from public.recurring_meal_update('{S}','{{\"enabled\":true}}')"))
    check(tick('2026-10-01 12:00+00').replace('select generated','select generated=0'),'resume never backfills earlier days')
    sql(user(f"select * from public.recurring_meal_update('{S}','{{\"localTime\":\"11:00\",\"weekdays\":[1]}}')"))
    sql(f"update public.recurring_meal_schedules set effective_from='2026-10-01' where id='{S}';")
    check(tick('2026-10-04 12:00+00').replace('select generated','select generated=0'),'weekday selection respected')
    check(tick('2026-10-05 10:59+00').replace('select generated','select generated=0'),'custom time not early')
    check(tick('2026-10-05 11:00+00').replace('select generated','select generated=1'),'selected weekday at edited time')
    previous=sql(f"select effective_from from public.recurring_meal_schedules where id='{S}'")
    sql(user(f"select * from public.recurring_meal_update('{S}','{{\"localTime\":\"11:00\",\"weekdays\":[1]}}')"))
    check(f"select effective_from='{previous}'::timestamptz from public.recurring_meal_schedules where id='{S}'",'equal patch retry preserves activation time')
    # Actual database clock today: skip before and after occurrence.
    for index in (2,3):
        sid=f'30000000-0000-4000-8000-{index:012d}'
        sql(user(f"select * from public.recurring_meal_create('{sid}','{F}','00:00','UTC',array[0,1,2,3,4,5,6])"))
        sql(f"update public.recurring_meal_schedules set effective_from=now()-interval '2 days' where id='{sid}';")
        if index==3: sql(tick().replace("'2026-10-03 12:00:00+00'",'now()'))
        check(user(f"select ok from public.recurring_meal_skip('{sid}',(now() at time zone 'UTC')::date)"),'skip before/after tick '+str(index))
        sql(tick().replace("'2026-10-03 12:00:00+00'",'now()'))
        check(f"select skipped and food_entry_id is null from public.recurring_meal_occurrences where schedule_id='{sid}'",'skip durable and removes generated meal '+str(index))
        sql(user(f"select * from public.recurring_meal_stop('{sid}')"))
    # Remove older routine from subsequent synthetic scenario tick counts.
    sql(user(f"select * from public.recurring_meal_stop('{S}')"))
    denied(create,'stopped creation replay never resurrects',uid=U,code='recurring_conflict')
    for index,at,early,expected in [(4,'2026-03-29 01:30+00','2026-03-29 01:29+00','2026-03-29 01:30+00'),(5,'2026-10-25 01:30+00','2026-10-25 00:30+00','2026-10-25 01:30+00')]:
        sid=f'30000000-0000-4000-8000-{index:012d}'
        sql(user(f"select * from public.recurring_meal_create('{sid}','{F}','02:30','Europe/Bratislava',array[0])"))
        sql(f"update public.recurring_meal_schedules set effective_from='2026-01-01' where id='{sid}';")
        check(tick(early).replace('select generated','select generated=0'),'DST not early '+str(index))
        check(tick(at).replace('select generated','select generated=1'),'DST materializes gap/fold '+str(index))
        check(f"select consumed_at='{expected}'::timestamptz from public.food_entries where id=(select food_entry_id from public.recurring_meal_occurrences where schedule_id='{sid}')",'DST expected instant '+str(index))
        check(tick(at).replace('select generated','select generated=0'),'DST once per local day '+str(index))
        sql(user(f"select * from public.recurring_meal_stop('{sid}')"))
    # Current authority: source's existing Pro fields copied only with current entitlement.
    sql(f"update public.food_entries set fibre_g=5 where id='{F}';")
    sid='30000000-0000-4000-8000-000000000006'
    sql(user(f"select * from public.recurring_meal_create('{sid}','{F}','10:00','UTC',array[0,1,2,3,4,5,6])"))
    sql(f"update public.recurring_meal_schedules set effective_from='2026-10-01' where id='{sid}';")
    sql(tick())
    check(f"select fibre_g is null from public.food_entries where id=(select food_entry_id from public.recurring_meal_occurrences where schedule_id='{sid}')",'lapsed entitlement omits advanced nutrients')
    sql(f"update public.profiles set plan_tier='paid' where id='{U}';")
    sql(tick('2026-10-04 12:00+00'))
    check(f"select fibre_g=5 from public.food_entries where id=(select food_entry_id from public.recurring_meal_occurrences where schedule_id='{sid}' and local_date='2026-10-04')",'current paid entitlement copies advanced nutrients')
    # Two workers collide after a restart: exactly one insert/ledger.
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        outcomes=list(pool.map(lambda _:sql(tick('2026-10-05 12:00+00')),range(4)))
    check(f"select count(*)=1 from public.recurring_meal_occurrences where schedule_id='{sid}' and local_date='2026-10-05'",'concurrent ticks log once')
    checks+=1; assert sum(int(out.splitlines()[-1]) for out in outcomes)==1
    print('PASS: four concurrent workers return one total insert',flush=True)
    # Concurrent worker vs skip uses the exact shared lock, whether either wins first.
    race='30000000-0000-4000-8000-000000000007'
    sql(user(f"select * from public.recurring_meal_create('{race}','{F}','00:00','UTC',array[0,1,2,3,4,5,6])"))
    sql(f"update public.recurring_meal_schedules set effective_from=now()-interval '2 days' where id='{race}';")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(sql,[tick().replace("'2026-10-03 12:00:00+00'",'now()'),user(f"select * from public.recurring_meal_skip('{race}',(now() at time zone 'UTC')::date)")]))
    check(f"select skipped and food_entry_id is null from public.recurring_meal_occurrences where schedule_id='{race}'",'skip vs tick leaves no logged occurrence')
    # Deletion admission racing tick permanently closes schedules before subsequent ticks.
    job=f"insert into public.account_deletion_jobs(id,user_id,challenge_hash,status,stage,expires_at) values(gen_random_uuid(),'{U}','synthetic','in_progress','storage',now()+interval '1 hour')"
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(sql,[tick('2026-10-06 12:00+00'),job]))
    check(f"select bool_and(not enabled and stopped_at is not null) from public.recurring_meal_schedules where user_id='{U}'",'account deletion admission closes all schedules')
    check(tick('2026-10-07 12:00+00').replace('select generated','select generated=0'),'deleting account cannot generate later meals')
    denied(f"select * from public.recurring_meal_create(gen_random_uuid(),'{F}','10:00','UTC',array[1])",'deleting user cannot add schedules',uid=U,code='recurring_invalid')
    sql(f"delete from auth.users where id='{U}';")
    check(f"select not exists(select 1 from public.recurring_meal_schedules where user_id='{U}') and not exists(select 1 from public.recurring_meal_occurrences where user_id='{U}')",'Auth erasure cascades schedules and ledger')
    print(f'PASS: {checks} real SQL assertions; synthetic fixtures only',flush=True)
finally:
    if created:
        sql('drop database '+DATABASE,'postgres')
        print('Removed disposable local database '+DATABASE,flush=True)
