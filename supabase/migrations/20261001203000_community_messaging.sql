begin;
create table public.community_messaging_preferences(user_id uuid primary key references auth.users(id) on delete cascade, enabled boolean not null default false, muted boolean not null default false, generation integer not null);
create table public.community_messages(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,recipient_id uuid not null references auth.users(id) on delete cascade,body text,original_digest text not null,version integer not null default 1,sender_generation integer not null,recipient_generation integer not null,created_at timestamptz not null default now(),edited_at timestamptz,deleted_at timestamptz,check(user_id<>recipient_id),check(body is null or char_length(body) between 1 and 1000));
-- Minimal no-text receipts survive withdrawal and content retention; old sends never recreate erased text.
create table public.community_message_operations(user_id uuid not null references auth.users(id) on delete cascade,id uuid not null,recipient_id uuid references auth.users(id) on delete set null,digest text not null,sender_generation integer not null,recipient_generation integer not null,created_at timestamptz not null default now(),primary key(user_id,id),unique(id));
alter table public.community_message_operations enable row level security;
revoke all on public.community_message_operations from public,anon,authenticated;
grant all on public.community_message_operations to service_role;
create index community_messages_user on public.community_messages(user_id,id);
create index community_messages_recipient on public.community_messages(recipient_id,id);
create index community_messages_thread on public.community_messages(user_id,recipient_id,created_at);
alter table public.community_messaging_preferences enable row level security;
alter table public.community_messages enable row level security;
revoke all on public.community_messaging_preferences,public.community_messages from public,anon,authenticated;
grant all on public.community_messaging_preferences,public.community_messages to service_role;
create function public.community_message_pair(p_a uuid,p_b uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select p_a<>p_b and public.community_feature_enabled('messaging',p_a) and public.community_feature_enabled('messaging',p_b)
 and not exists(select 1 from public.community_blocks where (blocker_user_id=p_a and blocked_user_id=p_b) or (blocker_user_id=p_b and blocked_user_id=p_a))
 and exists(select 1 from public.community_relationships where follower_user_id=p_a and target_user_id=p_b and status='approved')
 and exists(select 1 from public.community_relationships where follower_user_id=p_b and target_user_id=p_a and status='approved')
 and exists(select 1 from public.community_messaging_preferences m join public.community_profiles p using(user_id) where m.user_id=p_a and m.enabled and m.generation=p.generation)
 and exists(select 1 from public.community_messaging_preferences m join public.community_profiles p using(user_id) where m.user_id=p_b and m.enabled and m.generation=p.generation)
$$;
create function public.community_message_visible(p_id uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.community_messages m join public.community_profiles a on a.user_id=m.user_id join public.community_profiles b on b.user_id=m.recipient_id where m.id=p_id and auth.uid() in (m.user_id,m.recipient_id) and m.sender_generation=a.generation and m.recipient_generation=b.generation and m.created_at>now()-interval '90 days' and public.community_message_pair(m.user_id,m.recipient_id))
$$;
create policy community_messages_read on public.community_messages for select to authenticated using(public.community_message_visible(id));
grant select(id,user_id,recipient_id,body,version,created_at,edited_at,deleted_at) on public.community_messages to authenticated;
create function public.community_message_dto(m public.community_messages) returns jsonb language sql immutable set search_path='' as $$ select jsonb_build_object('id',m.id,'userId',m.user_id,'recipientId',m.recipient_id,'text',case when m.deleted_at is null then m.body end,'version',m.version,'createdAt',m.created_at,'editedAt',m.edited_at,'deleted',m.deleted_at is not null) $$;
create function public.community_messaging_rpc(p_operation text,p_args jsonb default '{}') returns table(result jsonb) language plpgsql volatile security definer set search_path='' as $$
declare u uuid:=auth.uid();peer uuid;mid uuid;m public.community_messages;pref public.community_messaging_preferences;gen integer;txt text;items jsonb;cursor uuid;receipt public.community_message_operations;
begin
 perform public.community_lock();if u is null then raise exception 'community_access_denied';end if;
 if p_operation='preferences' then
 select generation into gen from public.community_profiles where user_id=u;
 if p_args ? 'enabled' and (p_args->>'enabled')::boolean and not public.community_feature_enabled('messaging',u) then raise exception 'community_unavailable';end if;
 if gen is null then raise exception 'community_unavailable';end if;
 insert into public.community_messaging_preferences(user_id,generation) values(u,gen) on conflict do nothing;
 update public.community_messaging_preferences set enabled=case when p_args ? 'enabled' then (p_args->>'enabled')::boolean else enabled and generation=gen end,muted=coalesce((p_args->>'muted')::boolean,muted),generation=gen where user_id=u returning * into pref;
 return query select jsonb_build_object('enabled',pref.enabled,'muted',pref.muted);return;
 elsif p_operation='delete' then
 update public.community_messages set body=null,deleted_at=coalesce(deleted_at,now()),version=case when deleted_at is null then version+1 else version end where id=(p_args->>'id')::uuid and user_id=u;
 if not found then raise exception 'community_unavailable';end if;
 return query select jsonb_build_object('deleted',true);return;
 end if;
 if p_operation='listMine' then return query select jsonb_build_object('messages',coalesce(jsonb_agg(public.community_message_dto(t) order by t.id),'[]'),'nextCursor',case when count(*)=50 then max(t.id::text) end) from(select * from public.community_messages where user_id=u and (p_args->>'after' is null or id>(p_args->>'after')::uuid) order by id limit 50)t;return;end if;
 if not public.community_feature_enabled('messaging',u) then raise exception 'community_unavailable';end if;
 if p_operation='contacts' then
 return query select jsonb_build_object('contacts',coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'displayName',display_name)),'[]')) from (select user_id,display_name from public.community_profiles where public.community_message_pair(u,user_id) order by user_id limit 30) t;return;
 end if;
 if p_operation='edit' then select * into m from public.community_messages where id=(p_args->>'id')::uuid and user_id=u;peer:=m.recipient_id;else peer:=(p_args->>'peerId')::uuid;end if;
 if peer is null or not public.community_message_pair(u,peer) then raise exception 'community_unavailable';end if;
 if p_operation='list' then
 cursor:=(p_args->>'after')::uuid;
 if cursor is not null and not exists(select 1 from public.community_messages where id=cursor and ((user_id=u and recipient_id=peer) or(user_id=peer and recipient_id=u)) and public.community_message_visible(id)) then raise exception 'community_unavailable';end if;
 select coalesce(jsonb_agg(public.community_message_dto(t) order by t.created_at,t.id),'[]') into items from (select message_row.* from public.community_messages message_row where ((message_row.user_id=u and message_row.recipient_id=peer) or(message_row.user_id=peer and message_row.recipient_id=u)) and public.community_message_visible(message_row.id) and (cursor is null or (message_row.created_at,message_row.id)>(select created_at,id from public.community_messages where id=cursor)) order by message_row.created_at,message_row.id limit 50) t;
 -- Snapshot only incoming, undeleted text actually returned in this bounded page.
 -- Exact-evidence dedupe never extends receipt expiry or prevents a safety read.
 for m in select message_row.* from public.community_messages message_row where message_row.recipient_id=u and message_row.deleted_at is null and exists(select 1 from jsonb_array_elements(items) delivered where delivered->>'id'=message_row.id::text) loop
 begin perform id from public.community_issue_report_receipt('message',m.id::text);exception when raise_exception then if sqlerrm<>'community_rate_limited' then raise;end if;end;
 end loop;
 return query select jsonb_build_object('messages',items,'nextCursor',case when jsonb_array_length(items)=50 then items->49->>'id' end);return;
 end if;
 txt:=btrim(p_args->>'text');
 if txt is null or char_length(txt) not between 1 and 1000 or txt~*'(https?://|www\.)' or not public.community_text_safe(txt) then raise exception 'community_invalid_input';end if;
 if p_operation='send' then
 mid:=(p_args->>'id')::uuid;if mid is null then raise exception 'community_invalid_input';end if;
 select * into receipt from public.community_message_operations where user_id=u and id=mid;
 if found and (receipt.recipient_id is distinct from peer or receipt.digest<>encode(sha256(convert_to(txt,'UTF8')),'hex') or receipt.sender_generation<>(select generation from public.community_profiles where user_id=u) or receipt.recipient_generation<>(select generation from public.community_profiles where user_id=peer) or not exists(select 1 from public.community_messages where id=mid and user_id=u)) then raise exception 'community_conflict';end if;
 select * into m from public.community_messages where id=mid;
 if found then
 if m.user_id<>u or m.recipient_id<>peer or m.original_digest<>encode(sha256(convert_to(txt,'UTF8')),'hex') or not public.community_message_visible(mid) then raise exception 'community_conflict';end if;
 return query select jsonb_build_object('message',public.community_message_dto(m));return;end if;
 if (select count(*) from public.community_message_operations where user_id=u and created_at>now()-interval '1 minute')>=10 or (select count(*) from public.community_message_operations where user_id=u and created_at>now()-interval '1 day')>=100 or (select count(*) from public.community_message_operations where user_id=u)>=10000 or (select count(*) from public.community_messages where (user_id=u and recipient_id=peer)or(user_id=peer and recipient_id=u))>=500 then raise exception 'community_rate_limited';end if;
 insert into public.community_messages(id,user_id,recipient_id,body,original_digest,sender_generation,recipient_generation) select mid,u,peer,txt,encode(sha256(convert_to(txt,'UTF8')),'hex'),a.generation,b.generation from public.community_profiles a,public.community_profiles b where a.user_id=u and b.user_id=peer returning * into m;
 insert into public.community_message_operations(user_id,id,recipient_id,digest,sender_generation,recipient_generation) values(u,m.id,peer,m.original_digest,m.sender_generation,m.recipient_generation);
 elsif p_operation='edit' then
 if not (p_args ? 'version') or jsonb_typeof(p_args->'version')<>'number' or (p_args->>'version')::integer is null or m.deleted_at is not null or m.version<>(p_args->>'version')::integer or not public.community_message_visible(m.id) then raise exception 'community_conflict';end if;
 update public.community_messages set body=txt,version=version+1,edited_at=now() where id=m.id returning * into m;
 else raise exception 'community_invalid_input';end if;
 return query select jsonb_build_object('message',public.community_message_dto(m));
