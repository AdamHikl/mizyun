# Synthetic public Dev API acceptance. Run on Hetzner Ops with --candidate <40SHA>.
# Credentials remain only in the Dev process. All fixture IDs/emails are generated here.
import os,json,subprocess,urllib.request,urllib.error,secrets,uuid,datetime,time,statistics
import argparse,base64,hashlib,hmac,struct,zlib,re,fcntl
parser=argparse.ArgumentParser();parser.add_argument("--candidate",required=True);args=parser.parse_args()
assert re.fullmatch(r"[0-9a-f]{40}",args.candidate)
lock=open("/tmp/mizyun-deploy-dev.lock","r+b");fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert open('/etc/mizyun/host-role').read().strip()=='hetzner-primary-1d36b436-f4d5-4a29-b249-4153975563f3'
root='/var/lib/mizyun/dev/repo'
assert subprocess.check_output(['git','-c','safe.directory='+root,'-C',root,'rev-parse','HEAD'],text=True).strip()==args.candidate
assert not subprocess.check_output(['git','-c','safe.directory='+root,'-C',root,'status','--porcelain'],text=True).strip()
pid=subprocess.check_output(['systemctl','show','mizyun-api-dev.service','--property=MainPID','--value'],text=True).strip()
env=dict(x.split('=',1) for x in open('/proc/'+pid+'/environ','rb').read().decode().split('\0') if '=' in x)
assert env['SUPABASE_URL']=='http://127.0.0.1:8100' and env['API_PORT']=='4100' and env['API_HOST']=='127.0.0.1'
assert env.get('COMMUNITY_DELIVERY_ENABLED')=='false'
dbconfig=json.loads(subprocess.check_output(['docker','inspect','mizyun-dev-db'],text=True))[0]
assert any(v['HostPort']=='5433' and v['HostIp']=='127.0.0.1' for v in dbconfig['NetworkSettings']['Ports']['5432/tcp'])
key=env['SUPABASE_SERVICE_ROLE_KEY'];anon=env['SUPABASE_ANON_KEY'];assert anon and anon!=key
api='https://mizyun-api-dev.phiskel.com';sb='https://mizyun-supabase-dev.phiskel.com';users=[];handles=[];emails=[];passes=[]
class NoRedirects(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a):raise RuntimeError('Redirect refused')
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirects())
def req(method,path,token=None,body=None,service=False,local_cleanup=False):
 target=sb if path.startswith(('/rest/','/auth/','/storage/')) else api
 assert target in [sb,api]
 if local_cleanup:
  assert service and method in ['PATCH','DELETE'] and (path.startswith('/rest/v1/community_feature_controls?feature=eq.') or path.startswith('/auth/v1/admin/users/'))
  target='http://127.0.0.1:8100'
 headers={'Content-Type':'application/json','Accept':'application/json','User-Agent':'Mizyun-Dev-acceptance/1.0'}
 if target in [sb,'http://127.0.0.1:8100']:headers.update({'apikey':key if service else anon,'Prefer':'return=representation'})
 if service:headers['Authorization']='Bearer '+key
 elif token:headers['Authorization']='Bearer '+token
 r=urllib.request.Request(target+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers=headers)
 try:
  with opener.open(r,timeout=20) as p:
   raw=p.read()
   try:return p.status,json.loads(raw) if raw else None
   except (ValueError,UnicodeError):
    print('Non-JSON Dev response',method,'HTTP',p.status,'content-type',p.headers.get('Content-Type'),flush=True)
    return p.status,None
 except urllib.error.HTTPError as e:
  raw=e.read()
  try:return e.code,json.loads(raw) if raw else None
  except (ValueError,UnicodeError):
   print('Non-JSON Dev error',method,'HTTP',e.code,'content-type',e.headers.get('Content-Type'),'server',e.headers.get('Server'),'body-length',len(raw),flush=True)
   return e.code,None

def check(label,ok):
 if not ok:raise RuntimeError('Dev synthetic acceptance failed: '+label)
 passes.append(label)
def sbget(table):
 status,rows=req('GET','/rest/v1/'+table,service=True);check('Service fixture read '+table.split('?')[0],status==200);return rows
