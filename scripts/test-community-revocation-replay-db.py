#!/usr/bin/env python3
"""Synthetic positive replay proof in a unique network-none disposable container.

Reads schema/grants/version numbers only from the named local disposable stack.
Never copies user data, connects to a remote Docker host, mounts host directories,
publishes ports, or opens restored traffic. Execute only in the final test phase.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import time
import uuid

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('quarantine', ROOT / 'scripts/restore-dev-quarantined.py')
quarantine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quarantine)
SOURCE_CONTAINER = 'supabase_db_mizyun'
run = quarantine.run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--logs', type=Path, required=True)
    args = parser.parse_args()
    args.logs.mkdir(parents=True, exist_ok=True)
    # Exact local CLI identity, never an environment-supplied Docker endpoint.
    origin = json.loads(run(['docker', 'inspect', SOURCE_CONTAINER]))
    if len(origin) != 1 or origin[0].get('Name') != '/' + SOURCE_CONTAINER or origin[0].get('Config', {}).get('Labels', {}).get('com.supabase.cli.project') != 'mizyun':
        raise ValueError('Local disposable schema source identity mismatch')
    versions = run(['docker', 'exec', SOURCE_CONTAINER, 'psql', '-X', '-At', '-U', 'postgres', '-d', 'postgres', '-c', 'select version from supabase_migrations.schema_migrations order by version']).decode().splitlines()
    if not {'20260930100000', '20260930110000', '20260930120000'} <= set(versions) or any(not re.fullmatch(r'\d{14}', v) for v in versions):
        raise ValueError('Local Community foundation schema required')
    schema = run(['docker', 'exec', SOURCE_CONTAINER, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner', '--no-privileges'])
    role_names = run(['docker', 'exec', SOURCE_CONTAINER, 'psql', '-X', '-At', '-U', 'postgres', '-d', 'postgres', '-c', "select rolname from pg_roles where rolname not like 'pg_%' order by rolname"]).decode().splitlines()
    if not role_names or any(not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]{0,62}', role) for role in role_names):
        raise ValueError('Unsupported schema role identity')
    acl = run(['docker', 'exec', SOURCE_CONTAINER, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only', '--no-owner']).decode()
    grants = '\n'.join(line for line in acl.splitlines() if (line.startswith('GRANT ') or line.startswith('REVOKE ')) and any(scope in line for scope in (' public.', ' auth.', ' storage.', 'SCHEMA public ', 'SCHEMA auth ', 'SCHEMA storage ')) and 'pg_stat_' not in line).encode()
    token = uuid.uuid4().hex
    name = 'mizyun-dev-quarantine-' + token
    if run(['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}']).strip():
        raise ValueError('Disposable name already exists')
    attempted = False
    proof = None
    hashes = {}
    try:
        attempted = True
        run(['docker', 'run', '-d', '--pull', 'never', '--name', name,
             '--label', quarantine.LABEL + '=' + token, '--network', 'none',
             '--security-opt', 'no-new-privileges', '--pids-limit', '128', '--memory', '1g', '--cpus', '2',
             '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,size=768m',
             '--tmpfs', '/var/run/postgresql:rw,nosuid,size=16m',
             '--tmpfs', '/tmp:rw,nosuid,size=256m',
             '-e', 'POSTGRES_PASSWORD=quarantined-only', quarantine.IMAGE])
        identifier = quarantine.inspect_container(name, token)
        for attempt in range(60):
            if b'PostgreSQL init process complete' in run(['docker', 'logs', identifier], timeout=5):
                run(['docker', 'exec', identifier, 'pg_isready', '-U', 'supabase_admin'], timeout=5)
                break
            if attempt == 59:
                raise RuntimeError('Disposable initialization incomplete')
            time.sleep(1)
        run(['docker', 'exec', identifier, 'createdb', '-U', 'supabase_admin', 'mizyun_restore'])

        def sql(text):
            return run(['docker', 'exec', '-i', identifier, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', 'mizyun_restore', '-v', 'ON_ERROR_STOP=1'], data=text if isinstance(text, bytes) else text.encode()).decode().strip()

        # Copy names only, never passwords, login settings or privileged role
        # membership. Existing image roles retain their own bootstrap authority.
        for role in role_names:
            sql('DO $roles$ BEGIN CREATE ROLE "' + role + '" NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $roles$;')
        sql(schema)
        sql(grants)
        applied = []
        for path in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
            if path.name.split('_', 1)[0] not in versions:
                source = path.read_bytes()
                hashes[str(path.relative_to(ROOT))] = hashlib.sha256(source).hexdigest()
                sql(source)
                applied.append(path.name.split('_', 1)[0])
        sql("insert into public.community_operations(singleton) values(true) on conflict do nothing;")
        sql("insert into public.community_feature_controls(feature) values('comments'),('groups'),('challenges'),('messaging'),('media'),('routines'),('discovery') on conflict do nothing;")
        sql("insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('community-media','community-media',false,2097152,array['image/jpeg']) on conflict do nothing;")
        # Five invented accounts; no records were copied from the schema source.
        sql("""
