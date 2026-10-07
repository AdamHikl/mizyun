begin;
-- Existing operations and owner-only erasure remain compatible. Only the wrapper
-- is callable: the legacy implementation cannot bypass new operation dispatch.
alter function public.community_messaging_rpc(text,jsonb) rename to community_messaging_rpc_before_reads;
revoke all on function public.community_messaging_rpc_before_reads(text,jsonb) from public,anon,authenticated;
create index community_messages_sender_recent on public.community_messages(user_id,created_at desc,id desc);
create index community_messages_recipient_recent on public.community_messages(recipient_id,created_at desc,id desc);
create function public.community_messaging_rpc(p_operation text,p_args jsonb default '{}')
returns table(result jsonb) language plpgsql volatile security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); peer uuid; pref public.community_messaging_preferences;
 before_time timestamptz; before_id uuid; items jsonb; next_before jsonb;
 contacts jsonb; m public.community_messages;
begin
 if p_operation not in ('threads','latest') then
   return query select * from public.community_messaging_rpc_before_reads(p_operation,p_args); return;
 end if;
 perform public.community_lock();
 if u is null then raise exception 'community_access_denied';end if;
 if not public.community_feature_enabled('messaging',u) then raise exception 'community_unavailable';end if;
 select mp.* into pref from public.community_messaging_preferences mp
 join public.community_profiles cp on cp.user_id=mp.user_id and cp.generation=mp.generation where mp.user_id=u;
 if p_args ? 'before' then
   if jsonb_typeof(p_args->'before')<>'object' or p_args->'before'->>'createdAt' is null or p_args->'before'->>'id' is null then
     raise exception 'community_invalid_input';
   end if;
   before_time:=(p_args->'before'->>'createdAt')::timestamptz;
   before_id:=(p_args->'before'->>'id')::uuid;
 end if;
 if p_operation='threads' then
   if not coalesce(pref.enabled,false) then
     return query select jsonb_build_object('enabled',false,'muted',coalesce(pref.muted,false),'threads','[]'::jsonb,'contacts','[]'::jsonb,'nextBefore',null);return;
   end if;
   -- One database query over authorized message rows, never client per-contact
   -- history fan-out. Latest tuple is stable through edits and tombstones.
   with visible as (
     select message_row.*,case when message_row.user_id=u then message_row.recipient_id else message_row.user_id end peer_id
     from public.community_messages message_row
     where (message_row.user_id=u or message_row.recipient_id=u)
     and message_row.created_at>now()-interval '90 days'
     and public.community_message_visible(message_row.id)
   ), latest as (
     select distinct on (v.peer_id) v.* from visible v order by v.peer_id,v.created_at desc,v.id desc
   ), bounded as (
     select l.*,p.display_name,row_number() over(order by l.created_at desc,l.id desc) rn
     from latest l join public.community_profiles p on p.user_id=l.peer_id
     where before_time is null or (l.created_at,l.id)<(before_time,before_id)
     order by l.created_at desc,l.id desc limit 31
   )
   select coalesce(jsonb_agg(jsonb_build_object('userId',b.peer_id,'displayName',b.display_name,'latestMessage',public.community_message_dto(row(b.id,b.user_id,b.recipient_id,b.body,b.original_digest,b.version,b.sender_generation,b.recipient_generation,b.created_at,b.edited_at,b.deleted_at)::public.community_messages)) order by b.created_at desc,b.id desc) filter(where b.rn<=30),'[]'::jsonb),
   case when count(*)>30 then (jsonb_agg(jsonb_build_object('createdAt',b.created_at,'id',b.id) order by b.created_at,b.id) filter(where b.rn<=30))->0 end
   into items,next_before from bounded b;
   select coalesce(jsonb_agg(jsonb_build_object('userId',p.user_id,'displayName',p.display_name) order by p.display_name,p.user_id),'[]'::jsonb) into contacts
   from (select cp.user_id,cp.display_name from public.community_profiles cp where public.community_message_pair(u,cp.user_id) order by cp.display_name,cp.user_id limit 30) p;
   return query select jsonb_build_object('enabled',true,'muted',pref.muted,'threads',items,'contacts',contacts,'nextBefore',next_before);return;
 end if;
 peer:=(p_args->>'peerId')::uuid;
 if peer is null or not public.community_message_pair(u,peer) then raise exception 'community_unavailable';end if;
 -- A timestamp/UUID keyset survives expiry or deletion of the boundary row.
 -- Permission is rechecked for every returned message, including older pages.
 with bounded as (
   select message_row.*,row_number() over(order by message_row.created_at desc,message_row.id desc) rn
   from public.community_messages message_row
   where ((message_row.user_id=u and message_row.recipient_id=peer) or(message_row.user_id=peer and message_row.recipient_id=u))
   and public.community_message_visible(message_row.id)
   and (before_time is null or (message_row.created_at,message_row.id)<(before_time,before_id))
   order by message_row.created_at desc,message_row.id desc limit 51
 )
 select coalesce(jsonb_agg(public.community_message_dto(row(b.id,b.user_id,b.recipient_id,b.body,b.original_digest,b.version,b.sender_generation,b.recipient_generation,b.created_at,b.edited_at,b.deleted_at)::public.community_messages) order by b.created_at,b.id) filter(where b.rn<=50),'[]'::jsonb),
 case when count(*)>50 then (jsonb_agg(jsonb_build_object('createdAt',b.created_at,'id',b.id) order by b.created_at,b.id) filter(where b.rn<=50))->0 end
 into items,next_before from bounded b;
 -- Match existing list's bounded report-evidence issuance for incoming text.
 for m in select message_row.* from public.community_messages message_row where message_row.recipient_id=u and message_row.deleted_at is null
 and exists(select 1 from jsonb_array_elements(items) delivered where delivered->>'id'=message_row.id::text) loop
   begin perform id from public.community_issue_report_receipt('message',m.id::text);
   exception when raise_exception then if sqlerrm<>'community_rate_limited' then raise;end if;end;
 end loop;
 return query select jsonb_build_object('messages',items,'nextBefore',next_before,'peer',(select jsonb_build_object('userId',cp.user_id,'displayName',cp.display_name) from public.community_profiles cp where cp.user_id=peer));
end;
$$;
revoke all on function public.community_messaging_rpc(text,jsonb) from public,anon,authenticated;
grant execute on function public.community_messaging_rpc(text,jsonb) to authenticated;
commit;
