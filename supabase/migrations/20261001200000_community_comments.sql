begin;
-- Comments are distinct social artifacts. The separate feature and every thread
-- start closed; neither membership nor an old workout share opts in to text.
create table public.community_comments (
 id uuid primary key, activity_id uuid not null references public.shared_activities(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 parent_id uuid references public.community_comments(id) on delete cascade,
 body text, mentions uuid[] not null default '{}', generation integer not null,
 version integer not null default 1 check(version>0), removed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(parent_id is null or parent_id<>id), check(cardinality(mentions)<=3),
 check((removed_at is null and char_length(body) between 1 and 500) or (removed_at is not null and body is null))
);
create index community_comments_user on public.community_comments(user_id);
create index community_comments_page on public.community_comments(activity_id,created_at,id);
create index community_comments_parent on public.community_comments(parent_id);
create table public.community_comment_settings(activity_id uuid primary key references public.shared_activities(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,enabled boolean not null default false);
create index community_comment_settings_user on public.community_comment_settings(user_id);
create table public.community_comment_preferences(user_id uuid primary key references auth.users(id) on delete cascade,allow_mentions boolean not null default false);
create table public.community_comment_operations(user_id uuid not null references auth.users(id) on delete cascade,operation_id uuid not null,comment_id uuid not null references public.community_comments(id) on delete cascade,payload_digest text not null,version integer not null,created_at timestamptz not null default now(),primary key(user_id,operation_id));
create index community_comment_operations_user_time on public.community_comment_operations(user_id,created_at);
create table public.community_comment_usage(user_id uuid not null references auth.users(id) on delete cascade,usage_day date not null,used integer not null check(used between 1 and 100),primary key(user_id,usage_day));
-- Generic, deduplicated mention inbox. No provider payload or comment text is
-- stored here. An edit never reissues an already used comment/recipient pair.
create table public.community_comment_mentions(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,comment_id uuid not null references public.community_comments(id) on delete cascade,generation integer not null,revoked boolean not null default false,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 days',unique(comment_id,user_id));
create index community_comment_mentions_user on public.community_comment_mentions(user_id,created_at);
do $$declare t text;begin foreach t in array array['community_comments','community_comment_settings','community_comment_preferences','community_comment_operations','community_comment_usage','community_comment_mentions'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;end $$;

create function public.community_comment_activity_visible(p_activity uuid,p_viewer uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select public.community_feature_enabled('comments',p_viewer) and public.community_active(p_viewer)
 and exists(select 1 from public.shared_activities a join public.community_profiles p on p.user_id=a.user_id
 where a.id=p_activity and a.revoked_at is null and a.published_at>now()-interval '365 days'
 and a.enrollment_generation=p.generation and public.community_active(a.user_id)
 and not public.community_blocked_between(p_viewer,a.user_id)
 and (a.user_id=p_viewer or exists(select 1 from public.community_relationships r where r.follower_user_id=p_viewer and r.target_user_id=a.user_id and r.status='approved')))
$$;
create function public.community_comment_visible_to(p_comment uuid,p_viewer uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.community_comments c join public.community_profiles p on p.user_id=c.user_id
 where c.id=p_comment and c.removed_at is null and c.generation=p.generation
 and public.community_active(c.user_id) and public.community_comment_activity_visible(c.activity_id,p_viewer)
 and not public.community_blocked_between(p_viewer,c.user_id)
 and (c.parent_id is null or exists(select 1 from public.community_comments root join public.community_profiles rp on rp.user_id=root.user_id
 where root.id=c.parent_id and root.activity_id=c.activity_id and root.parent_id is null and root.removed_at is null
 and root.generation=rp.generation and public.community_active(root.user_id) and not public.community_blocked_between(p_viewer,root.user_id))))
$$;
create function public.community_comment_visible(p_comment uuid) returns boolean language sql volatile security definer set search_path='' as $$select public.community_comment_visible_to(p_comment,auth.uid())$$;
-- Raw reads retain the current RLS boundary but cannot expose mention recipients
-- or enrollment internals. Recipient identities require the consent-filtered DTO.
grant select(id,activity_id,user_id,parent_id,body,version,removed_at,created_at,updated_at) on public.community_comments to authenticated;
create policy community_comment_read on public.community_comments for select to authenticated using(public.community_comment_visible(id));
-- All writes use the locked RPC. No direct client DML can forge author/version,
-- parent threads, mentions, approval, generation or the text-safety boundary.
create function public.community_comment_identity(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('userId',user_id,'handle',handle,'displayName',display_name,'avatarSymbol',avatar_symbol) from public.community_profiles where user_id=p_user
$$;
create function public.community_comment_mention_current(c public.community_comments,p_recipient uuid,p_viewer uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.community_comment_preferences pref join public.community_profiles profile on profile.user_id=pref.user_id
 join public.community_comment_mentions event on event.user_id=profile.user_id and event.comment_id=c.id and event.generation=profile.generation and not event.revoked and event.expires_at>now()
 where pref.user_id=p_recipient and pref.allow_mentions)
 and p_recipient=any(c.mentions) and public.community_comment_visible_to(c.id,p_recipient)
 and not public.community_blocked_between(c.user_id,p_recipient) and not public.community_blocked_between(p_viewer,p_recipient)
 and exists(select 1 from public.community_relationships r where r.follower_user_id=c.user_id and r.target_user_id=p_recipient and r.status='approved')
$$;
create function public.community_comment_dto(c public.community_comments,p_viewer uuid) returns jsonb language sql volatile security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'activityId',c.activity_id,'parentId',c.parent_id,'author',public.community_comment_identity(c.user_id),'body',c.body,'version',c.version,
 'createdAt',to_char(c.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char(c.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'mentions',coalesce((select jsonb_agg(public.community_comment_identity(m)) from unnest(c.mentions) m join public.community_comment_preferences pref on pref.user_id=m and pref.allow_mentions
 where public.community_comment_mention_current(c,m,p_viewer)), '[]'::jsonb))
$$;
create function public.community_comment_snapshot(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('activityId',activity_id,'parentId',parent_id,'text',body,'version',version) from public.community_comments where id=p_id
$$;
-- Chained wrappers preserve previous runtime behavior for existing targets.
alter function public.community_issue_report_receipt(text,text) rename to community_issue_report_receipt_before_comments;
create function public.community_issue_report_receipt(p_target_type text,p_target_id text) returns table(id uuid) language plpgsql security definer set search_path='' as $$
declare c public.community_comments;snapshot jsonb;receipt_id uuid;
begin
 if p_target_type is distinct from 'comment' then return query select * from public.community_issue_report_receipt_before_comments(p_target_type,p_target_id);return;end if;
 perform public.community_lock();
 if auth.uid() is null then raise exception 'community_access_denied';end if;
 select * into c from public.community_comments where community_comments.id=p_target_id::uuid;
 if c.id is null or c.user_id=auth.uid() or not public.community_comment_visible(c.id) then raise exception 'community_unavailable';end if;
 snapshot:=public.community_comment_snapshot(c.id);
 select r.id into receipt_id from public.community_report_receipts r where r.user_id=auth.uid() and r.target_type='comment' and r.target_id=p_target_id and r.evidence_snapshot=snapshot and r.expires_at>now() order by r.created_at desc limit 1;
 if receipt_id is null then insert into public.community_report_receipts(user_id,target_type,target_id,subject_user_id,evidence_snapshot) values(auth.uid(),'comment',p_target_id,c.user_id,snapshot) returning community_report_receipts.id into receipt_id;end if;
 if receipt_id is null then raise exception 'community_rate_limited';end if;
 return query select receipt_id;
end $$;
alter function public.community_submit_report(text,text,text,text,uuid) rename to community_submit_report_before_comments;
create function public.community_submit_report(p_target_type text,p_target_id text,p_reason text,p_notes text default null,p_interaction_receipt_id uuid default null) returns setof public.community_reports language plpgsql security definer set search_path='' as $$
declare r public.community_reports;receipt public.community_report_receipts;subject uuid;snapshot jsonb;n integer;
begin
 if p_target_type is distinct from 'comment' then return query select * from public.community_submit_report_before_comments(p_target_type,p_target_id,p_reason,p_notes,p_interaction_receipt_id);return;end if;
 perform public.community_lock();
 if auth.uid() is null then raise exception 'community_access_denied';end if;
 if p_reason is null or p_reason not in ('harassment','offensive_content','impersonation','spam','unsafe_or_sexual_content','other') or char_length(p_notes)>1000 then raise exception 'community_invalid_report';end if;
 select * into receipt from public.community_report_receipts where user_id=auth.uid() and target_type='comment' and target_id=p_target_id and expires_at>now() and (p_interaction_receipt_id is null or id=p_interaction_receipt_id) order by created_at desc limit 1;
 if p_interaction_receipt_id is not null and receipt.id is null then raise exception 'community_unavailable';end if;
 if receipt.id is null then
 if not public.community_comment_visible(p_target_id::uuid) then raise exception 'community_unavailable';end if;
 select user_id into subject from public.community_comments where id=p_target_id::uuid and user_id<>auth.uid();snapshot:=public.community_comment_snapshot(p_target_id::uuid);
 else subject:=receipt.subject_user_id;snapshot:=receipt.evidence_snapshot;end if;
 if (receipt.id is null and subject is null) or subject=auth.uid() or snapshot is null then raise exception 'community_unavailable';end if;
 select * into r from public.community_reports where reporter_user_id=auth.uid() and target_type='comment' and target_id=p_target_id and reason=p_reason and status in ('submitted','under_review') order by created_at limit 1 for update;
 if r.id is not null then update public.community_reports set notes=case when nullif(p_notes,'') is null then notes else left(concat_ws(E'\n',notes,p_notes),1000) end,updated_at=now() where id=r.id returning * into r;
 else
 insert into public.community_report_usage(user_id,report_date,report_count) values(auth.uid(),(now() at time zone 'UTC')::date,1) on conflict(user_id,report_date) do update set report_count=community_report_usage.report_count+1 where community_report_usage.report_count<10 returning report_count into n;
 if n is null then raise exception 'community_rate_limited';end if;
 insert into public.community_reports(reporter_user_id,target_type,target_id,reason,notes,priority,subject_user_id,evidence_snapshot) values(auth.uid(),'comment',p_target_id,p_reason,p_notes,case when p_reason in ('harassment','unsafe_or_sexual_content') then 'urgent' else 'normal' end,subject,snapshot) returning * into r;
 end if;
 r.subject_user_id:=null;r.evidence_snapshot:='{}';r.assigned_to:=null;r.staff_notes:=null;return next r;
end $$;
alter function public.community_apply_moderation_action(uuid,text,text,text,integer) rename to community_apply_moderation_action_before_comments;
create function public.community_apply_moderation_action(p_report_id uuid,p_decision text,p_decision_reason text,p_staff_notes text default null,p_suspension_duration_days integer default null) returns setof public.community_reports language plpgsql security definer set search_path='' as $$
declare operator uuid;r public.community_reports;
begin
 operator:=public.community_staff_required();perform public.community_lock();select * into r from public.community_reports where id=p_report_id for update;
 if r.target_type is distinct from 'comment' then return query select * from public.community_apply_moderation_action_before_comments(p_report_id,p_decision,p_decision_reason,p_staff_notes,p_suspension_duration_days);return;end if;
 if r.status not in ('submitted','under_review') or (r.assigned_to is not null and r.assigned_to<>operator::text) then raise exception 'community_conflict';end if;
 if operator=r.subject_user_id or operator=r.reporter_user_id then raise exception 'community_access_denied';end if;
 if p_decision is null or p_decision not in ('warn','remove','suspend','ban','dismiss') or nullif(btrim(p_decision_reason),'') is null or char_length(p_decision_reason)>500 or char_length(p_staff_notes)>1000 or (p_decision='suspend' and (p_suspension_duration_days is null or p_suspension_duration_days not in (7,14,30))) then raise exception 'community_invalid_action';end if;
 if p_decision in ('suspend','ban') then
 if r.subject_user_id is null then raise exception 'community_unavailable';end if;
 insert into public.community_moderation_sanctions(user_id,report_id,kind,expires_at) values(r.subject_user_id,r.id,p_decision,case when p_decision='suspend' then now()+p_suspension_duration_days*interval '1 day' end);
 update public.community_profiles set status='withdrawn',is_searchable=false,updated_at=now() where user_id=r.subject_user_id;
 elsif p_decision='remove' then update public.community_comments set body=null,mentions='{}',removed_at=coalesce(removed_at,now()),version=version+1,updated_at=now() where id::text=r.target_id and removed_at is null;end if;
 insert into public.community_moderation_actions(report_id,target_type,target_id,action,reason,staff_operator,staff_notes,suspension_duration_days) values(r.id,r.target_type,r.target_id,p_decision,p_decision_reason,operator,p_staff_notes,p_suspension_duration_days);
 return query update public.community_reports set status=case when p_decision='dismiss' then 'dismissed' else 'resolved' end,decision=p_decision,decision_reason=p_decision_reason,staff_notes=p_staff_notes,assigned_to=operator::text,action_taken_at=now(),suspension_expires_at=case when p_decision='suspend' then now()+p_suspension_duration_days*interval '1 day' end,updated_at=now() where id=r.id returning *;
end $$;

create function public.community_comments(p_operation text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();activity uuid;cid uuid;parent uuid;op uuid;c public.community_comments;prior public.community_comment_operations;body_text text;recipient uuid;requested_mentions uuid[]:='{}';expected integer;digest text;n integer;gen integer;items jsonb;entry record;next_cursor text;before_time timestamptz;before_id uuid;page_size integer;is_enabled boolean;own_activity boolean;report_id uuid;receipts uuid;
begin
 perform public.community_lock();
 if u is null then raise exception 'community_access_denied';end if;
 if jsonb_typeof(p_args)<>'object' then raise exception 'community_invalid_action';end if;
 if p_operation='preferences' then
 if not (p_args ? 'allowMentions') then return jsonb_build_object('allowMentions',coalesce((select allow_mentions from public.community_comment_preferences where user_id=u),false));end if;
 if jsonb_typeof(p_args->'allowMentions')<>'boolean' then raise exception 'community_invalid_action';end if;
 if (p_args->>'allowMentions')::boolean and (not public.community_feature_enabled('comments',u) or not public.community_active(u)) then raise exception 'community_unavailable';end if;
 insert into public.community_comment_preferences(user_id,allow_mentions) values(u,(p_args->>'allowMentions')::boolean) on conflict(user_id) do update set allow_mentions=excluded.allow_mentions;
 if not (p_args->>'allowMentions')::boolean then update public.community_comment_mentions set revoked=true where user_id=u;end if;
 return jsonb_build_object('allowMentions',(p_args->>'allowMentions')::boolean);
 elsif p_operation='delete' then
 cid:=(p_args->>'id')::uuid;expected:=(p_args->>'expectedVersion')::integer;
 select * into c from public.community_comments where id=cid for update;
 if c.id is null or not (c.user_id=u or exists(select 1 from public.shared_activities where id=c.activity_id and user_id=u)) then raise exception 'community_unavailable';end if;
 if expected is null or expected<1 then raise exception 'community_invalid_action';end if;
 if c.removed_at is null then
 if c.version<>expected then raise exception 'community_conflict';end if;
 update public.community_comments set body=null,mentions='{}',removed_at=now(),updated_at=now(),version=version+1 where id=cid returning * into c;
 update public.community_comment_mentions set revoked=true where comment_id=cid;
 end if;
 return jsonb_build_object('id',c.id,'version',c.version);
 elsif p_operation='report' then
 cid:=(p_args->>'id')::uuid;
 select id into report_id from public.community_submit_report('comment',cid::text,p_args->>'reason',p_args->>'notes',(p_args->>'receiptId')::uuid);
 return jsonb_build_object('id',report_id);
 elsif p_operation='settings' then
 activity:=(p_args->>'activityId')::uuid;
 if jsonb_typeof(p_args->'enabled')<>'boolean' or not exists(select 1 from public.shared_activities where id=activity and user_id=u) then raise exception 'community_unavailable';end if;
 if (p_args->>'enabled')::boolean and not public.community_comment_activity_visible(activity,u) then raise exception 'community_unavailable';end if;
 insert into public.community_comment_settings(activity_id,user_id,enabled) values(activity,u,(p_args->>'enabled')::boolean) on conflict(activity_id) do update set enabled=excluded.enabled;
 return jsonb_build_object('enabled',(p_args->>'enabled')::boolean);
 end if;
 if not public.community_feature_enabled('comments',u) or not public.community_active(u) then raise exception 'community_unavailable';end if;
 if p_operation='mentionsInbox' then
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'activityId',comment_row.activity_id,'commentId',comment_row.id,'createdAt',to_char(m.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by m.created_at desc,m.id desc),'[]') into items from (select * from public.community_comment_mentions where user_id=u and not revoked and expires_at>now() order by created_at desc,id desc limit 30) m join public.community_comments comment_row on comment_row.id=m.comment_id
 where public.community_comment_mention_current(comment_row,u,u);
 return jsonb_build_object('items',items);
 end if;
 activity:=(p_args->>'activityId')::uuid;
 if not public.community_comment_activity_visible(activity,u) then raise exception 'community_unavailable';end if;
 select coalesce(enabled,false) into is_enabled from public.community_comment_settings where activity_id=activity;is_enabled:=coalesce(is_enabled,false);
 select user_id=u into own_activity from public.shared_activities where id=activity;
 if p_operation='candidates' then
 select coalesce(jsonb_agg(public.community_comment_identity(user_id)),'[]') into items from (select distinct r.target_user_id as user_id from public.community_relationships r join public.community_comment_preferences pref on pref.user_id=r.target_user_id and pref.allow_mentions where r.follower_user_id=u and r.status='approved' and r.target_user_id<>u and public.community_comment_activity_visible(activity,r.target_user_id) and not public.community_blocked_between(u,r.target_user_id) order by user_id limit 30) candidates;
 return jsonb_build_object('items',items);
 elsif p_operation='list' then
 page_size:=coalesce((p_args->>'limit')::integer,20);
 if page_size<1 or page_size>20 then raise exception 'community_invalid_action';end if;
 if nullif(p_args->>'cursor','') is not null then
 if array_length(string_to_array(p_args->>'cursor','|'),1)<>2 then raise exception 'community_invalid_action';end if;
 before_time:=split_part(p_args->>'cursor','|',1)::timestamptz;before_id:=split_part(p_args->>'cursor','|',2)::uuid;
 end if;
 items:='[]';n:=0;
 for c in select * from public.community_comments where activity_id=activity and (before_time is null or (created_at,id)>(before_time,before_id)) and public.community_comment_visible_to(id,u) order by created_at,id limit page_size+1 loop
 n:=n+1;if n>page_size then exit;end if;
 items:=items||jsonb_build_array(public.community_comment_dto(c,u));
 if c.user_id<>u then
 -- Preserve exact authorized text for reporting after a later block/removal.
 begin select id into receipts from public.community_issue_report_receipt('comment',c.id::text);exception when raise_exception then if sqlerrm<>'community_rate_limited' then raise;end if;end;
 end if;
 next_cursor:=to_char(c.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'|'||c.id::text;
 end loop;
 return jsonb_build_object('items',items,'nextCursor',case when n>page_size then next_cursor else null end,'enabled',is_enabled,'canManage',own_activity,'allowMentions',coalesce((select allow_mentions from public.community_comment_preferences where user_id=u),false));
 elsif p_operation<>'upsert' then raise exception 'community_invalid_action';end if;
 if not is_enabled then raise exception 'community_unavailable';end if;
 cid:=(p_args->>'id')::uuid;parent:=(p_args->>'parentId')::uuid;op:=(p_args->>'operationId')::uuid;expected:=(p_args->>'expectedVersion')::integer;body_text:=btrim(p_args->>'body');
 if cid is null or op is null or expected is null or expected<0 or body_text is null or char_length(body_text) not between 1 and 500 or body_text~'[[:cntrl:]@]' or body_text~*'(https?://|www\.)' or not public.community_text_safe(body_text) then raise exception 'community_invalid_action';end if;
 if jsonb_typeof(coalesce(p_args->'mentions','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_args->'mentions','[]'::jsonb))>3 then raise exception 'community_invalid_action';end if;
 for entry in select jsonb_array_elements_text(coalesce(p_args->'mentions','[]'::jsonb)) as id loop
 recipient:=entry.id::uuid;
 if recipient=u or recipient=any(requested_mentions) or not exists(select 1 from public.community_comment_preferences where user_id=recipient and allow_mentions) or not public.community_comment_activity_visible(activity,recipient) or public.community_blocked_between(u,recipient) or not exists(select 1 from public.community_relationships where follower_user_id=u and target_user_id=recipient and status='approved') then raise exception 'community_unavailable';end if;
 requested_mentions:=array_append(requested_mentions,recipient);
 end loop;
 digest:=encode(sha256(convert_to(jsonb_build_object('id',cid,'activity',activity,'parent',parent,'body',body_text,'version',expected,'mentions',requested_mentions)::text,'UTF8')),'hex');
 select * into prior from public.community_comment_operations where user_id=u and operation_id=op;
 if prior.operation_id is not null then
 if prior.payload_digest<>digest then raise exception 'community_conflict';end if;
 if not public.community_comment_visible_to(prior.comment_id,u) or not exists(select 1 from public.community_comments where id=prior.comment_id and version=prior.version) then raise exception 'community_conflict';end if;
 return jsonb_build_object('id',prior.comment_id,'version',prior.version);
 end if;
 select * into c from public.community_comments where id=cid for update;
 if c.id is not null and (c.user_id<>u or c.activity_id<>activity or c.parent_id is distinct from parent or c.removed_at is not null or c.version<>expected or c.generation<>(select generation from public.community_profiles where user_id=u)) then raise exception 'community_conflict';end if;
 if c.id is null and expected<>0 then raise exception 'community_conflict';end if;
 if parent is not null and not exists(select 1 from public.community_comments root where root.id=parent and root.activity_id=activity and root.parent_id is null and public.community_comment_visible_to(root.id,u)) then raise exception 'community_unavailable';end if;
 if c.id is null and (select count(*) from public.community_comments where activity_id=activity)>=500 then raise exception 'community_rate_limited';end if;
 if (select count(*) from public.community_comment_operations where user_id=u)>=5000 or (select count(*) from public.community_comment_operations where user_id=u and created_at>now()-interval '1 minute')>=10 then raise exception 'community_rate_limited';end if;
 insert into public.community_comment_usage(user_id,usage_day,used) values(u,(now() at time zone 'UTC')::date,1) on conflict(user_id,usage_day) do update set used=community_comment_usage.used+1 where community_comment_usage.used<100 returning used into n;
 if n is null then raise exception 'community_rate_limited';end if;
 select generation into gen from public.community_profiles where user_id=u;
 insert into public.community_comments(id,activity_id,user_id,parent_id,body,mentions,generation) values(cid,activity,u,parent,body_text,requested_mentions,gen)
 on conflict(id) do update set body=excluded.body,mentions=excluded.mentions,version=community_comments.version+1,updated_at=now() returning * into c;
 insert into public.community_comment_operations(user_id,operation_id,comment_id,payload_digest,version) values(u,op,cid,digest,c.version);
 update public.community_comment_mentions set revoked=true where comment_id=cid and not user_id=any(requested_mentions);
 foreach recipient in array requested_mentions loop
 insert into public.community_comment_mentions(user_id,comment_id,generation) values(recipient,cid,(select generation from public.community_profiles where user_id=recipient)) on conflict(comment_id,user_id) do nothing;
 end loop;
 return jsonb_build_object('id',c.id,'version',c.version);
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then raise exception 'community_invalid_action';
end $$;

-- Generation cleanup never preserves old text, mentions or per-post permission.
create function public.community_comment_profile_cleanup() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.status<>'active' or new.generation<>old.generation then
 delete from public.community_comments where user_id=new.user_id;
 delete from public.community_comment_mentions where user_id=new.user_id;
 delete from public.community_comment_preferences where user_id=new.user_id;
 delete from public.community_comment_settings where user_id=new.user_id;
 end if;return null;
end $$;
create trigger community_comment_profile_cleanup after update on public.community_profiles for each row execute function public.community_comment_profile_cleanup();
alter function public.community_export_page(text,text,integer) rename to community_export_page_before_comments;
create function public.community_export_page(p_category text,p_after text default null,p_limit integer default 500) returns table(item_key text,item jsonb) language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null then raise exception 'community_access_denied';end if;
 if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'community_conflict';end if;
 if p_category='comments' then return query select c.id::text,to_jsonb(c)-'user_id' from public.community_comments c where c.user_id=auth.uid() and (p_after is null or c.id::text>p_after) order by c.id limit p_limit;
 elsif p_category='commentPreferences' then return query select pref.user_id::text,jsonb_build_object('allowMentions',allow_mentions) from public.community_comment_preferences pref where pref.user_id=auth.uid() and (p_after is null or pref.user_id::text>p_after) order by pref.user_id limit p_limit;
 elsif p_category='commentMentions' then return query select m.id::text,to_jsonb(m)-'user_id' from public.community_comment_mentions m where m.user_id=auth.uid() and (p_after is null or m.id::text>p_after) order by m.id limit p_limit;
 else return query select * from public.community_export_page_before_comments(p_category,p_after,p_limit);end if;
end $$;
alter function public.community_retention_batch(integer) rename to community_retention_batch_before_comments;
create function public.community_retention_batch(p_limit integer default 500) returns table(deleted_count integer) language plpgsql security definer set search_path='' as $$declare n integer;c integer;begin
 select b.deleted_count into n from public.community_retention_batch_before_comments(p_limit) b;
 delete from public.community_comment_mentions where ctid in (select ctid from public.community_comment_mentions where expires_at<=now() limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_comment_usage where ctid in (select ctid from public.community_comment_usage where usage_day<(now() at time zone 'UTC')::date limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_comment_operations where ctid in (select ctid from public.community_comment_operations where created_at<now()-interval '365 days' limit p_limit);get diagnostics c=row_count;n:=n+c;
 return query select n;
end $$;
do $$declare f record;begin for f in select p.oid::regprocedure name,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'community_comment%' or p.proname in ('community_issue_report_receipt_before_comments','community_submit_report_before_comments','community_apply_moderation_action_before_comments','community_export_page_before_comments','community_retention_batch_before_comments','community_issue_report_receipt','community_submit_report','community_apply_moderation_action','community_export_page','community_retention_batch')) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.name);execute format('grant execute on function %s to service_role',f.name);
 if f.proname in ('community_comments','community_comment_visible','community_issue_report_receipt','community_submit_report','community_apply_moderation_action','community_export_page') then execute format('grant execute on function %s to authenticated',f.name);end if;
 end loop;end $$;
commit;