end $$;
-- Withdrawal clears conversations for both participants; re-enrollment cannot revive them.
create function public.community_messages_withdraw() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if old.status='active' and new.status<>'active' then delete from public.community_messages where user_id=new.user_id or recipient_id=new.user_id;delete from public.community_messaging_preferences where user_id=new.user_id;end if;return new;end $$;
create trigger community_messages_withdraw after update of status on public.community_profiles for each row execute function public.community_messages_withdraw();
alter function public.community_export_page(text,text,integer) rename to community_export_page_before_messages;
create function public.community_export_page(p_category text,p_after text default null,p_limit integer default 500) returns table(item_key text,item jsonb) language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or p_limit is null or p_limit not between 1 and 500 then raise exception 'community_access_denied';end if;
 if p_category='messages' then return query select id::text,jsonb_build_object('id',id,'recipientId',recipient_id,'text',body,'createdAt',created_at,'editedAt',edited_at,'deletedAt',deleted_at) from public.community_messages where user_id=auth.uid() and(p_after is null or id::text>p_after) order by id::text limit p_limit;
 elsif p_category='messageOperations' then return query select id::text,jsonb_build_object('id',id,'createdAt',created_at) from public.community_message_operations where user_id=auth.uid() and(p_after is null or id::text>p_after) order by id::text limit p_limit;
 elsif p_category='messagingPreferences' then return query select user_id::text,jsonb_build_object('enabled',enabled,'muted',muted) from public.community_messaging_preferences where user_id=auth.uid() and(p_after is null or user_id::text>p_after) limit p_limit;
 else return query select * from public.community_export_page_before_messages(p_category,p_after,p_limit);end if;end $$;
