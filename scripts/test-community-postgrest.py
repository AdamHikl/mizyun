#!/usr/bin/env python3
"""Local-only synthetic Auth/PostgREST community boundary acceptance.

Requires the disposable Supabase stack running on this Mac. Never targets a
remote host. Reads local CLI credentials in memory, creates synthetic users,
and removes them in finally. No provider integrations or real user data.
"""
from pathlib import Path
import urllib.request,urllib.error,json,secrets,uuid,datetime,concurrent.futures,subprocess
cfg=json.loads(subprocess.check_output(['pnpm','exec','supabase','status','-o','json'],stderr=subprocess.DEVNULL))
base=cfg['API_URL']; assert urllib.parse.urlparse(base).hostname in ('localhost','127.0.0.1')
admin=cfg['SERVICE_ROLE_KEY']; anon=cfg['ANON_KEY']; users=[]; passed=[]
def req(method,path,token=None,body=None,admin_call=False):
 key=admin if admin_call else anon
 headers={'apikey':key,'Authorization':'Bearer '+(token or key),'Content-Type':'application/json','Prefer':'return=representation'}
 data=None if body is None else json.dumps(body).encode()
 request=urllib.request.Request(base+path,data=data,headers=headers,method=method)
 try:
  with urllib.request.urlopen(request,timeout=15) as r: raw=r.read();return r.status,json.loads(raw) if raw else None
 except urllib.error.HTTPError as e:
  raw=e.read();return e.code,json.loads(raw) if raw else None

def check(name,cond):
 if not cond: raise AssertionError(name)
 passed.append(name)