features=sbget('community_feature_controls');media_ids=[]
check('Exactly seven independent feature controls',len(features)==7)
before=sbget('community_pilot_cohort?select=user_id')
controls=sbget('community_operations')[0]
check('Original two-account Dev cohort retained',len(before)==2)
check('Actual Dev controls enabled with closed cohort and delivery off',all(controls[k] for k in ['enabled','enrollment','discovery','publish','engagement','cohort_required']) and controls['delivery'] is False)
try:
 code,_=req("PATCH","/rest/v1/community_feature_controls",body={"enabled":True},service=True);check("Temporary Dev feature test switches",code==200)
 tokens=[]
 for i in range(3):
  email='community-http-'+uuid.uuid4().hex+'@mizyun.test';password=secrets.token_urlsafe(24)
  # Remember the exact synthetic email before create for lost-response cleanup.
  assert not subprocess.check_output(['docker','exec','mizyun-dev-db','psql','-U','postgres','-d','postgres','-X','-At','-c',"select id from auth.users where email='"+email+"';"],text=True).strip()
  emails.append(email)
  code,d=req('POST','/auth/v1/admin/users',body={'email':email,'password':password,'email_confirm':True},service=True)
  check('Synthetic Dev account created',code==200);uid=d['id'];users.append(uid)
  code,d=req('POST','/auth/v1/token?grant_type=password',body={'email':email,'password':password});check('Actual Dev Auth login',code==200);tokens.append(d['access_token'])
  code,_=req('PATCH','/rest/v1/profiles?id=eq.'+uid,body={'birth_year':1990},service=True);check('Synthetic adult fixture',code==200)
  code,_=req('POST','/rest/v1/community_pilot_cohort',body={'user_id':uid},service=True);check('Only synthetic temporary admission',code==201)
 a,b,c=tokens;ua,ub,uc=users
 for t in tokens:
  handle='http_'+uuid.uuid4().hex[:18]
  check('Synthetic handle not preexisting quarantine',sbget('community_handle_quarantine?handle=eq.'+handle)==[])
  handles.append(handle)
  code,p=req('POST','/v1/community/profile',t,{'handle':handle,'displayName':'Synthetic Dev','avatarSymbol':'SD','isSearchable':True,'adultDeclaration':True,'termsVersion':'2026-09-30','acceptedTerms':True})
  check('Deliberate Community enrollment over public Dev API',code==201)
 # Pending is not authorization, and approval never establishes reciprocity.
 code,edge=req('POST','/v1/community/relationships/requests',b,{'targetUserId':ua,'operationId':str(uuid.uuid4())});check('Directional follow request',code==201)
 edgeid=edge['id']
 code,_=req('PATCH','/v1/community/relationships/requests/'+edgeid,b,{'action':'approve'});check('Requester self-approval denied',code==403)
 code,_=req('PATCH','/v1/community/relationships/requests/'+edgeid,a,{'action':'approve'});check('Recipient approves directional edge',code==200)
 # Search off author still can follow its approved follower back; independent approval required.
 code,_=req('PATCH','/v1/community/profile',b,{'isSearchable':False});check('Follower independently disables search',code==200)
 code,reverse=req('POST','/v1/community/relationships/requests',a,{'targetUserId':ub,'operationId':str(uuid.uuid4())});check('Follow-back succeeds with recipient search disabled',code==201 and reverse['status']=='pending')
 code,_=req('PATCH','/v1/community/relationships/requests/'+reverse['id'],b,{'action':'approve'});check('Separate reciprocal approval',code==200)
 now=datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0);workout=str(uuid.uuid4());exercise=str(uuid.uuid4())
 code,_=req('POST','/rest/v1/workouts',a,{'id':workout,'user_id':ua,'name':'Synthetic PRIVATE title','started_at':(now-datetime.timedelta(seconds=60)).isoformat(),'completed_at':now.isoformat(),'details':{'workoutLifecycle':{'kind':'session'},'privateNote':'Private fixture excluded'}});check('Synthetic private workout fixture',code==201)
 code,_=req('POST','/rest/v1/exercises',a,{'id':exercise,'user_id':ua,'name':'Synthetic squat'});check('Synthetic exercise fixture',code==201)
 code,_=req('POST','/rest/v1/workout_sets',a,{'user_id':ua,'workout_id':workout,'exercise_id':exercise,'sequence':1,'set_type':'normal','repetitions':8,'load_kg':50,'completed_at':now.isoformat()});check('Completed synthetic set fixture',code==201)
 detail={'exercises':[{'name':'Synthetic squat','sets':[{'setType':'normal','repetitions':8,'loadKg':50,'durationSeconds':None}]}]}
 body={'workoutId':workout,'enrollmentGeneration':1,'operationId':str(uuid.uuid4()),'category':'strength','sharedDay':now.date().isoformat(),'includeDuration':True,'expectedDurationSeconds':60,'includeWorkoutDetails':True,'expectedWorkoutDetails':detail}
 code,card=req('POST','/v1/community/activities',a,body);check('Explicit exact detailed publication',code==201)
 code,replay=req('POST','/v1/community/activities',a,body);check('Lost-response replay preserves one card/version',code in [200,201] and replay['id']==card['id'] and replay['version']==card['version'])
 path='/v1/community/activities/'+card['id']
 code,view=req('GET',path,b);check('Approved follower exact detail projection',code==200 and view['workoutDetails']==detail and view['durationSeconds']==60 and 'sourceWorkoutId' not in view and 'name' not in view and 'details' not in view)
 code,_=req('GET',path,c);check('Unrelated principal activity denied',code==404)
 code,rows=req('GET','/rest/v1/workouts?id=eq.'+workout,b);check('Approved follower private source denied',code==200 and rows==[])
 code,_=req('PUT',path+'/reaction',b,{'reaction':'clap'});check('Reversible encouragement reaction',code==200)
 code,inbox=req('GET','/v1/community/notifications/inbox',a);check('Real inbox available without push',code==200 and len(inbox['items'])>=1)
 elapsed=[]
 for i in range(10):
  start=time.perf_counter();code,feed=req('GET','/v1/community/feed',b);elapsed.append((time.perf_counter()-start)*1000)
  check('Public Dev feed exact projection',code==200 and any(v['id']==card['id'] and v['workoutDetails']==detail for v in feed['items']))
 print(json.dumps({'fixture':'three temporary synthetic Dev accounts,one card','public_https_feed_median_ms':round(statistics.median(elapsed),2),'public_https_feed_p95_ms':round(max(elapsed),2),'not_pilot_load_acceptance':True}),flush=True)
 # Actual expansion API routes, not only direct database RPCs.
 def ok(method,path,token,body=None):
  code,value=req(method,path,token,body)
  check('Public Dev expansion route '+path.split('?')[0],code in [200,201,204])
  return value
 def op(path,token,operation,**body):return ok('POST',path,token,dict(operation=operation,**body))
 def denied(method,path,token=None,body=None):
  code,_=req(method,path,token,body);check('Public expansion access denial',code in ([400,401,403,404] if path.startswith('/storage/') else [401,403,404]))
 availability=ok('GET','/v1/community/features',a)
 check('Authorized caller receives all seven enabled test features',len(availability)==7 and all(v['enabled'] for v in availability))
 denied('GET','/v1/community/features')
 for token in [a,b]:op('/v1/community/messaging',token,'preferences',enabled=True)
 send=dict(id=str(uuid.uuid4()),peerId=ub,text='Synthetic bounded message')
 first=op('/v1/community/messaging',a,'send',**send)
 check('Public messaging retry is exact',op('/v1/community/messaging',a,'send',**send)==first)
 check('Public recipient sees opted-in message',op('/v1/community/messaging',b,'list',peerId=ua)['messages'][0]['text']==send['text'])
 denied('POST','/v1/community/messaging',c,dict(operation='list',peerId=ua))
 ok('PUT',path+'/comments/settings',a,dict(enabled=True))
 comment=dict(id=str(uuid.uuid4()),operationId=str(uuid.uuid4()),expectedVersion=0,body='Synthetic encouragement',mentions=[])
 ok('POST',path+'/comments',b,comment)
 check('Public comment page receives exact text',ok('GET',path+'/comments',a)['items'][0]['body']==comment['body'])
 denied('GET',path+'/comments',c)
 group=op('/v1/community/groups/operations',a,'create',operationId=str(uuid.uuid4()),name='Synthetic private group',rules='Be kind')['group'];gid=group['id']
 own=op('/v1/community/groups/operations',a,'read',groupId=gid)
 version=next(v['membershipVersion'] for v in own['members'] if v['userId']==ua)
 op('/v1/community/groups/operations',a,'invite',groupId=gid,targetUserId=ub,membershipVersion=version)
 invitation=next(g for g in op('/v1/community/groups/operations',b,'list')['groups'] if g['id']==gid)
 op('/v1/community/groups/operations',b,'join',groupId=gid,membershipVersion=invitation['membershipVersion'])
 joined=op('/v1/community/groups/operations',b,'read',groupId=gid)
 version=next(v['membershipVersion'] for v in joined['members'] if v['userId']==ub)
 op('/v1/community/groups/operations',b,'post',groupId=gid,membershipVersion=version,operationId=str(uuid.uuid4()),body='Synthetic encouragement',acceptedAudience=True)
 check('Public explicit group post',len(op('/v1/community/groups/operations',a,'read',groupId=gid)['posts'])==1)
 denied('POST','/v1/community/groups/operations',c,dict(operation='read',groupId=gid))
 cid=str(uuid.uuid4());day=now.date()
 op('/v1/community/challenges',a,'create',id=cid,groupId=gid,title='Synthetic consistency',startDay=day.isoformat(),endDay=(day+datetime.timedelta(days=6)).isoformat(),timezone='UTC',goalDays=3,confirmed=True)
 op('/v1/community/challenges',b,'join',id=cid,confirmed=True)
 progress=op('/v1/community/challenges',b,'contribute',id=cid,day=day.isoformat(),kind='rest',confirmed=True)
 check('Public deliberate rest declaration credited',progress['challenge']['myProgress']==1)
 denied('POST','/v1/community/challenges',c,dict(operation='get',id=cid))
 routine=str(uuid.uuid4())
 code,_=req('POST','/rest/v1/workouts',a,dict(id=routine,user_id=ua,name='Synthetic PRIVATE title',started_at=now.isoformat(),notes='PRIVATE note',details={'workoutLifecycle':{'kind':'routine'},'injury':'PRIVATE','coachPlan':{'exercises':[dict(name='Squat',targetSets=3,targetReps='8-12',targetLoad='10 kg',restSeconds=60)]}}));check('Own synthetic routine fixture',code==201)
 preview=ok('POST','/v1/community/routines/preview',a,dict(sourceWorkoutId=routine,title='Strength'))
 shared=ok('POST','/v1/community/routines',a,dict(sourceWorkoutId=routine,operationId=str(uuid.uuid4()),confirmed=True,**preview))
 check('Public routine projection omits private fields', 'PRIVATE' not in json.dumps(shared) and 'sourceWorkoutId' not in shared)
 shared_path='/v1/community/routines/'+shared['id']
 imported=ok('POST',shared_path+'/import',b,dict(version=shared['version'],confirmed=True))
 check('Public routine import retry returns independent copy',ok('POST',shared_path+'/import',b,dict(version=shared['version'],confirmed=True))['workoutId']==imported['workoutId'])
 denied('GET',shared_path,c)
 op('/v1/community/broader-discovery',a,'preferences',enabled=True)
 found=op('/v1/community/broader-discovery',c,'search',prefix=handles[0])
 check('Public separate consent prefix result',len(found['profiles'])==1 and 'bio' not in found['profiles'][0])
 # A freshly generated non-user 2x2 RGB PNG exercises real deployed Sharp.
 def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
 png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',2,2,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b'\x00'+b'\x00\xff\x00'*2+b'\x00'+b'\x00\xff\x00'*2))+chunk(b'IEND',b'')
 image=ok('POST','/v1/community/media',a,dict(operationId=str(uuid.uuid4()),mimeType='image/png',base64=base64.b64encode(png).decode(),altText='Synthetic green square',rightsConfirmed=True));mid=image['id'];media_ids.append(mid)
 check('Public image remains quarantined with derived dimensions',image['state']=='pending' and image['width']==2 and image['height']==2)
 image_path='/v1/community/media/'+mid
 content=ok('POST',image_path+'/content',a,dict(variant='thumbnail'))
 check('Public owner-only derived JPEG bytes',base64.b64decode(content['base64']).startswith(b'\xff\xd8'))
 denied('POST',image_path+'/content',b,dict(variant='thumbnail'))
 denied('GET','/storage/v1/object/community-media/quarantine/'+mid+'/thumbnail.jpg',b)
 # Synthetic independent named staff uses real GoTrue enrolled/verified TOTP.
 code,_=req('POST','/rest/v1/community_moderation_staff',body=dict(user_id=uc,active=True),service=True);check('Temporary named synthetic staff registry',code==201)
 factor=ok('POST','/auth/v1/factors',c,dict(factor_type='totp',friendly_name='Disposable Dev test TOTP'))
 factorid=factor['id'];secret=factor['totp']['secret'];challenge=ok('POST','/auth/v1/factors/'+factorid+'/challenge',c,{})
 decoded=base64.b32decode(secret+'='*((8-len(secret)%8)%8),casefold=True);mac=hmac.new(decoded,struct.pack('>Q',int(time.time())//30),hashlib.sha1).digest();offset=mac[-1]&15;totp=str((struct.unpack('>I',mac[offset:offset+4])[0]&0x7fffffff)%1000000).zfill(6)
 staff=ok('POST','/auth/v1/factors/'+factorid+'/verify',c,dict(challenge_id=challenge['id'],code=totp))['access_token']
 denied('POST',image_path+'/review',a,dict(decision='approve',reason='Synthetic inspection'))
 ok('POST',image_path+'/review',staff,dict(decision='approve',reason='Synthetic bounded inspection'))
 check('Public approved follower image bytes',bool(ok('POST',image_path+'/content',b,dict(variant='thumbnail'))['base64']))
 denied('POST',image_path+'/content',c,dict(variant='thumbnail'))
 ok('DELETE',image_path,a)
 denied('POST',image_path+'/content',b,dict(variant='thumbnail'))
 op('/v1/community/messaging',b,'preferences',enabled=False)
 denied('POST','/v1/community/messaging',a,dict(operation='send',id=str(uuid.uuid4()),peerId=ub,text='After opt-out'))
 ok('DELETE',shared_path,a)
 denied('GET',shared_path,b)
 code,copies=req('GET','/rest/v1/workouts?id=eq.'+imported['workoutId'],b);check('Private imported copy survives unshare',code==200 and len(copies)==1)
 code,_=req('POST',path+'/unpublish?version='+str(card['version']),a,{});check('Exact version unpublish',code in [200,204])
 code,_=req('GET',path,b);check('Unpublish denies stale follower card',code==404)
 code,_=req('PUT',path+'/reaction',b,{'reaction':'fire'});check('Stale reaction denied after unpublish',code==404)
 code,_=req('POST','/v1/community/blocks',a,{'blockedUserId':ub});check('Explicit bilateral block',code==201)
 code,edges=req('GET','/v1/community/relationships/following',b);check('Block revokes directional following',code==200 and not any(v['user']['userId']==ua for v in edges['items']))
 code,_=req('POST','/v1/community/profile/withdraw',a,{});check('Explicit Community withdrawal',code in [200,204])
 code,rows=req('GET','/rest/v1/workouts?id=eq.'+workout,a);check('Private workout preserved after withdrawal',code==200 and len(rows)==1)
 print('Public Dev API/Auth/database functional assertions:',len(passes),flush=True)
finally:
 completed_media=set(media_ids)
 failures=[]
 for feature in features:
  restored=False
  for local in [False,True]:
   try:
    code,_=req('PATCH','/rest/v1/community_feature_controls?feature=eq.'+feature['feature'],body={k:v for k,v in feature.items() if k!='feature'},service=True,local_cleanup=local)
    if code==200:restored=True;break
   except Exception:pass
  if not restored:failures.append('Feature control restoration')
 # Reconcile an Auth commit whose response was lost using only recorded fresh emails.
 for email in emails:
  try:
   matched=subprocess.check_output(['docker','exec','mizyun-dev-db','psql','-U','postgres','-d','postgres','-X','-At','-c',"select id from auth.users where email='"+email+"';"],text=True).strip().splitlines()
   for value in matched:
    uid=str(uuid.UUID(value))
    if uid not in users:users.append(uid)
  except Exception:failures.append('Auth reconciliation')
 for uid in reversed(users):
  deleted=False
  for local in [False,True]:
   try:
    code,_=req('DELETE','/auth/v1/admin/users/'+uid,service=True,local_cleanup=local)
    if code in [200,204]:deleted=True;break
   except Exception:pass
  if not deleted:failures.append('Auth fixture cleanup')
 for handle in handles:
  try:
   code,_=req('DELETE','/rest/v1/community_handle_quarantine?handle=eq.'+handle,service=True)
   if code not in [200,204]:failures.append('Handle fixture cleanup')
  except Exception:failures.append('Handle fixture cleanup')
 # Resolve only artifacts/tickets owned by fresh synthetic UUIDs, including
 # an upload whose server commit succeeded but response was lost.
 for uid in users:
  for table in ['community_media_assets','community_media_cleanup_jobs']:
   try:
    for item in sbget(table+'?user_id=eq.'+uid):
     mid=str(uuid.UUID(item['id']))
     if mid not in media_ids:media_ids.append(mid)
   except Exception:failures.append('Synthetic media reconciliation')
 for mid in media_ids:
  if mid not in completed_media:
   # Preserve upload lease/late-write safety window after a lost response.
   continue
  try:
   code,_=req('PATCH','/rest/v1/community_media_cleanup_jobs?id=eq.'+mid,body={'not_before':datetime.datetime.now(datetime.timezone.utc).isoformat()},service=True)
   if code!=200:failures.append('Synthetic cleanup readiness')
  except Exception:failures.append('Synthetic cleanup readiness')
 if media_ids:
  try:subprocess.run(['systemctl','start','mizyun-community-dev-maintenance.service'],check=True,stdout=subprocess.DEVNULL)
  except Exception:failures.append('Scheduled physical cleanup')
 for mid in media_ids:
  try:
   if sbget('community_media_cleanup_jobs?id=eq.'+mid)!=[]:failures.append('Synthetic byte cleanup acknowledgement')
   for variant in ['image','thumbnail']:
    code,_=req('GET','/storage/v1/object/community-media/quarantine/'+mid+'/'+variant+'.jpg',service=True)
    if code not in [400,404]:failures.append('Synthetic physical bytes retained')
  except Exception:failures.append('Synthetic physical cleanup verification')
 for uid in users:
  for table,column in [('profiles','id'),('community_profiles','user_id'),('community_pilot_cohort','user_id'),('workouts','user_id'),('exercises','user_id'),('workout_sets','user_id'),('community_withdrawal_jobs','user_id'),('community_comments', 'user_id'),('community_comment_settings', 'user_id'),('community_comment_preferences', 'user_id'),('community_comment_operations', 'user_id'),('community_comment_usage', 'user_id'),('community_comment_mentions', 'user_id'),('community_group_posts', 'user_id'),('community_group_operations', 'user_id'),('community_group_appeals', 'user_id'),('community_group_events', 'user_id'),('community_group_members', 'user_id'),('community_groups', 'user_id'),('community_routine_shares', 'user_id'),('community_routine_imports', 'user_id'),('community_messages', 'user_id'),('community_message_operations', 'user_id'),('community_messaging_preferences', 'user_id'),('community_broader_discovery_preferences', 'user_id'),('community_broader_discovery_usage', 'user_id'),('community_challenge_contributions', 'user_id'),('community_challenge_members', 'user_id'),('community_challenges', 'user_id'),('community_media_review_actions', 'user_id'),('community_media_assets', 'user_id'),('community_media_cleanup_jobs', 'user_id'),('community_moderation_staff', 'user_id')]:
   try:
    if sbget(table+'?'+column+'=eq.'+uid)!=[]:failures.append('Synthetic remnant '+table)
   except Exception:failures.append('Synthetic remnant verification')
 check('Original independent feature controls restored exactly',sorted(sbget('community_feature_controls'),key=lambda f:f['feature'])==sorted(features,key=lambda f:f['feature']))
 after=sbget('community_pilot_cohort?select=user_id')
 check('Original cohort restored exactly',sorted(v['user_id'] for v in before)==sorted(v['user_id'] for v in after))
 check('Original database controls unchanged',sbget('community_operations')[0]==controls)
 check('All synthetic cleanup completed',not failures)
 print('Removed synthetic Dev accounts/data/cohort/handles; original two-account cohort and controls unchanged',flush=True)

print('PASS public Dev API/Auth/database and cleanup assertions:',len(passes),flush=True)