-- Reports copy only the specifically visible message. No other conversation is exposed.
alter function public.community_issue_report_receipt(text,text) rename to community_issue_report_receipt_before_messages;
create function public.community_issue_report_receipt(p_target_type text,p_target_id text) returns table(id uuid) language plpgsql security definer set search_path='' as $$declare m public.community_messages;snapshot jsonb;rid uuid;begin
 if p_target_type is distinct from 'message' then return query select * from public.community_issue_report_receipt_before_messages(p_target_type,p_target_id);return;end if;
 perform public.community_lock();select * into m from public.community_messages where community_messages.id=p_target_id::uuid and recipient_id=auth.uid() and deleted_at is null and public.community_message_visible(community_messages.id);
 if not found then raise exception 'community_unavailable';end if;
 snapshot:=jsonb_build_object('text',m.body,'version',m.version);
 select receipt_row.id into rid from public.community_report_receipts receipt_row where receipt_row.user_id=auth.uid() and receipt_row.target_type='message' and receipt_row.target_id=m.id::text and receipt_row.subject_user_id=m.user_id and receipt_row.evidence_snapshot=snapshot and receipt_row.expires_at>now() order by receipt_row.created_at desc,receipt_row.id desc limit 1;
 if rid is null then insert into public.community_report_receipts(user_id,target_type,target_id,subject_user_id,evidence_snapshot) values(auth.uid(),'message',m.id::text,m.user_id,snapshot) returning community_report_receipts.id into rid;end if;
 if rid is null then raise exception 'community_rate_limited';end if;return query select rid;end $$;