def rpc(token,name,data): return req('POST','/rest/v1/rpc/'+name,token,data)
try:
 tokens=[]
 for i in range(3):
  email='community-review-'+uuid.uuid4().hex+'@mizyun.test';password=secrets.token_urlsafe(28)
  status,data=req('POST','/auth/v1/admin/users',body={'email':email,'password':password,'email_confirm':True},admin_call=True)
  check('Create synthetic local account '+str(i),status==200);uid=data['id'];users.append(uid)
  status,data=req('POST','/auth/v1/token?grant_type=password',body={'email':email,'password':password});check('Real Auth login '+str(i),status==200);tokens.append(data['access_token'])
  status,_=req('PATCH','/rest/v1/profiles?id=eq.'+uid,body={'birth_year':1990},admin_call=True);check('Local adult fixture '+str(i),status==200)
 a,b,c=tokens; ua,ub,uc=users
 status,data=rpc(c,'community_get_profile',{'p_user_id':uc});check('Never-enrolled self returns empty',status==200 and data==[])
 for t,h in [(a,'rest_a_'+uuid.uuid4().hex[:8]),(b,'rest_b_'+uuid.uuid4().hex[:8])]:
  status,data=rpc(t,'community_save_profile',{'p_handle':h,'p_display_name':'Synthetic participant','p_avatar_symbol':'SP','p_bio':'Non-public bio','p_is_searchable':False,'p_adult_declaration':True,'p_terms_version':'2026-09-30'});check('Explicit RPC enrollment '+h[:6],status==200 and len(data)==1)
  if t==a: author_handle=h
 status,data=rpc(c,'community_handle_available',{'p_handle':author_handle});check('Unenrolled availability sees reservation only',status==200 and data==[{'available':False}])
 status,data=req('GET','/rest/v1/community_profiles?user_id=eq.'+ua,b);check('Hidden raw identity denied',status==200 and data==[])
 status,data=req('GET','/rest/v1/community_invitations',b);check('No enumerable foreign invitation tokens',status==200 and data==[])
 token=secrets.token_urlsafe(16)
 status,data=rpc(a,'community_create_invitation',{'p_token':token,'p_expires_in_days':7});check('Owner creates invite',status==200)
 status,data=rpc(b,'community_resolve_invitation',{'p_token':token});check('Known token resolves minimal hidden identity',status==200 and data[0]['inviter']['user_id']==ua and data[0]['inviter']['bio'] is None)
 status,_=rpc(b,'community_request_follow',{'p_operation_id':str(uuid.uuid4()),'p_target_user_id':ua});check('Guessed UUID cannot request hidden identity',status>=400)
 status,data=rpc(b,'community_request_follow',{'p_operation_id':str(uuid.uuid4()),'p_target_user_id':ua,'p_invitation_token':token});check('Invite grants deliberate request capability',status==200);edge=data[0]['id']
 status,_=req('PATCH','/rest/v1/community_relationships?id=eq.'+edge,b,{'status':'approved'});check('Requester approval denied',status>=400)
 status,data=req('PATCH','/rest/v1/community_relationships?id=eq.'+edge,a,{'status':'approved'});check('Recipient approves',status==200 and len(data)==1)
 now=datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0);workout=str(uuid.uuid4());activityargs={'p_source_workout_id':workout,'p_category':'strength','p_shared_day':now.date().isoformat(),'p_duration_seconds':60,'p_enrollment_generation':1,'p_operation_id':str(uuid.uuid4())}
 status,_=req('POST','/rest/v1/workouts',a,{'id':workout,'user_id':ua,'name':'Synthetic private name','started_at':(now-datetime.timedelta(seconds=60)).isoformat(),'completed_at':now.isoformat(),'details':{'workoutLifecycle':{'kind':'session'}}});check('Real owner source insertion',status==201)
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  results=list(pool.map(lambda _:rpc(a,'community_publish_activity',activityargs),range(2)))
 check('Concurrent same-operation publication is one stable snapshot',all(s==200 for s,_ in results) and results[0][1][0]['id']==results[1][1][0]['id'] and results[0][1][0]['version']==results[1][1][0]['version']==1)
 card=results[0][1][0]['id']
 status,data=rpc(b,'community_get_activity',{'p_activity_id':card});check('Follower projection scrubs source',status==200 and data[0]['source_workout_id']=='00000000-0000-0000-0000-000000000000')
 status,data=req('GET','/rest/v1/workouts?id=eq.'+workout,b);check('Follower cannot load private source',status==200 and data==[])
 status,_=req('POST','/rest/v1/community_reactions',b,{'activity_id':card,'user_id':ub,'reaction':'clap'});check('Permitted real reaction',status==201)
 status,_=req('PATCH','/rest/v1/workouts?id=eq.'+workout,a,{'completed_at':None});check('Direct source correction succeeds',status==200)
 status,data=rpc(b,'community_get_activity',{'p_activity_id':card});check('Direct correction revokes follower read',status==200 and data==[])
 status,data=req('GET','/rest/v1/community_reactions?activity_id=eq.'+card,admin_call=True);check('Direct correction deletes all reactions',status==200 and data==[])
 status,_=req('POST','/rest/v1/community_blocks',a,{'blocker_user_id':ua,'blocked_user_id':ub});check('Bilateral block inserted',status==201)
 status,data=rpc(b,'community_is_unavailable',{'p_other_user_id':ua});check('Incoming block recognized over real transport',status==200 and data==[{'is_unavailable':True}])
 status,data=rpc(b,'community_resolve_invitation',{'p_token':token});check('Block defeats bearer invitation',status==200 and data==[])
 status,_=req('DELETE','/rest/v1/community_blocks?blocker_user_id=eq.'+ua+'&blocked_user_id=eq.'+ub,a)
 check('Author removes own block',status==200)
 status,data=rpc(b,'community_request_follow',{'p_operation_id':str(uuid.uuid4()),'p_target_user_id':ua,'p_invitation_token':token})
 check('Fresh explicit request after unblock',status==200);edge=data[0]['id']
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  approve=pool.submit(req,'PATCH','/rest/v1/community_relationships?id=eq.'+edge,a,{'status':'approved'})
  block=pool.submit(req,'POST','/rest/v1/community_blocks',a,{'blocker_user_id':ua,'blocked_user_id':ub})
  approval_result=approve.result();block_result=block.result()
 check('Concurrent block commits',block_result[0]==201)
 status,data=req('GET','/rest/v1/community_relationships?id=eq.'+edge,a)
 check('Approval racing block leaves no forbidden edge',status==200 and data==[])
 status,data=rpc(b,'community_is_unavailable',{'p_other_user_id':ua})
 check('Concurrent block remains authoritative',status==200 and data==[{'is_unavailable':True}])
 print('Local real Auth/PostgREST assertions passed:',len(passed))
finally:
 for uid in reversed(users):
  status,_=req('DELETE','/auth/v1/admin/users/'+uid,admin_call=True)
  if status!=200: raise AssertionError('Synthetic account cleanup failed')
 print('Synthetic local Auth accounts removed:',len(users))
