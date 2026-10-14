import os,sys,json,subprocess,hashlib,stat,fcntl,tempfile,time,urllib.request
from pathlib import Path
EXPECTED='d7e2055b260552c785325414756c6beeea1b7d8c'
MARKER='hetzner-primary-1d36b436-f4d5-4a29-b249-4153975563f3'
DEV='mizyun-api-dev.service'
ENV=Path('/etc/mizyun/dev.env')
def cmd(*args): return subprocess.check_output(args,text=True).strip()
def prop(service,key): return cmd('systemctl','show',service,'--property='+key,'--value')
def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def flags(data):
 out={}
 for line in data.decode().splitlines():
  if '=' in line and not line.lstrip().startswith('#'):
   k,v=line.split('=',1)
   if k in ('MIZYUN_MEAL_RECIPES_ENABLED','AI_EXTERNAL_ACCESS'):out[k]=v.strip().strip('"').strip("'")
 return out
assert os.geteuid()==0
lock=os.fdopen(os.open('/tmp/mizyun-deploy-dev.lock',os.O_RDWR|os.O_NOFOLLOW),'r+');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
s=Path('/etc/mizyun/host-role').stat();assert s.st_uid==0 and not s.st_mode&0o022
assert Path('/etc/mizyun/host-role').read_text().strip()==MARKER
assert prop(DEV,'WorkingDirectory')=='/var/lib/mizyun/dev/repo'
assert prop(DEV,'User')=='mizyun-dev-api'
assert '/etc/mizyun/dev.env ' in prop(DEV,'EnvironmentFiles')+' '
assert cmd('git','-c','safe.directory=/var/lib/mizyun/dev/repo','-C','/var/lib/mizyun/dev/repo','rev-parse','HEAD')==EXPECTED
assert not cmd('git','-c','safe.directory=/var/lib/mizyun/dev/repo','-C','/var/lib/mizyun/dev/repo','status','--porcelain')
assert ENV.is_file() and not ENV.is_symlink()
before=ENV.read_bytes();st=ENV.stat();prodhash=digest('/etc/mizyun/production.env');prodpid=prop('mizyun-api.service','MainPID')
report={'sourceSha':EXPECTED,'service':DEV,'hostMarkerVerified':True,'devCheckoutClean':True,'devEnvFlagsBefore':flags(before),'devPidBefore':prop(DEV,'MainPID'),'productionPidBefore':prodpid}
if '--apply' in sys.argv:
 assert ENV.read_bytes()==before
 lines=before.decode().splitlines(keepends=True)
 matches=[i for i,l in enumerate(lines) if l.startswith('MIZYUN_MEAL_RECIPES_ENABLED=')]
 assert len(matches)<=1
 if matches:lines[matches[0]]='MIZYUN_MEAL_RECIPES_ENABLED=true\n'
 else:
  if lines and not lines[-1].endswith('\n'):lines[-1]+='\n'
  lines.append('MIZYUN_MEAL_RECIPES_ENABLED=true\n')
 new=''.join(lines).encode()
 unchanged=lambda b:[l for l in b.decode().splitlines() if not l.startswith('MIZYUN_MEAL_RECIPES_ENABLED=')]
 assert unchanged(new)==unchanged(before)
 assert flags(new)['AI_EXTERNAL_ACCESS']=='true'
 if new!=before:
  backup=ENV.with_name('dev.env.before-recipe-enable-'+str(time.time_ns()))
  fd=os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'wb') as f:f.write(before);f.flush();os.fsync(f.fileno())
  fd,tmp=tempfile.mkstemp(prefix='.dev-recipes-',dir=ENV.parent)
  with os.fdopen(fd,'wb') as f:f.write(new);f.flush();os.fsync(f.fileno());os.fchmod(f.fileno(),stat.S_IMODE(st.st_mode));os.fchown(f.fileno(),st.st_uid,st.st_gid)
  os.replace(tmp,ENV)
 subprocess.run(['systemctl','restart',DEV],check=True,timeout=60)
report['devEnvFlagsAfter']=flags(ENV.read_bytes())
report['devPidAfter']=prop(DEV,'MainPID')
report['productionPidAfter']=prop('mizyun-api.service','MainPID')
report['productionEnvUnchanged']=digest('/etc/mizyun/production.env')==prodhash
report['productionPidUnchanged']=report['productionPidAfter']==prodpid
assert report['productionEnvUnchanged'] and report['productionPidUnchanged']
pid=int(report['devPidAfter']);env=dict(x.split('=',1) for x in Path('/proc/'+str(pid)+'/environ').read_bytes().decode().split('\0') if '=' in x)
report['effectiveSafeFlags']={k:env.get(k,'unset') for k in ('MIZYUN_MEAL_RECIPES_ENABLED','AI_EXTERNAL_ACCESS')}
report['providerKeyPresent']=bool(env.get('GEMINI_API_KEY'))
if '--apply' in sys.argv:assert report['effectiveSafeFlags']['MIZYUN_MEAL_RECIPES_ENABLED']=='true'
for attempt in range(25):
 try:
  with urllib.request.urlopen('http://127.0.0.1:4100/v1/readiness',timeout=3) as resp:ready=json.load(resp)
  if ready.get('ready'):break
 except Exception:pass
 time.sleep(1)
else:raise RuntimeError('Dev readiness did not recover')
assert ready['release']['sha']==EXPECTED
report['readiness']=ready
print(json.dumps(report,indent=2))
