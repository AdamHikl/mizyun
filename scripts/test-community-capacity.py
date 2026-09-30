#!/usr/bin/env python3
"""Synthetic capacity/claim proof only in the coordinator-created EMPTY Mac scratch."""
import subprocess,uuid,concurrent.futures,statistics,time,json,re
from pathlib import Path
CONTAINER='supabase_db_mizyun';DATABASE='mizyun_issue149155_scratch'
def sql(statement):
 r=subprocess.run(['docker','exec','-i',CONTAINER,'psql','-U','postgres','-d',DATABASE,'-v','ON_ERROR_STOP=1','-At'],input=statement,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr[-2000:])
 return r.stdout
users=[str(uuid.uuid4()) for _ in range(130)]
try:
 sql("insert into auth.users(id,email) values "+','.join(f"('{u}','{u}@mizyun.test')" for u in users)+';')
 sql("update public.profiles set birth_year=1990 where id in ("+','.join(f"'{u}'" for u in users)+");")
 sql("insert into public.community_profiles(user_id,handle,display_name,status,terms_version,terms_accepted_at,adult_declared_at) values "+','.join(f"('{u}','load_{uuid.uuid4().hex[:18]}','Synthetic load','active','2026-09-30',now(),now())" for u in users)+';')
 # Planned100-follow stress envelope uses service fixtures; live pilot cap remains30.
 sql("set request.jwt.claim.role='service_role';insert into public.community_relationships(follower_user_id,target_user_id,status) values "+','.join(f"('{u}','{v}','approved')" for u in users[:30] for v in users[30:])+";")
 workouts=[str(uuid.uuid4()) for _ in range(100)]
 sql("insert into public.workouts(id,user_id,name,started_at,completed_at,details) values "+','.join(f"('{w}','{u}','Synthetic private source',now()-interval '1 hour',now(),'{{\"workoutLifecycle\":{{\"kind\":\"session\"}}}}')" for u,w in zip(users[30:],workouts))+';')
 sql("set request.jwt.claim.role='service_role';insert into public.shared_activities(user_id,source_workout_id,category,shared_day) values "+','.join(f"('{u}','{w}','strength',(now() at time zone 'UTC')::date::text)" for u,w in zip(users[30:],workouts))+';analyze public.community_relationships;analyze public.shared_activities;')
 # Add2000 own historical cards to test index scaling beyond a tiny one-page table.
 history=[str(uuid.uuid4()) for _ in range(2000)]
 sql("insert into public.workouts(id,user_id,name,started_at,completed_at,details) values "+','.join(f"('{w}','{users[0]}','Synthetic history',now()-interval '1 hour',now(),'{{\"workoutLifecycle\":{{\"kind\":\"session\"}}}}')" for w in history)+';')
 sql("set request.jwt.claim.role='service_role';insert into public.shared_activities(user_id,source_workout_id,category,shared_day,published_at) values "+','.join(f"('{users[0]}','{w}','strength',(now() at time zone 'UTC')::date::text,now()-interval '1 day')" for w in history)+';analyze public.shared_activities;')
 query='with candidate_authors'+Path('supabase/migrations/20260930190000_community_operations.sql').read_text().split('with candidate_authors',1)[1].split(' loop',1)[0]
 query=re.sub(r'\bu\b','auth.uid()',query);query=re.sub(r'\bn\b','20',query);query=query.replace('p_before_time','NULL::timestamptz').replace('p_before_id','NULL::uuid')
 raw=sql(f"begin;set local request.jwt.claim.sub='{users[0]}';explain(analyze,buffers,format json) {query};rollback;")
 plan=json.loads(raw[raw.index('['):raw.rindex(']')+1])[0]
 def nodes(node):
  yield node
  for child in node.get('Plans',[]):yield from nodes(child)
 card_nodes=[node for node in nodes(plan['Plan']) if node.get('Relation Name')=='shared_activities']
 assert card_nodes and all('Index' in node['Node Type'] or 'Bitmap' in node['Node Type'] for node in card_nodes),str([(n['Node Type'],n.get('Actual Loops')) for n in card_nodes])
 print(json.dumps({'feed_plan_card_access':[n['Node Type'] for n in card_nodes],'feed_plan_card_probe_loops':[n['Actual Loops'] for n in card_nodes],'sql_execution_ms':plan['Execution Time'],'sql_shared_hit_blocks':plan['Plan'].get('Shared Hit Blocks')},sort_keys=True),flush=True)
 durations=[]
 for u in users[:30]:
  start=time.perf_counter();out=sql(f"begin;set local role authenticated;set local request.jwt.claim.sub='{u}';select count(*) from public.community_feed(20,null,null);rollback;");durations.append((time.perf_counter()-start)*1000)
  assert '20' in out.splitlines(),out
 print(json.dumps({'fixture':'30 readers,100 follow targets,3000 approved edges,100 current +2000 historical cards','source_cap':'live30 unchanged;service stress100','feed_page':20,'docker_psql_roundtrip_median_ms':round(statistics.median(durations),2),'docker_psql_roundtrip_p95_ms':round(sorted(durations)[28],2),'hardware':'Mac Docker Postgres, not Hetzner'},sort_keys=True),flush=True)
 # Claim workers cannot steal leases; each outbox gets at most one live claim.
 sql("insert into public.community_push_tokens(installation_id,user_id,token,session_id,generation) values('"+str(uuid.uuid4())+"','"+users[0]+"','ExpoPushToken[synthetic_capacity_token]','synthetic',1);")
 for i in range(12):sql(f"select public.community_enqueue_notification('{users[0]}','{users[30+i]}','request',null,'capacity:{i}');")
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(lambda _:sql('select id from public.community_notification_claim(5);'),range(4)))
 claims=[line for out in results for line in out.splitlines() if len(line)==36]
 assert len(claims)==12 and len(set(claims))==12,claims
 print('PASS: four concurrent claim workers claim twelve jobs exactly once',flush=True)
finally:
 sql('delete from auth.users where id in ('+','.join(f"'{u}'" for u in users)+');')
 print('Removed all130 synthetic capacity accounts',flush=True)
