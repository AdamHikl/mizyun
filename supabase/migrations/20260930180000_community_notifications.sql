-- COMM-10. Logical inbox events are transactional; external delivery is at least once.
begin;
create table public.community_notification_preferences(user_id uuid primary key references auth.users(id) on delete cascade,requests boolean not null default true,reactions boolean not null default true,moderation boolean not null default true,muted boolean not null default false,timezone text not null default 'UTC',quiet_start integer check(quiet_start between 0 and 1439),quiet_end integer check(quiet_end between 0 and 1439),check((quiet_start is null)=(quiet_end is null)),check(quiet_start<>quiet_end));
create table public.community_inbox_events(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,actor_user_id uuid references auth.users(id) on delete cascade,kind text not null check(kind in ('request','approval','reaction','moderation')),target_id uuid,source_id uuid,activity_version integer,generation integer not null,dedupe_key text not null check(length(dedupe_key)<=200),created_at timestamptz not null default now(),read_at timestamptz,expires_at timestamptz not null default now()+interval '30 days',unique(user_id,dedupe_key));
create index community_inbox_owner_page on public.community_inbox_events(user_id,created_at desc,id desc);
create index community_inbox_actor on public.community_inbox_events(actor_user_id);
create index community_inbox_expiry on public.community_inbox_events(expires_at);
create table public.community_notification_dedupe(user_id uuid not null references auth.users(id) on delete cascade,dedupe_key text not null,expires_at timestamptz not null default now()+interval '30 days',primary key(user_id,dedupe_key));
create table public.community_push_tokens(installation_id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,token text not null unique check(token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$'),session_id text not null,generation integer not null,updated_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 days');
create index community_push_owner on public.community_push_tokens(user_id);
create table public.community_notification_outbox(id uuid primary key default gen_random_uuid(),event_id uuid not null references public.community_inbox_events(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,installation_id uuid not null references public.community_push_tokens(installation_id) on delete cascade,status text not null default 'pending' check(status in ('pending','sent','suppressed','failed')),attempts integer not null default 0,next_attempt_at timestamptz not null default now(),lease_id uuid,lease_until timestamptz,receipt_id text,receipt_due_at timestamptz,receipt_status text,registry_token_hash text,expires_at timestamptz not null default now()+interval '1 day',unique(event_id,installation_id));
create index community_outbox_owner on public.community_notification_outbox(user_id);
create index community_outbox_ready on public.community_notification_outbox(next_attempt_at,id) where status='pending';
do $$declare t text;begin foreach t in array array['community_notification_preferences','community_inbox_events','community_push_tokens','community_notification_outbox','community_notification_dedupe'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;
-- Inbox reads are RPC-only so every access rechecks current visibility.
-- No direct DML or caller-supplied recipient/dedupe identity.
create function public.community_notification_visible(e public.community_inbox_events) returns boolean language plpgsql volatile security definer set search_path='' as $$begin
 if not public.community_eligible(e.user_id) or e.expires_at<=now() then return false;end if;
 if e.kind='moderation' then return exists(select 1 from public.community_reports where id=e.target_id and (reporter_user_id=e.user_id or subject_user_id=e.user_id));end if;
 if not public.community_active(e.user_id) or not public.community_active(e.actor_user_id) or e.generation<>(select generation from public.community_profiles where user_id=e.user_id) or public.community_blocked_between(e.user_id,e.actor_user_id) or exists(select 1 from public.community_mutes where user_id=e.user_id and target_user_id=e.actor_user_id) then return false;end if;
 if e.kind='request' then return exists(select 1 from public.community_relationships where id=e.target_id and follower_user_id=e.actor_user_id and target_user_id=e.user_id and status='pending');end if;
 if e.kind='approval' then return exists(select 1 from public.community_relationships where id=e.target_id and follower_user_id=e.user_id and target_user_id=e.actor_user_id and status='approved');end if;
 return exists(select 1 from public.community_reactions r join public.shared_activities a on a.id=r.activity_id join public.community_relationships f on f.follower_user_id=r.user_id and f.target_user_id=a.user_id and f.status='approved' where a.id=e.target_id and a.version=e.activity_version and r.id=e.source_id and a.user_id=e.user_id and r.user_id=e.actor_user_id and a.revoked_at is null and a.enrollment_generation=(select generation from public.community_profiles where user_id=e.user_id));
end $$;
create function public.community_enqueue_notification(p_user uuid,p_actor uuid,p_kind text,p_target uuid,p_key text,p_source uuid default null,p_version integer default null) returns void language plpgsql security definer set search_path='' as $$declare e public.community_inbox_events;inserted integer;begin
 if p_user is null or p_user=p_actor or not public.community_eligible(p_user) then return;end if;
 delete from public.community_notification_dedupe where user_id=p_user and expires_at<=now();
 if exists(select 1 from public.community_notification_dedupe where user_id=p_user and dedupe_key=p_key) or (select count(*) from public.community_notification_dedupe where user_id=p_user)>=5000 then return;end if;
 insert into public.community_notification_dedupe(user_id,dedupe_key) values(p_user,p_key) on conflict do nothing;get diagnostics inserted=row_count;if inserted=0 then return;end if;
 -- Retention and per-owner hard cap bound growth, without fanout to the graph.
 delete from public.community_inbox_events where user_id=p_user and expires_at<=now();
 if (select count(*) from public.community_inbox_events where user_id=p_user)>=500 then delete from public.community_inbox_events where id in(select id from public.community_inbox_events where user_id=p_user order by created_at,id limit 1);end if;
 insert into public.community_inbox_events(user_id,actor_user_id,kind,target_id,source_id,activity_version,generation,dedupe_key) values(p_user,p_actor,p_kind,p_target,p_source,p_version,coalesce((select generation from public.community_profiles where user_id=p_user),1),p_key) on conflict(user_id,dedupe_key) do nothing returning * into e;
 if e.id is null then return;end if;
 insert into public.community_notification_outbox(event_id,user_id,installation_id) select e.id,p_user,installation_id from public.community_push_tokens where user_id=p_user and generation=e.generation and expires_at>now();
end $$;
create function public.community_notification_trigger() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_table_name='community_relationships' then
 if tg_op='INSERT' and new.status='pending' then perform public.community_enqueue_notification(new.target_user_id,new.follower_user_id,'request',new.id,'request:'||new.id::text);
 elsif tg_op='UPDATE' and old.status is distinct from new.status and new.status='approved' then perform public.community_enqueue_notification(new.follower_user_id,new.target_user_id,'approval',new.id,'approval:'||new.id::text);end if;
 elsif tg_table_name='community_reactions' then
 if tg_op='INSERT' then perform public.community_enqueue_notification((select user_id from public.shared_activities where id=new.activity_id),new.user_id,'reaction',new.activity_id,'reaction:'||new.id::text,new.id,(select version from public.shared_activities where id=new.activity_id));end if;
 else
 if old.status is distinct from new.status and new.status in ('resolved','dismissed') then
 perform public.community_enqueue_notification(new.reporter_user_id,null,'moderation',new.id,'report:'||new.id::text||':'||new.status);
 if new.status='resolved' and new.decision<>'dismiss' then perform public.community_enqueue_notification(new.subject_user_id,null,'moderation',new.id,'subject:'||new.id::text);end if;end if;
 end if;return new;end $$;
create trigger community_notify_relationship after insert or update on public.community_relationships for each row execute function public.community_notification_trigger();
create trigger community_notify_reaction after insert on public.community_reactions for each row execute function public.community_notification_trigger();
create trigger community_notify_report after update on public.community_reports for each row execute function public.community_notification_trigger();
create function public.community_notifications(p_operation text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$declare u uuid:=auth.uid();e public.community_inbox_events;p public.community_notification_preferences;n integer;result jsonb;last_time timestamptz;last_id uuid;i uuid;session text;begin
 if u is null or not public.community_eligible(u) then raise exception 'community_access_denied';end if;
 perform public.community_lock();
 if p_operation='inbox' then
 n:=coalesce((p_args->>'limit')::integer,20);if n<1 or n>50 then raise exception 'community_invalid_action';end if;
 if p_args->>'cursor' is not null then last_time:=split_part(p_args->>'cursor','|',1)::timestamptz;last_id:=split_part(p_args->>'cursor','|',2)::uuid;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'kind',q.kind,'targetId',q.target_id,'createdAt',to_char(q.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'readAt',case when q.read_at is null then null else to_char(q.read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end) order by q.created_at desc,q.id desc),'[]') into result from (select * from public.community_inbox_events x where user_id=u and (last_time is null or (created_at,id)<(last_time,last_id)) and public.community_notification_visible(x) order by created_at desc,id desc limit n+1) q;
 return jsonb_build_object('items',case when jsonb_array_length(result)>n then result- n else result end,'nextCursor',case when jsonb_array_length(result)>n then (result->(n-1)->>'createdAt')||'|'||(result->(n-1)->>'id') else null end);
 elsif p_operation in ('read','resolve') then
 select * into e from public.community_inbox_events where id=(p_args->>'id')::uuid and user_id=u;
 if e.id is null or not public.community_notification_visible(e) then return null;end if;
 if p_operation='resolve' then return jsonb_build_object('destination',case e.kind when 'reaction' then 'activity' when 'moderation' then 'safety' else 'relationships' end,'targetId',case when e.kind='reaction' then e.target_id else null end);end if;
 update public.community_inbox_events set read_at=coalesce(read_at,now()) where id=e.id returning * into e;return jsonb_build_object('id',e.id,'readAt',to_char(e.read_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 elsif p_operation in ('preferences','savePreferences') then
 if p_operation='savePreferences' then
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_args->>'timezone') or not (p_args ?& array['requests','reactions','moderation','muted','timezone','quietHours']) then raise exception 'community_invalid_action';end if;
 insert into public.community_notification_preferences(user_id,requests,reactions,moderation,muted,timezone,quiet_start,quiet_end) values(u,(p_args->>'requests')::boolean,(p_args->>'reactions')::boolean,(p_args->>'moderation')::boolean,(p_args->>'muted')::boolean,p_args->>'timezone',(p_args->'quietHours'->>'startMinutes')::integer,(p_args->'quietHours'->>'endMinutes')::integer) on conflict(user_id) do update set requests=excluded.requests,reactions=excluded.reactions,moderation=excluded.moderation,muted=excluded.muted,timezone=excluded.timezone,quiet_start=excluded.quiet_start,quiet_end=excluded.quiet_end;
 end if;
 select * into p from public.community_notification_preferences where user_id=u;
 return jsonb_build_object('requests',coalesce(p.requests,true),'reactions',coalesce(p.reactions,true),'moderation',coalesce(p.moderation,true),'muted',coalesce(p.muted,false),'timezone',coalesce(p.timezone,'UTC'),'quietHours',case when p.quiet_start is null then null else jsonb_build_object('startMinutes',p.quiet_start,'endMinutes',p.quiet_end) end);
 elsif p_operation='registerToken' then
 if not public.community_active(u) then raise exception 'community_unavailable';end if;
 session:=nullif(auth.jwt()->>'session_id','');if session is null then raise exception 'community_access_denied';end if;i:=(p_args->>'installationId')::uuid;
 if (select count(*) from public.community_push_tokens where user_id=u and installation_id<>i)>=5 then raise exception 'community_rate_limited';end if;
 -- Same-owner refresh/rotation retains pending deliveries; authority is checked again at send.
 if exists(select 1 from public.community_push_tokens where installation_id=i and user_id=u) then
 delete from public.community_push_tokens where installation_id<>i and token=p_args->>'token';
 update public.community_push_tokens set token=p_args->>'token',session_id=session,generation=(select generation from public.community_profiles where user_id=u),updated_at=now(),expires_at=now()+interval '30 days' where installation_id=i and user_id=u;return '{}'::jsonb;
 end if;
 -- A different owner never inherits old pending device deliveries.
 delete from public.community_push_tokens where installation_id=i or token=p_args->>'token';
 insert into public.community_push_tokens(installation_id,user_id,token,session_id,generation) values(i,u,p_args->>'token',session,(select generation from public.community_profiles where user_id=u));return '{}'::jsonb;
 elsif p_operation='removeToken' then delete from public.community_push_tokens where installation_id=(p_args->>'installationId')::uuid and user_id=u;return '{}'::jsonb;
 end if;raise exception 'community_invalid_action';end $$;
-- Worker claims are short-lived; every dispatch requires a second current-authority check.
create function public.community_notification_claim(p_limit integer default 20) returns table(id uuid,lease_id uuid) language plpgsql security definer set search_path='' as $$begin
 return query with picked as(select o.id from public.community_notification_outbox o where o.status='pending' and o.next_attempt_at<=now() and (o.lease_until is null or o.lease_until<now()) order by o.next_attempt_at,o.id limit greatest(1,least(coalesce(p_limit,20),20)) for update skip locked) update public.community_notification_outbox o set lease_id=gen_random_uuid(),lease_until=now()+interval '30 seconds',attempts=attempts+1 from picked where o.id=picked.id returning o.id,o.lease_id;end $$;
create function public.community_notification_prepare(p_id uuid,p_lease_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare o public.community_notification_outbox;e public.community_inbox_events;t public.community_push_tokens;p public.community_notification_preferences;minute integer;begin
 perform public.community_lock();select * into o from public.community_notification_outbox where id=p_id and lease_id=p_lease_id and lease_until>now() and status='pending' for update;
 if o.id is null then return null;end if;
 select * into e from public.community_inbox_events where id=o.event_id;select * into t from public.community_push_tokens where installation_id=o.installation_id and user_id=o.user_id;select * into p from public.community_notification_preferences where user_id=o.user_id;
 if not public.community_operation_enabled('delivery',o.user_id) then update public.community_notification_outbox set next_attempt_at=now()+interval '5 minutes',attempts=greatest(0,attempts-1),lease_until=null where id=o.id;return null;end if;
 if o.expires_at<=now() or o.attempts>5 or e.id is null or t.installation_id is null or t.expires_at<=now() or t.generation<>e.generation or not exists(select 1 from auth.sessions where id::text=t.session_id and user_id=t.user_id and (not_after is null or not_after>now())) or not public.community_notification_visible(e) or coalesce(p.muted,false) or (e.kind in ('request','approval') and not coalesce(p.requests,true)) or (e.kind='reaction' and not coalesce(p.reactions,true)) or (e.kind='moderation' and not coalesce(p.moderation,true)) then update public.community_notification_outbox set status='suppressed',lease_until=null where id=o.id;return null;end if;
 minute:=extract(hour from now() at time zone coalesce(p.timezone,'UTC'))::integer*60+extract(minute from now() at time zone coalesce(p.timezone,'UTC'))::integer;
 if p.quiet_start is not null and ((p.quiet_start<p.quiet_end and minute>=p.quiet_start and minute<p.quiet_end) or (p.quiet_start>p.quiet_end and (minute>=p.quiet_start or minute<p.quiet_end))) then update public.community_notification_outbox set next_attempt_at=now()+interval '15 minutes',attempts=greatest(0,attempts-1),lease_until=null where id=o.id;return null;end if;
 update public.community_notification_outbox set registry_token_hash=encode(extensions.digest(t.token,'sha256'),'hex') where id=o.id;
 return jsonb_build_object('token',t.token,'eventId',e.id);
end $$;
create function public.community_notification_finish(p_id uuid,p_lease_id uuid,p_status text,p_receipt_id text default null) returns void language plpgsql security definer set search_path='' as $$declare o public.community_notification_outbox;begin
 if p_status not in ('accepted','retry','invalid') then raise exception 'community_invalid_action';end if;
 select * into o from public.community_notification_outbox where id=p_id and lease_id=p_lease_id and lease_until>now() and status='pending' for update;if o.id is null then return;end if;
 if p_status='invalid' then update public.community_notification_outbox set status='failed',lease_until=null where id=o.id;delete from public.community_push_tokens where installation_id=o.installation_id and user_id=o.user_id and encode(extensions.digest(token,'sha256'),'hex')=o.registry_token_hash;return;end if;
 update public.community_notification_outbox set status=case when p_status='accepted' then 'sent' when attempts>=5 then 'failed' else 'pending' end,next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,attempts)::integer)),receipt_id=case when p_status='accepted' then p_receipt_id else null end,receipt_due_at=case when p_status='accepted' and p_receipt_id is not null then now()+interval '15 minutes' else null end,lease_until=null where id=o.id;
end $$;
create function public.community_notification_receipts(p_limit integer default 20) returns table(id uuid,receipt_id text) language plpgsql security definer set search_path='' as $$begin
 return query with picked as(select o.id from public.community_notification_outbox o where o.status='sent' and o.receipt_id is not null and o.receipt_due_at<=now() and o.expires_at>now() order by o.receipt_due_at,o.id limit greatest(1,least(coalesce(p_limit,20),20)) for update skip locked) update public.community_notification_outbox o set receipt_due_at=now()+interval '15 minutes' from picked where o.id=picked.id returning o.id,o.receipt_id;
end $$;
create function public.community_notification_receipt_finish(p_id uuid,p_receipt_id text,p_status text) returns void language plpgsql security definer set search_path='' as $$declare o public.community_notification_outbox;begin
 if p_status not in ('ok','invalid','failed','retry') then raise exception 'community_invalid_action';end if;
 select * into o from public.community_notification_outbox where id=p_id and receipt_id=p_receipt_id for update;if o.id is null then return;end if;
 if p_status='retry' then return;end if;
 update public.community_notification_outbox set receipt_status=p_status,receipt_due_at=null where id=o.id;
 if p_status='invalid' then delete from public.community_push_tokens where installation_id=o.installation_id and user_id=o.user_id and encode(extensions.digest(token,'sha256'),'hex')=o.registry_token_hash;end if;
end $$;
do $$declare f record;begin for f in select p.oid::regprocedure name,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('community_notification_visible','community_enqueue_notification','community_notification_trigger','community_notifications','community_notification_claim','community_notification_prepare','community_notification_finish','community_notification_receipts','community_notification_receipt_finish') loop execute format('revoke all on function %s from public,anon,authenticated',f.name);execute format('grant execute on function %s to service_role',f.name);if f.proname='community_notifications' then execute format('grant execute on function %s to authenticated',f.name);end if;end loop;end $$;
commit;
