-- Bounded caller-owned safety evidence; expiration denies delivery before purge.
begin;
create function public.community_report_receipt_bounds() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.community_lock();
 -- Exact evidence retries never extend a receipt's original 30-day authority.
 if exists(select 1 from public.community_report_receipts r where r.user_id=new.user_id
   and r.target_type=new.target_type and r.target_id=new.target_id
   and r.subject_user_id is not distinct from new.subject_user_id
   and r.evidence_snapshot=new.evidence_snapshot and r.expires_at>now()) then return null;end if;
 -- Automatic interaction capture must never prevent block, withdrawal, removal,
 -- unreact or erasure. Existing receipts remain valid at either issuance bound.
 if (select count(*) from public.community_report_receipts where user_id=new.user_id and expires_at>now())>=1000
 or (select count(*) from public.community_report_receipts where user_id=new.user_id
     and created_at>=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'))>=120 then return null;end if;
 return new;
end $$;
create trigger community_report_receipt_bounds before insert on public.community_report_receipts
for each row execute function public.community_report_receipt_bounds();
create or replace function public.community_issue_report_receipt(p_target_type text,p_target_id text)
returns table(id uuid) language plpgsql security definer set search_path='' as $$
declare subject uuid;snapshot jsonb;receipt_id uuid;
begin
 perform public.community_lock();
 if auth.uid() is null then raise exception 'community_access_denied';end if;
 if p_target_type='profile' then
 select p.user_id,jsonb_build_object('handle',p.handle,'displayName',p.display_name,'avatarSymbol',p.avatar_symbol,'bio',p.bio)
 into subject,snapshot from public.community_get_profile(p_target_id::uuid) p where p.user_id<>auth.uid();
 elsif p_target_type='activity' and public.community_can_view_card(p_target_id::uuid) then
 select a.user_id into subject from public.shared_activities a where a.id=p_target_id::uuid and a.user_id<>auth.uid();
 end if;
 if subject is null then raise exception 'community_unavailable';end if;
 if p_target_type='activity' then snapshot:=public.community_social_snapshot(p_target_type,p_target_id);end if;
 select r.id into receipt_id from public.community_report_receipts r where r.user_id=auth.uid()
 and r.target_type=p_target_type and r.target_id=p_target_id and r.subject_user_id=subject
 and r.evidence_snapshot=snapshot and r.expires_at>now() order by r.created_at desc,r.id desc limit 1;
 if receipt_id is not null then return query select receipt_id;return;end if;
 insert into public.community_report_receipts(user_id,target_type,target_id,subject_user_id,evidence_snapshot)
 values(auth.uid(),p_target_type,p_target_id,subject,snapshot) returning community_report_receipts.id into receipt_id;
 if receipt_id is null then raise exception 'community_rate_limited';end if;
 return query select receipt_id;
end $$;
create or replace function public.community_notification_visible(e public.community_inbox_events)
returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 if not public.community_eligible(e.user_id) or e.expires_at<=now() then return false;end if;
 if e.kind='moderation' then return exists(select 1 from public.community_reports where id=e.target_id and (reporter_user_id=e.user_id or subject_user_id=e.user_id));end if;
 if not public.community_active(e.user_id) or not public.community_active(e.actor_user_id)
 or e.generation<>(select generation from public.community_profiles where user_id=e.user_id)
 or public.community_blocked_between(e.user_id,e.actor_user_id)
 or exists(select 1 from public.community_mutes where user_id=e.user_id and target_user_id=e.actor_user_id) then return false;end if;
 if e.kind='request' then return exists(select 1 from public.community_relationships where id=e.target_id and follower_user_id=e.actor_user_id and target_user_id=e.user_id and status='pending');end if;
 if e.kind='approval' then return exists(select 1 from public.community_relationships where id=e.target_id and follower_user_id=e.user_id and target_user_id=e.actor_user_id and status='approved');end if;
 return exists(select 1 from public.community_reactions r join public.shared_activities a on a.id=r.activity_id
 join public.community_relationships f on f.follower_user_id=r.user_id and f.target_user_id=a.user_id and f.status='approved'
 where a.id=e.target_id and a.version=e.activity_version and r.id=e.source_id and a.user_id=e.user_id
 and r.user_id=e.actor_user_id and a.revoked_at is null and a.published_at>now()-interval '365 days'
 and a.enrollment_generation=(select generation from public.community_profiles where user_id=e.user_id));
end $$;
revoke all on function public.community_report_receipt_bounds(),public.community_issue_report_receipt(text,text),public.community_notification_visible(public.community_inbox_events) from public,anon,authenticated;
grant execute on function public.community_issue_report_receipt(text,text) to authenticated;
grant execute on function public.community_notification_visible(public.community_inbox_events) to service_role;
commit;
