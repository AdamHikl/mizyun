#!/usr/bin/env python3
"""MRS real-role/retry/concurrency acceptance in a fresh schema-only LOCAL scratch.
Coordinator-only: never mutates the source database or falls back to a remote host.
"""
import concurrent.futures
import json
from pathlib import Path
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[1]
SOCKET = Path.home() / '.docker/run/docker.sock'
DOCKER = ['docker', '--host', 'unix://' + str(SOCKET), 'exec', '-i', 'supabase_db_mizyun']
DATABASE = 'mizyun_mrs_scratch_' + uuid.uuid4().hex[:12]
checks = 0
created = False


def command(args, data=None, allow_failure=False):
    result = subprocess.run(args, input=data, text=True, capture_output=True)
    if result.returncode and not allow_failure:
        raise RuntimeError('Synthetic scratch command failed. Recent output:\n' + result.stdout[-2000:] + '\nDiagnostics:\n' + result.stderr[-3000:])
    return result if allow_failure else result.stdout


def sql(statement, database=DATABASE, allow_failure=False):
    # Every psql session begins as explicit server maintenance. Owner wrappers
    # override these session-local claims inside their own transaction.
    maintenance = "set request.jwt.claim.sub='';set request.jwt.claim.role='service_role';"
    return command(DOCKER + ['psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt'], maintenance + statement, allow_failure)


def owner(statement, uid):
    return "begin;set local role authenticated;set local request.jwt.claim.sub='" + uid + "';set local request.jwt.claim.role='authenticated';" + statement + ';commit;'


def check(statement, label):
    global checks
    output = sql(statement).strip()
    if output.splitlines()[-1:] != ['t']:
        raise AssertionError(label + ': ' + output[-500:])
    checks += 1
    print('PASS: ' + label, flush=True)


def literal(value):
    return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::jsonb"