-- The generic report insert below reuses durable verified receipts and the shared daily cap.
alter function public.community_submit_report(text,text,text,text,uuid) rename to community_submit_report_before_messages;
create function public.community_submit_report(p_target_type text,p_target_id text,p_reason text,p_notes text default null,p_interaction_receipt_id uuid default null) returns setof public.community_reports language plpgsql security definer set search_path='' as $$declare r public.community_reports;receipt public.community_report_receipts;rid uuid;n integer;begin
 if p_target_type is distinct from 'message' then return query select * from public.community_submit_report_before_messages(p_target_type,p_target_id,p_reason,p_notes,p_interaction_receipt_id);return;end if;
 perform public.community_lock();if auth.uid() is null or p_reason not in('harassment','offensive_content','impersonation','spam','unsafe_or_sexual_content','other') or p_reason is null or char_length(p_notes)>1000 then raise exception 'community_invalid_report';end if;
 rid:=p_interaction_receipt_id;if rid is null then select id into rid from public.community_report_receipts where user_id=auth.uid() and target_type=p_target_type and target_id=p_target_id and expires_at>now() order by created_at desc limit 1;end if;if rid is null then select id into rid from public.community_issue_report_receipt(p_target_type,p_target_id);end if;
 select * into receipt from public.community_report_receipts where id=rid and user_id=auth.uid() and target_type='message' and target_id=p_target_id and expires_at>now();if not found then raise exception 'community_unavailable';end if;
 select * into r from public.community_reports where reporter_user_id=auth.uid() and target_type=p_target_type and target_id=p_target_id and reason=p_reason and status in('submitted','under_review') order by created_at desc limit 1 for update;
 if found then update public.community_reports set notes=case when nullif(p_notes,'') is null then notes else left(concat_ws(E'\n',notes,p_notes),1000) end,updated_at=now() where id=r.id returning * into r;r.subject_user_id:=null;r.evidence_snapshot:='{}';r.assigned_to:=null;r.staff_notes:=null;return next r;return;end if;
 insert into public.community_report_usage(user_id,report_date,report_count) values(auth.uid(),(now() at time zone 'UTC')::date,1) on conflict(user_id,report_date) do update set report_count=community_report_usage.report_count+1 where community_report_usage.report_count<10 returning report_count into n;
 if n is null then raise exception 'community_rate_limited';end if;
 insert into public.community_reports(reporter_user_id,target_type,target_id,reason,notes,subject_user_id,evidence_snapshot,priority) values(auth.uid(),'message',p_target_id,p_reason,p_notes,receipt.subject_user_id,receipt.evidence_snapshot,case when p_reason in('harassment','unsafe_or_sexual_content') then 'urgent' else 'normal' end) returning * into r;
 r.subject_user_id:=null;r.evidence_snapshot:='{}';r.assigned_to:=null;r.staff_notes:=null;return next r;end $$;
alter function public.community_apply_moderation_action(uuid,text,text,text,integer) rename to community_apply_moderation_action_before_messages;
create function public.community_apply_moderation_action(p_report_id uuid,p_decision text,p_decision_reason text,p_staff_notes text default null,p_suspension_duration_days integer default null) returns setof public.community_reports language plpgsql security definer set search_path='' as $$declare r public.community_reports;op uuid;begin
 select * into r from public.community_reports where id=p_report_id;
 if r.target_type<>'message' or p_decision<>'remove' then return query select * from public.community_apply_moderation_action_before_messages(p_report_id,p_decision,p_decision_reason,p_staff_notes,p_suspension_duration_days);return;end if;
 op:=public.community_staff_required();perform public.community_lock();select * into r from public.community_reports where id=p_report_id for update;
 if r.status not in('submitted','under_review') or (r.assigned_to is not null and r.assigned_to<>op::text) or op=r.subject_user_id or op=r.reporter_user_id or nullif(btrim(p_decision_reason),'') is null or char_length(p_decision_reason)>500 or char_length(p_staff_notes)>1000 then raise exception 'community_conflict';end if;
 update public.community_messages set body=null,deleted_at=now(),version=version+1 where id::text=r.target_id and user_id=r.subject_user_id;
 insert into public.community_moderation_actions(report_id,target_type,target_id,action,reason,staff_operator,staff_notes) values(r.id,r.target_type,r.target_id,'remove',p_decision_reason,op,p_staff_notes);
 return query update public.community_reports set status='resolved',decision='remove',decision_reason=p_decision_reason,staff_notes=p_staff_notes,assigned_to=op::text,action_taken_at=now(),updated_at=now() where id=r.id returning *;end $$;
do $$declare f record;begin for f in select p.oid::regprocedure sig,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and(p.proname like 'community_message%' or p.proname in('community_export_page','community_export_page_before_messages','community_issue_report_receipt','community_issue_report_receipt_before_messages','community_submit_report','community_submit_report_before_messages','community_apply_moderation_action','community_apply_moderation_action_before_messages')) loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);if f.proname in('community_messaging_rpc','community_message_visible','community_export_page','community_issue_report_receipt','community_submit_report','community_apply_moderation_action') then execute format('grant execute on function %s to authenticated',f.sig);end if;end loop;end $$;
commit;
