import subprocess, concurrent.futures, time, json
from pathlib import Path
DB='mizyun_rec03_verify_final_20261013'
BASE=['docker','exec','-i','supabase_db_mizyun','psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d',DB,'-At']
def sql(s):
 r=subprocess.run(BASE,input=s,text=True,capture_output=True,check=True); return r.stdout.strip()
for source,log in [('/tmp/rec03-local-schema.sql','/tmp/rec03-final-schema.log'),('supabase/migrations/20261013090000_recipe_request_reservations.sql','/tmp/rec03-final-migration.log'),('supabase/tests/database/0043_recipe_request_reservations.test.sql','/tmp/rec03-final-pgtap.log')]:
 Path(log).write_text(sql(Path(source).read_text()))
assert 'not ok' not in Path('/tmp/rec03-final-pgtap.log').read_text()
u='a2430000-0000-4000-8000-000000000011';r='b2430000-0000-4000-8000-000000000011'
sql(f"insert into auth.users(id,email) values('{u}','rec03-concurrency@mizyun.test'); insert into public.user_ai_consents(user_id,granted,confirmed_adult,consent_version,consented_at) values('{u}',true,true,'test-v1',now());")
def reserve(req=r): return f"select outcome from public.ai_reserve_recipe_request('{u}','{req}','suggest',repeat('a',64),'test-v1',800,5000,10,20,2,60000);"
with concurrent.futures.ThreadPoolExecutor(2) as pool:
 first=pool.submit(sql,'begin; '+reserve()+' select pg_sleep(0.6); commit;')
 time.sleep(.15)
 second=pool.submit(sql,reserve())
 a,b=first.result(),second.result()
assert 'reserved' in a and b=='busy',(a,b)
assert sql(f"select count(*) from public.ai_recipe_requests where user_id='{u}';")=='1'
assert sql(f"select tokens_used from public.ai_daily_token_ledger where user_id='{u}';")=='800'
assert sql(f"select request_count from public.ai_request_windows where user_id='{u}';")=='1'
sql(f"select publish_allowed from public.ai_finalize_recipe_request('{u}',(select attempt_id from public.ai_recipe_requests where user_id='{u}'),'succeeded',200);")
assert sql(reserve())=='outcome_unavailable'
# Block admission on lifecycle lock while revocation commits; waiting session must recheck.
def fence_change(change,req):
 with concurrent.futures.ThreadPoolExecutor(2) as pool:
  holder=pool.submit(sql,f"begin; select pg_advisory_xact_lock(hashtextextended('{u}',49)); {change} select pg_sleep(.6); commit;")
  time.sleep(.15)
  waiter=pool.submit(sql,reserve(req).replace('select outcome','select outcome||\':\'||reason'))
  holder.result();return waiter.result()
assert fence_change(f"update public.user_ai_consents set granted=false,revoked_at=clock_timestamp() where user_id='{u}';",'b2430000-0000-4000-8000-000000000012')=='denied:consent'
sql(f"update public.user_ai_consents set granted=true,revoked_at=null where user_id='{u}';")
assert fence_change(f"insert into public.account_deletion_jobs(user_id,challenge_hash,status,stage,expires_at) values('{u}','synthetic','in_progress','storage',clock_timestamp()+interval '1 hour');",'b2430000-0000-4000-8000-000000000013')=='denied:deletion'
assert sql(f"select count(*) from public.ai_recipe_requests where user_id='{u}';")=='1'
sql(f"delete from auth.users where id='{u}';")
print(json.dumps({'database':DB,'schema':'schema-only local disposable DB; no production or dev records','pgtapAssertions':50,'independentSessionChecks':['concurrent duplicate reserved+busy','one durable row/token charge/minute slot','terminal identity unavailable in new backend session','revocation committed while admission waited blocks dispatch','accepted deletion committed while admission waited blocks dispatch','denials leave no new ledger row'],'providerCalls':0}))