try:
    if not SOCKET.is_socket():
        raise RuntimeError('Local Docker socket unavailable; no remote fallback permitted')
    schema = command(DOCKER + ['pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--no-privileges'])
    sql('create database ' + DATABASE, 'postgres')
    created = True
    sql(schema)
    sql("grant usage on schema public,auth,extensions to authenticated,anon,service_role;grant execute on function auth.uid(),auth.role() to authenticated,anon,service_role;grant select,insert,update,delete on public.food_entries to authenticated;alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;")
    # Reapply ONLY to this fresh schema-only scratch under permissive defaults.
    sql("drop table if exists public.recurring_meal_suggestion_receipts,public.recurring_meal_suggestion_states,public.recurring_meal_suggestion_preferences,public.recurring_meal_occurrences,public.recurring_meal_schedules cascade;do $$declare f record;begin for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'recurring_meal_%' or p.proname like 'recurring_suggestion_%') loop execute format('drop function if exists %s cascade',f.signature);end loop;end $$;")
    for name in ['20261003100000_recurring_meals.sql', '20261013120000_recurring_meal_suggestions.sql']:
        sql('begin;' + (ROOT / 'supabase/migrations' / name).read_text() + 'commit;')
    fixture = (ROOT / 'supabase/tests/database/0044_recurring_meal_suggestions.test.sql').read_text()
    output = sql(fixture)
    if 'not ok' in output:
        raise AssertionError('Role/RPC fixture failed:\n' + output[-6000:])
    print(output.strip(), flush=True)
    print('PASS: role/RPC/microsecond/replay/provenance/deletion fixtures', flush=True)
    # The synthetic helper is scratch-only, has no caller-selected time and never
    # reaches the source database. Each connection uses the committed evidence.
    start = fixture.index('create function pg_temp.mrs_proposal')
    end = fixture.index('end; $$;', start) + len('end; $$;')
    sql(fixture[start:end].replace('pg_temp.mrs_proposal', 'public.mrs_fixture_proposal'))
    owners = ['a2450000-0000-4000-8000-' + str(n).zfill(12) for n in range(1, 6)]
    for uid in owners:
        sql(f"insert into auth.users(id,email) values('{uid}','mrs-{uid}@synthetic.invalid');insert into public.food_entries(id,user_id,name,consumed_at,created_at,updated_at,calories_kcal,protein_g,carbohydrate_g,fat_g,confirmed_by_user,details) select gen_random_uuid(),'{uid}','Oats with banana',date_trunc('day',now())+(extract(hour from now())::int*60+(extract(minute from now())::int/15)*15)*interval '1 minute'-d*interval '1 day',date_trunc('milliseconds',now()),date_trunc('milliseconds',now()),300,10,40,10,true,'{{\"grams\":100}}'::jsonb from generate_series(0,2) d;")
    # Exercise the actual TypeScript detector against real stored SQL revisions;
    # SQL-only fixture builders cannot establish cross-language wire parity.
    detector = "import {detectRecurringMealSuggestion} from './packages/core/src/index.ts'; let raw='';process.stdin.on('data',part=>raw+=part);process.stdin.on('end',()=>{const value=JSON.parse(raw);const proposal=detectRecurringMealSuggestion({...value,referenceAt:new Date(value.referenceAt)});if(!proposal)throw Error('No real fixture proposal');process.stdout.write(JSON.stringify(proposal));});"
    proposals = {}
    for uid in owners:
        evidence = sql(f"select jsonb_build_object('userId','{uid}','timeZone','UTC','historyComplete',true,'referenceAt',public.recurring_suggestion_instant(now()),'generatedEntryIds','[]'::jsonb,'entries',(select jsonb_agg(jsonb_build_object('id',f.id,'userId',f.user_id,'name',f.name,'consumedAt',public.recurring_suggestion_instant(f.consumed_at),'createdAt',public.recurring_suggestion_instant(f.created_at),'updatedAt',public.recurring_suggestion_instant(f.updated_at),'confirmedByUser',f.confirmed_by_user,'caloriesKcal',f.calories_kcal,'proteinG',f.protein_g,'carbohydrateG',f.carbohydrate_g,'fatG',f.fat_g,'details',f.details) order by f.consumed_at) from public.food_entries f where f.user_id='{uid}')); ")
        proposals[uid] = json.loads(command(['pnpm', 'exec', 'tsx', '--eval', detector], evidence))
    print('PASS: TypeScript detector proposals use real PostgreSQL evidence revisions', flush=True)

    def request(uid):
        proposal = proposals[uid]
        return {'operationId': str(uuid.uuid4()), 'proposal': proposal, 'localTime': proposal['localTime'], 'timeZone': 'UTC', 'weekdays': list(range(7))}

    def accept_sql(uid, value):
        return owner('select result from public.recurring_suggestion_accept(' + literal(value) + ')', uid)

    uid = owners[0]
    frozen = request(uid)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: sql(accept_sql(uid, frozen)), range(2)))
    check(f"select (select count(*) from public.recurring_meal_schedules where user_id='{uid}')=1 and (select count(*) from public.recurring_meal_suggestion_receipts where user_id='{uid}')=1 and (select count(*) from public.recurring_meal_occurrences where user_id='{uid}' and skipped)=1", 'concurrent same-operation acceptance has one schedule/receipt/skip')

    uid = owners[1]
    value = request(uid)
    manual = owner(f"select id from public.recurring_meal_create(gen_random_uuid(),'{value['proposal']['sourceEntryId']}','{value['localTime']}','UTC',array[0,1,2,3,4,5,6])", uid)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda statement: sql(statement, allow_failure=True), [manual, accept_sql(uid, value)]))
    if not any(result.returncode == 0 for result in results):
        raise AssertionError('Both manual and acceptance failed')
    check(f"select (select count(*) from public.recurring_meal_schedules where user_id='{uid}')=1 and (select count(*) from public.recurring_meal_suggestion_receipts where user_id='{uid}')=1", 'manual-versus-acceptance races serialize to one equivalent schedule')

    uid = owners[2]
    value = request(uid)
    # A future clock belongs ONLY to the service worker; acceptance cannot select it.
    tick = "set request.jwt.claim.role='service_role';select generated from public.recurring_meal_tick((((now() at time zone 'UTC')::date+time '23:59:59') at time zone 'UTC'));"
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(sql, [accept_sql(uid, value), tick]))
    sql(tick)
    check(f"select not exists(select 1 from public.recurring_meal_occurrences where user_id='{uid}' and local_date=(now() at time zone 'UTC')::date and food_entry_id is not null) and (select count(*) from public.food_entries where user_id='{uid}')=3", 'worker-versus-acceptance never materializes today')

    uid = owners[3]
    value = request(uid)
    delete = f"delete from public.food_entries where id='{value['proposal']['sourceEntryId']}';"
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda statement: sql(statement, allow_failure=True), [accept_sql(uid, value), delete]))
    check(f"select (select count(*) from public.recurring_meal_schedules where user_id='{uid}')=(select count(*) from public.recurring_meal_suggestion_receipts where user_id='{uid}') and not exists(select 1 from public.food_entries where id='{value['proposal']['sourceEntryId']}')", 'source-delete race leaves either no accepted state or one complete receipt')
    if results[0].returncode == 0:
        sql(accept_sql(uid, value))
        print('PASS: source-deleted race winner replays', flush=True)

    uid = owners[4]
    value = request(uid)
    deleting = f"insert into public.account_deletion_jobs(user_id,status,challenge_hash,expires_at) values('{uid}','in_progress','mrs-concurrency',now()+interval '1 hour');"
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda statement: sql(statement, allow_failure=True), [accept_sql(uid, value), deleting]))
    check(f"select not exists(select 1 from public.recurring_meal_schedules where user_id='{uid}' and enabled and stopped_at is null) and exists(select 1 from public.account_deletion_jobs where user_id='{uid}' and status='in_progress')", 'account-deletion admission wins against future generation')
    print(f'PASS: {checks} real concurrent-state assertions', flush=True)
finally:
    if created:
        sql('drop database ' + DATABASE + ' with (force)', 'postgres')
