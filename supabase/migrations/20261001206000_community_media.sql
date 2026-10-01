begin;
-- Independently selected sanitized stills. There are no client Storage policies.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('community-media','community-media',false,2097152,array['image/jpeg']) on conflict(id) do update set public=false,file_size_limit=2097152,allowed_mime_types=array['image/jpeg'];
create table public.community_media_assets (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 generation integer not null,operation_id uuid not null,digest text not null check(digest ~ '^[a-f0-9]{64}$'),
 alt_text text not null check(char_length(alt_text) between 1 and 240), rights_confirmed_at timestamptz not null default now(),
 state text not null default 'uploading' check(state in ('uploading','pending','approved','rejected','revoked')),
 decode_attempts integer not null default 0 check(decode_attempts between 0 and 3),width integer check(width between 1 and 1600),height integer check(height between 1 and 1600),version integer not null default 1,
 lease_expires_at timestamptz not null default now()+interval '5 minutes',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(user_id,operation_id)
);
create index community_media_assets_user_idx on public.community_media_assets(user_id,id);
create index community_media_pending_idx on public.community_media_assets(state,lease_expires_at);
create table public.community_media_review_actions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 asset_id uuid not null,reviewer_user_id uuid references auth.users(id) on delete set null,
 decision text not null check(decision in ('approve','reject','remove')),reason text not null check(char_length(reason) between 1 and 500),created_at timestamptz not null default now()
);
create index community_media_review_user_idx on public.community_media_review_actions(user_id,id);
-- Tombstone survives Auth deletion until object removal succeeds. Never cascade it
-- away ahead of Storage cleanup. UUID owner identifiers are purged with the ticket.
create table public.community_media_cleanup_jobs (
 id uuid primary key,user_id uuid not null,image_path text not null,thumbnail_path text not null,
 not_before timestamptz not null,created_at timestamptz not null default now()
);
create index community_media_cleanup_user_idx on public.community_media_cleanup_jobs(user_id);
create index community_media_cleanup_ready_idx on public.community_media_cleanup_jobs(not_before,id);
do $$declare t text;begin foreach t in array array['community_media_assets','community_media_review_actions','community_media_cleanup_jobs'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;
create function public.community_media_staff() returns boolean language sql stable security definer set search_path='' as $$ select auth.uid() is not null and auth.jwt()->>'aal'='aal2' and exists(select 1 from public.community_moderation_staff where user_id=auth.uid() and active) $$;
create function public.community_can_view_media(p_id uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.community_media_assets a where a.id=p_id and
 ((public.community_media_staff() and a.state='pending') or
 (public.community_feature_enabled('media',auth.uid()) and public.community_active(a.user_id) and a.generation=(select generation from public.community_profiles where user_id=a.user_id) and not public.community_blocked_between(auth.uid(),a.user_id)
 and ((a.user_id=auth.uid() and a.state in ('pending','approved','rejected')) or (a.state='approved' and exists(select 1 from public.community_relationships where follower_user_id=auth.uid() and target_user_id=a.user_id and status='approved'))))))
$$;
create function public.community_media_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('id',a.id,'authorHandle',p.handle,'altText',a.alt_text,'state',a.state,'width',a.width,'height',a.height,'isOwner',a.user_id=auth.uid(),'createdAt',a.created_at) from public.community_media_assets a join public.community_profiles p on p.user_id=a.user_id where a.id=p_id $$;
create function public.community_media_queue_delete() returns trigger language plpgsql security definer set search_path='' as $$declare a public.community_media_assets; delay_at timestamptz;begin
 a:=old;
 if tg_op='UPDATE' then if new.state not in ('rejected','revoked') or new.state=old.state then return new;end if; a:=new;end if;
 -- Network requests time out in30s and decode in10s; expired uploads wait another
 --5min before physical removal to catch all writes from their bounded lease.
 delay_at:=greatest(now(),a.lease_expires_at)+interval '5 minutes';
 if exists(select 1 from public.community_reports where target_type='media' and target_id=a.id::text and created_at>now()-interval '30 days') or exists(select 1 from public.community_report_receipts where target_type='media' and target_id=a.id::text and expires_at>now()) then delay_at:=greatest(delay_at,now()+interval '30 days');end if;
 insert into public.community_media_cleanup_jobs(id,user_id,image_path,thumbnail_path,not_before) values(a.id,a.user_id,'quarantine/'||a.id||'/image.jpg','quarantine/'||a.id||'/thumbnail.jpg',delay_at)
 on conflict(id) do update set not_before=greatest(community_media_cleanup_jobs.not_before,excluded.not_before);
 if tg_op='UPDATE' then return new;end if;return old;
end $$;
create trigger community_media_delete_cleanup before delete or update on public.community_media_assets for each row execute function public.community_media_queue_delete();
create function public.community_media_begin(p_args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare a public.community_media_assets;g integer;begin
 perform public.community_lock();
 if not public.community_feature_enabled('media',auth.uid()) then raise exception 'community_unavailable';end if;
 if p_args->'rightsConfirmed' is distinct from 'true'::jsonb or coalesce(p_args->>'digest','')!~'^[a-f0-9]{64}$' or nullif(btrim(p_args->>'altText'),'') is null or char_length(btrim(p_args->>'altText'))>240 or not public.community_text_safe(p_args->>'altText') or p_args->>'altText' ~* '(https?://|www\.|@)' then raise exception 'community_invalid_input';end if;
 select * into a from public.community_media_assets where user_id=auth.uid() and operation_id=(p_args->>'operationId')::uuid for update;
 if a.id is not null then
 if a.digest<>p_args->>'digest' or a.alt_text<>btrim(p_args->>'altText') then raise exception 'community_conflict';end if;
 if a.state in ('revoked','rejected') or (a.state='uploading' and a.lease_expires_at<=now()) then raise exception 'community_unavailable';end if;
 else
 if (select count(*) from public.community_media_assets where user_id=auth.uid() and created_at>now()-interval '1 day')>=5 or (select count(*) from public.community_media_assets where user_id=auth.uid())>=30 then raise exception 'community_rate_limited';end if;
 select generation into g from public.community_profiles where user_id=auth.uid();
 insert into public.community_media_assets(user_id,generation,operation_id,digest,alt_text) values(auth.uid(),g,(p_args->>'operationId')::uuid,p_args->>'digest',btrim(p_args->>'altText')) returning * into a;end if;
 if a.state='uploading' then
 if a.decode_attempts>=3 then raise exception 'community_rate_limited';end if;
 update public.community_media_assets set decode_attempts=decode_attempts+1 where id=a.id;end if;
 return jsonb_build_object('id',a.id,'userId',a.user_id,'generation',a.generation,'imagePath','quarantine/'||a.id||'/image.jpg','thumbnailPath','quarantine/'||a.id||'/thumbnail.jpg','uploaded',a.state<>'uploading');
end $$;
create function public.community_media_commit(p_id uuid,p_user_id uuid,p_generation integer,p_digest text,p_width integer,p_height integer) returns void language plpgsql security definer set search_path='' as $$declare a public.community_media_assets;begin
 if auth.role() is distinct from 'service_role' then raise exception 'community_access_denied';end if;
 perform public.community_lock();select * into a from public.community_media_assets where id=p_id for update;
 if a.id is null or a.user_id<>p_user_id or a.generation<>p_generation or a.digest<>p_digest or not public.community_feature_enabled('media',a.user_id)
 or not exists(select 1 from public.community_profiles where user_id=a.user_id and generation=a.generation)
 or p_width is null or p_height is null or p_width not between 1 and 1600 or p_height not between 1 and 1600 then raise exception 'community_unavailable';end if;
 if a.state in ('pending','approved') then return;end if;
 if a.state<>'uploading' or a.lease_expires_at<=now() then raise exception 'community_unavailable';end if;
 update public.community_media_assets set state='pending',width=p_width,height=p_height,updated_at=now(),version=version+1 where id=p_id;
end $$;
create function public.community_media_access(p_id uuid,p_variant text) returns jsonb language plpgsql security definer set search_path='' as $$declare a public.community_media_assets;begin
 perform public.community_lock();
 if p_variant is null or p_variant not in ('image','thumbnail') or not public.community_can_view_media(p_id) then raise exception 'community_unavailable';end if;
 select * into a from public.community_media_assets where id=p_id for update;
 -- A non-owner pending read is always a named MFA quarantine inspection.
 -- Audit that authorized path explicitly before returning any object reference.
 if a.state='pending' and a.user_id<>auth.uid() then
 insert into public.community_moderation_actions(target_type,target_id,action,reason,staff_operator) values('media',p_id::text,'inspect','Pending media quarantine inspection',public.community_staff_required());end if;
 return jsonb_build_object('path','quarantine/'||p_id||'/'||case when p_variant='image' then 'image.jpg' else 'thumbnail.jpg' end,'version',a.version);
end $$;
create function public.community_media(p_operation text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$declare a public.community_media_assets;lim integer;after_id uuid;items jsonb;next_id uuid;reviewer uuid;begin
 perform public.community_lock();
 if auth.uid() is null then raise exception 'community_access_denied';end if;
 if p_operation='delete' then update public.community_media_assets set state='revoked',updated_at=now(),version=version+1 where id=(p_args->>'id')::uuid and user_id=auth.uid() and state<>'revoked';return jsonb_build_object('deleted',true);end if;
 if p_operation='review' then
 reviewer:=public.community_staff_required();select * into a from public.community_media_assets where id=(p_args->>'id')::uuid for update;
 if a.id is null or a.state<>'pending' or not public.community_feature_enabled('media',a.user_id) or not exists(select 1 from public.community_profiles where user_id=a.user_id and generation=a.generation) then raise exception 'community_unavailable';end if;
 if a.user_id=reviewer then raise exception 'community_access_denied';end if;
 if p_args->>'decision' is null or p_args->>'decision' not in ('approve','reject') or nullif(btrim(p_args->>'reason'),'') is null or char_length(p_args->>'reason')>500 then raise exception 'community_invalid_input';end if;
 insert into public.community_media_review_actions(user_id,asset_id,reviewer_user_id,decision,reason) values(a.user_id,a.id,reviewer,p_args->>'decision',p_args->>'reason');
 update public.community_media_assets set state=case when p_args->>'decision'='approve' then 'approved' else 'rejected' end,version=version+1,updated_at=now() where id=a.id;
 return public.community_media_dto(a.id);
 elsif p_operation='queue' then
 perform public.community_staff_required();
 elsif not public.community_feature_enabled('media',auth.uid()) and not (p_operation='list' and p_args->>'mine'='true') then raise exception 'community_unavailable';end if;
 if p_operation in ('list','queue') then
 lim:=coalesce((p_args->>'limit')::integer,10);after_id:=(p_args->>'cursor')::uuid;if lim not between 1 and 20 then raise exception 'community_invalid_input';end if;
 select coalesce(jsonb_agg(t.dto order by t.id),'[]') into items from (select asset_row.id,public.community_media_dto(asset_row.id) dto from public.community_media_assets asset_row
 where (after_id is null or asset_row.id>after_id) and ((p_operation='queue' and asset_row.state='pending') or (p_operation='list' and ((p_args->>'mine'='true' and asset_row.user_id=auth.uid()) or (coalesce(p_args->>'mine','false')<>'true' and asset_row.state='approved' and public.community_feature_enabled('media',auth.uid()) and public.community_active(asset_row.user_id) and asset_row.generation=(select generation from public.community_profiles where user_id=asset_row.user_id) and not public.community_blocked_between(auth.uid(),asset_row.user_id) and (asset_row.user_id=auth.uid() or exists(select 1 from public.community_relationships where follower_user_id=auth.uid() and target_user_id=asset_row.user_id and status='approved')))))) order by asset_row.id limit lim)t;
 if jsonb_array_length(items)=lim then next_id:=(items->(lim-1)->>'id')::uuid;end if;return jsonb_build_object('items',items,'nextCursor',next_id);
 elsif p_operation='get' then
 if not public.community_can_view_media((p_args->>'id')::uuid) then raise exception 'community_unavailable';end if;return public.community_media_dto((p_args->>'id')::uuid);
 else raise exception 'community_invalid_input';end if;
end $$;
create function public.community_media_cleanup(p_operation text,p_args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare items jsonb;lim integer;begin
 if auth.role() is distinct from 'service_role' then raise exception 'community_access_denied';end if;
 perform public.community_lock();
 if p_operation='claim' then
 lim:=coalesce((p_args->>'limit')::integer,50);if lim not between 1 and 100 then raise exception 'community_invalid_input';end if;
 -- Auth erasure ends evidence access; retain only the bounded late-upload safety window.
 update public.community_media_cleanup_jobs j set not_before=j.created_at+interval '10 minutes' where j.id in (
 select orphan.id from public.community_media_cleanup_jobs orphan where orphan.not_before>orphan.created_at+interval '10 minutes'
 and not exists(select 1 from auth.users where id=orphan.user_id) order by orphan.created_at,orphan.id limit lim);
 update public.community_media_assets set state='revoked',version=version+1,updated_at=now() where id in (
 select expired.id from public.community_media_assets expired where expired.state='uploading' and expired.lease_expires_at<=now() order by expired.lease_expires_at,expired.id limit lim);
 update public.community_media_assets set state='revoked',version=version+1,updated_at=now() where id in (
 select stale.id from public.community_media_assets stale where stale.state='pending' and stale.created_at<now()-interval '7 days' order by stale.created_at,stale.id limit lim);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'imagePath',image_path,'thumbnailPath',thumbnail_path)),'[]') into items from (select * from public.community_media_cleanup_jobs where not_before<=now() order by not_before,id limit lim)t;return items;
 elsif p_operation='ack' then
 -- Retained receipts enforce retry uniqueness even after bytes are removed.
 delete from public.community_media_cleanup_jobs where id=(p_args->>'id')::uuid and not_before<=now();return '{}'::jsonb;
 else raise exception 'community_invalid_input';end if;
end $$;
create function public.community_media_export(p_category text,p_after text,p_limit integer) returns table(item_key text,item jsonb) language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null then raise exception 'community_access_denied';end if;if p_limit is null or p_limit not between 1 and 500 then raise exception 'community_conflict';end if;
 if p_category='media' then return query select a.id::text,to_jsonb(a)-'digest' from public.community_media_assets a where user_id=auth.uid() and (p_after is null or a.id::text>p_after) order by a.id::text limit p_limit;
 elsif p_category='mediaReviews' then return query select r.id::text,to_jsonb(r)-'reviewer_user_id' from public.community_media_review_actions r where user_id=auth.uid() and (p_after is null or r.id::text>p_after) order by r.id::text limit p_limit;
 else raise exception 'community_conflict';end if;end $$;
create function public.community_media_withdraw(p_user_id uuid,p_generation integer,p_limit integer) returns integer language plpgsql security definer set search_path='' as $$declare n integer;c integer;begin
 if p_limit is null or p_limit not between 1 and 500 or not exists(select 1 from public.community_profiles where user_id=p_user_id and generation=p_generation and status<>'active') then raise exception 'community_conflict';end if;
 delete from public.community_media_assets where id in(select id from public.community_media_assets where user_id=p_user_id limit p_limit);get diagnostics n=row_count;
 delete from public.community_media_review_actions where id in(select id from public.community_media_review_actions where user_id=p_user_id limit p_limit);get diagnostics c=row_count;return n+c;
end $$;
-- Restore requires a fresh human approval; old approval cannot re-expose restored bytes.
create function public.community_media_restore_quarantine() returns integer language plpgsql security definer set search_path='' as $$declare n integer;begin
 if auth.role() is distinct from 'service_role' then raise exception 'community_access_denied';end if;
 update public.community_media_assets set state='pending',version=version+1,updated_at=now() where state='approved';get diagnostics n=row_count;return n;
end $$;
revoke all on function public.community_media_staff(),public.community_can_view_media(uuid),public.community_media_dto(uuid),public.community_media_queue_delete(),public.community_media_begin(jsonb),public.community_media_commit(uuid,uuid,integer,text,integer,integer),public.community_media_access(uuid,text),public.community_media(text,jsonb),public.community_media_cleanup(text,jsonb),public.community_media_export(text,text,integer),public.community_media_withdraw(uuid,integer,integer),public.community_media_restore_quarantine() from public,anon,authenticated,service_role;
grant execute on function public.community_media_begin(jsonb),public.community_media_access(uuid,text),public.community_media(text,jsonb),public.community_media_export(text,text,integer) to authenticated;
grant execute on function public.community_media_commit(uuid,uuid,integer,text,integer,integer),public.community_media_cleanup(text,jsonb),public.community_media_withdraw(uuid,integer,integer),public.community_media_restore_quarantine() to service_role;

create function public.community_media_evidence_access(p_report_id uuid,p_variant text) returns jsonb language plpgsql security definer set search_path='' as $$declare r public.community_reports;begin
 perform public.community_staff_required();select * into r from public.community_reports where id=p_report_id and target_type='media' and created_at>now()-interval '30 days';
 if r.id is null or r.subject_user_id is null or r.target_id !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or r.evidence_snapshot='{}'::jsonb or p_variant is null or p_variant not in ('image','thumbnail') then raise exception 'community_unavailable';end if;
 perform public.community_audit_inspection(r.id,'Case scoped media evidence inspection');
 return jsonb_build_object('path','quarantine/'||r.target_id||'/'||case when p_variant='image' then 'image.jpg' else 'thumbnail.jpg' end,'version',extract(epoch from r.updated_at));
end $$;
revoke all on function public.community_media_evidence_access(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.community_media_evidence_access(uuid,text) to authenticated;
-- Chain each extension once, preserving prior authorization decisions.
alter function public.community_issue_report_receipt(text,text) rename to community_issue_report_receipt_before_media;
create function public.community_issue_report_receipt(p_target_type text,p_target_id text) returns table(id uuid)
language plpgsql security definer set search_path='' as $$declare r public.community_media_assets;snapshot jsonb;receipt_id uuid;begin
 if p_target_type is distinct from 'media' then return query select * from public.community_issue_report_receipt_before_media(p_target_type,p_target_id);return;end if;
 perform public.community_lock();
 if not public.community_can_view_media(p_target_id::uuid) then raise exception 'community_unavailable';end if;
 select * into r from public.community_media_assets where community_media_assets.id=p_target_id::uuid and user_id<>auth.uid();
 if r.id is null then raise exception 'community_unavailable';end if;
 snapshot:=jsonb_build_object('altText',r.alt_text,'width',r.width,'height',r.height,'digest',r.digest);
 select receipt_row.id into receipt_id from public.community_report_receipts receipt_row where receipt_row.user_id=auth.uid() and receipt_row.target_type='media' and receipt_row.target_id=r.id::text and receipt_row.subject_user_id=r.user_id and receipt_row.evidence_snapshot=snapshot and receipt_row.expires_at>now() order by receipt_row.created_at desc,receipt_row.id desc limit 1;
 if receipt_id is null then insert into public.community_report_receipts(user_id,target_type,target_id,subject_user_id,evidence_snapshot) values(auth.uid(),'media',r.id::text,r.user_id,snapshot) returning community_report_receipts.id into receipt_id;end if;
 if receipt_id is null then raise exception 'community_rate_limited';end if;
 return query select receipt_id;
end $$;
alter function public.community_submit_report(text,text,text,text,uuid) rename to community_submit_report_before_media;
create function public.community_submit_report(p_target_type text,p_target_id text,p_reason text,p_notes text default null,p_interaction_receipt_id uuid default null) returns setof public.community_reports language plpgsql security definer set search_path='' as $$ declare r public.community_reports; receipt public.community_report_receipts; subject uuid; snapshot jsonb; n integer;begin
 if p_target_type is distinct from 'media' then return query select * from public.community_submit_report_before_media(p_target_type,p_target_id,p_reason,p_notes,p_interaction_receipt_id);return;end if;
 perform public.community_lock();
 if auth.uid() is null then raise exception 'community_access_denied';end if;
 if p_target_type is null or p_reason is null or p_target_type<>'media' or p_reason not in ('harassment','offensive_content','impersonation','spam','unsafe_or_sexual_content','other') or char_length(p_notes)>1000 then raise exception 'community_invalid_report';end if;
 if p_interaction_receipt_id is not null then select * into receipt from public.community_report_receipts where id=p_interaction_receipt_id and user_id=auth.uid() and target_type=p_target_type and target_id=p_target_id and expires_at>now();end if;
 if p_interaction_receipt_id is not null and receipt.id is null then raise exception 'community_unavailable';end if;
 if p_interaction_receipt_id is null then select * into receipt from public.community_report_receipts where user_id=auth.uid() and target_type=p_target_type and target_id=p_target_id and expires_at>now() order by created_at desc limit 1;end if;
 if receipt.id is null then
 if public.community_can_view_media(p_target_id::uuid) then select target_row.user_id,jsonb_build_object('altText',target_row.alt_text,'width',target_row.width,'height',target_row.height,'digest',target_row.digest) into subject,snapshot from public.community_media_assets target_row where target_row.id=p_target_id::uuid and target_row.user_id<>auth.uid();end if;
 if subject is null then raise exception 'community_unavailable';end if;
 else subject:=receipt.subject_user_id;snapshot:=receipt.evidence_snapshot;end if;
 select * into r from public.community_reports where reporter_user_id=auth.uid() and target_type=p_target_type and target_id=p_target_id and reason=p_reason and status in ('submitted','under_review') order by created_at limit 1 for update;
 if r.id is not null then update public.community_reports set notes=case when nullif(p_notes,'') is null then notes else left(concat_ws(E'\n',notes,p_notes),1000) end,updated_at=now() where id=r.id returning * into r;r.assigned_to:=null;r.staff_notes:=null;r.subject_user_id:=null;r.evidence_snapshot:='{}';return next r;return;end if;
 insert into public.community_report_usage(user_id,report_date,report_count) values(auth.uid(),(now() at time zone 'UTC')::date,1) on conflict(user_id,report_date) do update set report_count=community_report_usage.report_count+1 where community_report_usage.report_count<10 returning report_count into n;
 if n is null then raise exception 'community_rate_limited';end if;
 insert into public.community_reports(reporter_user_id,target_type,target_id,reason,notes,priority,subject_user_id,evidence_snapshot) values(auth.uid(),p_target_type,p_target_id,p_reason,p_notes,case when p_reason in ('harassment','unsafe_or_sexual_content') then 'urgent' else 'normal' end,subject,coalesce(snapshot,'{}')) returning * into r;r.subject_user_id:=null;r.evidence_snapshot:='{}';return next r;
 end $$;

alter function public.community_apply_moderation_action(uuid,text,text,text,integer) rename to community_apply_moderation_action_before_media;
create function public.community_apply_moderation_action(p_report_id uuid,p_decision text,p_decision_reason text,p_staff_notes text default null,p_suspension_duration_days integer default null)
returns setof public.community_reports language plpgsql security definer set search_path='' as $$declare operator uuid; r public.community_reports;begin
 operator:=public.community_staff_required();perform public.community_lock();select * into r from public.community_reports where id=p_report_id for update;
 if r.target_type is distinct from 'media' or p_decision is distinct from 'remove' then return query select * from public.community_apply_moderation_action_before_media(p_report_id,p_decision,p_decision_reason,p_staff_notes,p_suspension_duration_days);return;end if;
 if r.status not in ('submitted','under_review') or (r.assigned_to is not null and r.assigned_to<>operator::text) then raise exception 'community_conflict';end if;
 if operator=r.subject_user_id or operator=r.reporter_user_id then raise exception 'community_access_denied';end if;
 if nullif(btrim(p_decision_reason),'') is null or char_length(p_decision_reason)>500 or char_length(p_staff_notes)>1000 then raise exception 'community_invalid_action';end if;
 update public.community_media_assets set state='revoked',version=version+1,updated_at=now() where id::text=r.target_id and state<>'revoked';
 insert into public.community_moderation_actions(report_id,target_type,target_id,action,reason,staff_operator,staff_notes) values(r.id,r.target_type,r.target_id,'remove',p_decision_reason,operator,p_staff_notes);
 return query update public.community_reports set status='resolved',decision='remove',decision_reason=p_decision_reason,staff_notes=p_staff_notes,assigned_to=operator::text,action_taken_at=now(),updated_at=now() where id=p_report_id returning *;
end $$;
revoke all on function public.community_issue_report_receipt_before_media(text,text),public.community_submit_report_before_media(text,text,text,text,uuid),public.community_apply_moderation_action_before_media(uuid,text,text,text,integer),public.community_issue_report_receipt(text,text),public.community_submit_report(text,text,text,text,uuid),public.community_apply_moderation_action(uuid,text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.community_issue_report_receipt(text,text),public.community_submit_report(text,text,text,text,uuid),public.community_apply_moderation_action(uuid,text,text,text,integer) to authenticated;
commit;