set request.jwt.claim.role='service_role';
update public.community_operations set enabled=true,enrollment=true,discovery=true,publish=true,engagement=true,delivery=false,cohort_required=false;
update public.community_feature_controls set enabled=true;
insert into auth.users(id,email) select ('c3900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'replay-'||n||'@mizyun.test' from generate_series(1,5)n;
update public.profiles set birth_year=1990 where id::text like 'c3900000-%';
insert into public.community_profiles(user_id,handle,display_name,status,generation,terms_version,terms_accepted_at,adult_declared_at)
select id,'replay_'||right(id::text,12),'Synthetic replay','active',case when right(id::text,1)='2' then 2 else 1 end,'2026-09-30',now(),now() from auth.users where id::text like 'c3900000-%';
update public.community_profiles set is_searchable=true where user_id='c3900000-0000-4000-8000-000000000003';
insert into public.workouts(id,user_id,name,started_at,completed_at,details) values('d3900000-0000-4000-8000-000000000001','c3900000-0000-4000-8000-000000000003','Synthetic private',now(),now(),'{}');
insert into public.shared_activities(id,user_id,source_workout_id,shared_day,enrollment_generation) values('a3900000-0000-4000-8000-000000000001','c3900000-0000-4000-8000-000000000003','d3900000-0000-4000-8000-000000000001','2026-10-08',1);
insert into public.community_comments(id,activity_id,user_id,body,generation) values('a3900000-0000-4000-8000-000000000002','a3900000-0000-4000-8000-000000000001','c3900000-0000-4000-8000-000000000003','Synthetic comment',1);
insert into public.community_comments(id,activity_id,user_id,body,generation) values('a3900000-0000-4000-8000-000000000009','a3900000-0000-4000-8000-000000000001','c3900000-0000-4000-8000-000000000002','Later generation comment',2);
insert into public.community_comment_mentions(user_id,comment_id,generation) values('c3900000-0000-4000-8000-000000000003','a3900000-0000-4000-8000-000000000009',1);
insert into public.community_messages(id,user_id,recipient_id,body,original_digest,sender_generation,recipient_generation) values('a3900000-0000-4000-8000-000000000003','c3900000-0000-4000-8000-000000000003','c3900000-0000-4000-8000-000000000002','Synthetic message',repeat('a',64),1,2);
insert into public.community_media_assets(id,user_id,generation,operation_id,digest,alt_text,state) values('a3900000-0000-4000-8000-000000000004','c3900000-0000-4000-8000-000000000003',1,'a3900000-0000-4000-8000-000000000005',repeat('a',64),'Synthetic still','pending');
insert into public.community_routine_shares(id,user_id,source_workout_id,source_updated_at,operation_id,enrollment_generation,snapshot) values('a3900000-0000-4000-8000-000000000006','c3900000-0000-4000-8000-000000000003','d3900000-0000-4000-8000-000000000001',now(),'a3900000-0000-4000-8000-000000000007',1,'{"schemaVersion":"2026-10-01","title":"Synthetic public plan","exercises":[]}');
insert into public.community_relationships(id,follower_user_id,target_user_id,status) values('a3900000-0000-4000-8000-000000000008','c3900000-0000-4000-8000-000000000003','c3900000-0000-4000-8000-000000000004','approved');
insert into public.community_messaging_preferences(user_id,generation,enabled) values('c3900000-0000-4000-8000-000000000003',1,true);
insert into public.community_broader_discovery_preferences(user_id,generation,enabled) values('c3900000-0000-4000-8000-000000000003',1,true);
insert into public.community_reactions(id,activity_id,user_id,reaction) values('b3900000-0000-4000-8000-000000000010','a3900000-0000-4000-8000-000000000001','c3900000-0000-4000-8000-000000000002','clap');
insert into public.community_groups(id,user_id,created_by,operation_id,name,rules) values('b3900000-0000-4000-8000-000000000011','c3900000-0000-4000-8000-000000000003','c3900000-0000-4000-8000-000000000003','b3900000-0000-4000-8000-000000000012','Synthetic group','Synthetic rules');
insert into public.community_group_members(group_id,user_id,role,state,generation,joined_at) values
 ('b3900000-0000-4000-8000-000000000011','c3900000-0000-4000-8000-000000000003','owner','member',1,'2026-10-07T08:00:00Z'),
 ('b3900000-0000-4000-8000-000000000011','c3900000-0000-4000-8000-000000000002','member','member',2,'2026-10-07T08:00:00Z');
insert into public.community_challenges(id,user_id,group_id,title,start_day,end_day,timezone,goal_days) values('b3900000-0000-4000-8000-000000000013','c3900000-0000-4000-8000-000000000003','b3900000-0000-4000-8000-000000000011','Synthetic challenge','2026-10-08','2026-10-10','UTC',2);
insert into public.community_challenge_members(user_id,challenge_id,generation) values('c3900000-0000-4000-8000-000000000002','b3900000-0000-4000-8000-000000000013',2);
insert into public.community_challenge_contributions(user_id,challenge_id,day,kind,created_at) values
 ('c3900000-0000-4000-8000-000000000003','b3900000-0000-4000-8000-000000000013','2026-10-08','rest','2026-10-07T08:00:00Z'),
 ('c3900000-0000-4000-8000-000000000003','b3900000-0000-4000-8000-000000000013','2026-10-09','rest','2026-10-09T08:00:00Z');
insert into public.community_comment_preferences(user_id,allow_mentions) values
 ('c3900000-0000-4000-8000-000000000003',true),('c3900000-0000-4000-8000-000000000002',true);
insert into public.community_comment_settings(activity_id,user_id,enabled) values('a3900000-0000-4000-8000-000000000001','c3900000-0000-4000-8000-000000000003',true);
insert into public.community_notification_preferences(user_id) values('c3900000-0000-4000-8000-000000000002');
insert into public.workouts(id,user_id,name,started_at,completed_at,details) values('d3900000-0000-4000-8000-000000000002','c3900000-0000-4000-8000-000000000002','Synthetic later private',now(),now(),'{}');
insert into public.shared_activities(id,user_id,source_workout_id,shared_day,enrollment_generation,workout_details) values('a3900000-0000-4000-8000-000000000014','c3900000-0000-4000-8000-000000000002','d3900000-0000-4000-8000-000000000002','2026-10-11',2,'{"exercises":[]}');
insert into public.community_comment_settings(activity_id,user_id,enabled) values('a3900000-0000-4000-8000-000000000014','c3900000-0000-4000-8000-000000000002',true);
insert into public.community_comment_mentions(user_id,comment_id,generation) values('c3900000-0000-4000-8000-000000000002','a3900000-0000-4000-8000-000000000009',2);
""")
        users = ['c3900000-0000-4000-8000-' + str(n).zfill(12) for n in range(1, 6)]

        def event(number, kind, user, target=None, generation=None, peer=None):
            return {'event_id': 'e3900000-0000-4000-8000-' + str(number).zfill(12), 'user_id': user,
                    'kind': kind, 'generation': generation, 'target_id': target,
                    'related_user_id': peer, 'created_at': '2026-10-08T08:00:00+00:00'}

        events = [event(1, 'withdrawal', users[0], generation=1),
                  event(2, 'withdrawal', users[1], generation=1),
                  event(3, 'block', users[2], 'b3900000-0000-4000-8000-000000000001', peer=users[3]),
                  event(4, 'sanction', users[3], 'b3900000-0000-4000-8000-000000000002'),
                  event(5, 'account_erasure', users[4], 'b3900000-0000-4000-8000-000000000003')]
        for number, kind, target in [(6, 'activity', 1), (7, 'comment', 2), (8, 'message', 3), (9, 'media', 4), (10, 'routine', 6)]:
            events.append(event(number, kind, users[2], 'a3900000-0000-4000-8000-' + str(target).zfill(12), generation=1))
        events.extend([event(11, 'comment', users[2], 'a3900000-0000-4000-8000-000000000009', generation=2),
                       event(12, 'comment', users[1], 'a3900000-0000-4000-8000-000000000009', generation=1)])
        events.extend([event(14, 'messaging_optout', users[2], users[2], generation=1),
                       event(15, 'discovery_optout', users[2], users[2], generation=1),
                       event(16, 'challenge_membership', users[1], 'b3900000-0000-4000-8000-000000000013', generation=2),
                       event(18, 'challenge_contribution', users[2], 'b3900000-0000-4000-8000-000000000013'),
                       event(19, 'group_membership', users[1], 'b3900000-0000-4000-8000-000000000011', generation=2)])
        events.extend([
            event(20, 'mute', users[2], users[1], generation=1, peer=users[1]),
            event(21, 'mention_optout', users[2], users[2], generation=1),
            event(22, 'comment_setting_optout', users[2], 'a3900000-0000-4000-8000-000000000001', generation=1),
            event(23, 'notification_optout', users[2], users[2], generation=1),
            event(24, 'mute', users[1], users[2], generation=1, peer=users[2]),
            event(25, 'mention_optout', users[1], users[1], generation=1),
            event(26, 'comment_setting_optout', users[1], 'a3900000-0000-4000-8000-000000000014', generation=1),
            event(27, 'notification_optout', users[1], users[1], generation=1),
            event(28, 'activity', users[1], 'a3900000-0000-4000-8000-000000000014', generation=1),
            event(29, 'comment_setting_optout', users[1], 'a3900000-0000-4000-8000-000000000001', generation=2),
        ])
        events.insert(0, event(17, 'reaction', users[1], 'b3900000-0000-4000-8000-000000000010'))
        # Every call uses the same controlled container; event bytes are encoded,
        # never interpolated as executable SQL.
        def replay(items):
            encoded = json.dumps(items, separators=(',', ':')).encode().hex()
            return json.loads(sql("set mizyun.restore_environment='dev';set mizyun.restore_run_id='" + token + "';select public.community_revocation_replay(convert_from(decode('" + encoded + "','hex'),'UTF8')::jsonb);"))

        try:
            replay(events)
        except RuntimeError:
            pass
        else:
            raise AssertionError('Open controls allowed replay')
        sql("set mizyun.restore_environment='dev';set mizyun.restore_run_id='" + token + "';" + (ROOT / 'scripts/sql/quarantine-community-restored-dev.sql').read_text())
        initial = json.loads(sql("select jsonb_build_object('capture',(select count(*) from public.community_revocation_events));"))
        first = replay(events)
        if first.get('processedCount') != len(events) or first.get('appliedCount') != len(events) or first.get('reopenPermitted') is not False or first.get('reconciliationComplete') is not False:
            raise AssertionError('Replay proof mismatch')
        second = replay(events)
        if second.get('processedCount') != len(events) or second.get('appliedCount') != 0:
            raise AssertionError('Lost-response replay was not idempotent')
        try:
            sql("update public.community_profiles set display_name='Attempted growth edit',bio='Attempted changed bio' where user_id='c3900000-0000-4000-8000-000000000003';")
        except RuntimeError:
            pass
        else:
            raise AssertionError('Closed growth allowed identity/content edits')
        invalid = {**events[0], 'generation': 2}
        try:
            replay([invalid])
        except RuntimeError:
            pass
        else:
            raise AssertionError('Conflicting event identity accepted')
        try:
            replay([event(13, 'comment', users[1], 'a3900000-0000-4000-8000-000000000009')])
        except RuntimeError:
            pass
        else:
            raise AssertionError('Null-generation artifact accepted')
        proof = json.loads(sql("""select jsonb_build_object(
 'withdrawn',(select status='withdrawn' from public.community_profiles where user_id='c3900000-0000-4000-8000-000000000001'),
 'laterGenerationPreserved',(select status='active' and generation=2 from public.community_profiles where user_id='c3900000-0000-4000-8000-000000000002'),
 'blockRestored',exists(select 1 from public.community_blocks where blocker_user_id='c3900000-0000-4000-8000-000000000003' and blocked_user_id='c3900000-0000-4000-8000-000000000004'),
 'edgeRemoved',not exists(select 1 from public.community_relationships),
 'sanctionHeld',exists(select 1 from public.community_restore_holds where user_id='c3900000-0000-4000-8000-000000000004' and reason='sanction'),
 'accountErased',not exists(select 1 from auth.users where id='c3900000-0000-4000-8000-000000000005'),
 'activityRevoked',(select revoked_at is not null from public.shared_activities where id='a3900000-0000-4000-8000-000000000001'),
 'routineRevoked',(select revoked_at is not null from public.community_routine_shares where id='a3900000-0000-4000-8000-000000000006'),
 'commentErased',(select body is null and removed_at is not null from public.community_comments where id='a3900000-0000-4000-8000-000000000002'),
 'forgedAndOlderCommentPreserved',(select body='Later generation comment' and removed_at is null from public.community_comments where id='a3900000-0000-4000-8000-000000000009'),
 'recipientMentionRevoked',(select revoked from public.community_comment_mentions where comment_id='a3900000-0000-4000-8000-000000000009' and user_id='c3900000-0000-4000-8000-000000000003'),
 'laterMentionPreserved',(select not revoked from public.community_comment_mentions where comment_id='a3900000-0000-4000-8000-000000000009' and user_id='c3900000-0000-4000-8000-000000000002'),
 'mentionConsentReduced',(select not allow_mentions from public.community_comment_preferences where user_id='c3900000-0000-4000-8000-000000000003'),
 'laterMentionConsentPreserved',(select allow_mentions from public.community_comment_preferences where user_id='c3900000-0000-4000-8000-000000000002'),
 'commentSettingReduced',(select not enabled from public.community_comment_settings where activity_id='a3900000-0000-4000-8000-000000000001'),
 'laterCommentSettingPreserved',(select enabled from public.community_comment_settings where activity_id='a3900000-0000-4000-8000-000000000014'),
 'notificationReductionCreated',(select muted and not requests and not reactions and not moderation from public.community_notification_preferences where user_id='c3900000-0000-4000-8000-000000000003'),
 'laterNotificationPreferencePreserved',(select not muted and requests and reactions and moderation from public.community_notification_preferences where user_id='c3900000-0000-4000-8000-000000000002'),
 'muteRestored',exists(select 1 from public.community_mutes where user_id='c3900000-0000-4000-8000-000000000003' and target_user_id='c3900000-0000-4000-8000-000000000002'),
 'laterMutePreferencePreserved',not exists(select 1 from public.community_mutes where user_id='c3900000-0000-4000-8000-000000000002'),
 'laterHealthProjectionPreserved',(select revoked_at is null and workout_details is not null from public.shared_activities where id='a3900000-0000-4000-8000-000000000014'),
 'messageErased',not exists(select 1 from public.community_messages where id='a3900000-0000-4000-8000-000000000003' and (body is not null or deleted_at is null)),
 'mediaRevoked',(select state='revoked' from public.community_media_assets where id='a3900000-0000-4000-8000-000000000004'),
 'storageTicketRetained',exists(select 1 from public.community_media_cleanup_jobs where id='a3900000-0000-4000-8000-000000000004'),
 'privateWorkoutPreserved',exists(select 1 from public.workouts where id='d3900000-0000-4000-8000-000000000001'),
 'messagingOptedOut',(select not enabled from public.community_messaging_preferences where user_id='c3900000-0000-4000-8000-000000000003'),
 'discoveryOptedOut',(select not enabled from public.community_broader_discovery_preferences where user_id='c3900000-0000-4000-8000-000000000003'),
 'handleSearchDisabled',(select not is_searchable from public.community_profiles where user_id='c3900000-0000-4000-8000-000000000003'),
 'identityEditDenied',(select display_name='Synthetic replay' and bio is null from public.community_profiles where user_id='c3900000-0000-4000-8000-000000000003'),
 'reactionErased',not exists(select 1 from public.community_reactions where id='b3900000-0000-4000-8000-000000000010'),
 'groupDepartureApplied',not exists(select 1 from public.community_group_members where group_id='b3900000-0000-4000-8000-000000000011' and user_id='c3900000-0000-4000-8000-000000000002'),
 'challengeDepartureApplied',not exists(select 1 from public.community_challenge_members where challenge_id='b3900000-0000-4000-8000-000000000013' and user_id='c3900000-0000-4000-8000-000000000002'),
 'priorContributionErased',not exists(select 1 from public.community_challenge_contributions where challenge_id='b3900000-0000-4000-8000-000000000013' and user_id='c3900000-0000-4000-8000-000000000003' and day='2026-10-08'),
 'laterContributionPreserved',exists(select 1 from public.community_challenge_contributions where challenge_id='b3900000-0000-4000-8000-000000000013' and user_id='c3900000-0000-4000-8000-000000000003' and day='2026-10-09'),
 'operationsClosed',not exists(select 1 from public.community_operations where enabled or enrollment or discovery or publish or engagement or delivery or not cohort_required),
 'capture',(select count(*) from public.community_revocation_events));"""))
        if any(value is not True for key, value in proof.items() if key != 'capture') or proof['capture'] != initial['capture']:
            raise AssertionError('Synthetic privacy replay assertion failed')
        quarantine.inspect_container(name, token)
        proof.update({'processedEvents': len(events), 'repeatAppliedCount': second['appliedCount'],
                      'openReplayRejected': True, 'conflictingReplayRejected': True,
                      'nullGenerationArtifactRejected': True,
                      'reportAuditErasureVerified': False,
                      'sharedUserDataCopied': False, 'reopenPermitted': False,
                      'externalCompletenessCertified': False, 'physicalStorageErasureVerified': False,
                      'schemaSHA256': hashlib.sha256(schema).hexdigest(),
                      'baseMigrations': versions, 'appliedMigrations': applied, 'sourceSHA256': hashes})
    finally:
        if attempted:
            present = run(['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}']).strip()
            if present:
                identifier = quarantine.inspect_container(name, token)
                run(['docker', 'rm', '-f', '-v', identifier])
                if run(['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}']).strip():
                    raise RuntimeError('Disposable cleanup unverified')
    proof['disposableResourcesRemoved'] = True
    (args.logs / 'community-revocation-replay-db.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps(proof, sort_keys=True))


if __name__ == '__main__':
    main()
