begin;
-- Ordinary account exports include every expansion through the existing bounded keyset port.
alter function public.community_export_page(text,text,integer) rename to community_export_page_before_expansion_lifecycle;
create function public.community_export_page(p_category text,p_after text default null,p_limit integer default 500) returns table(item_key text,item jsonb) language plpgsql security definer set search_path='' as $$begin
 if p_category in('routineShares','routineImports') then return query select * from public.community_routine_export(p_category,p_after,p_limit);
 elsif p_category in('media','mediaReviews') then return query select * from public.community_media_export(p_category,p_after,p_limit);
 else return query select * from public.community_export_page_before_expansion_lifecycle(p_category,p_after,p_limit);end if;end $$;
-- Drain new artifacts before the original worker is allowed to complete a generation.
alter function public.community_withdrawal_batch(uuid,integer,integer) rename to community_withdrawal_batch_before_expansion_lifecycle;
create function public.community_withdrawal_batch(p_user_id uuid,p_generation integer,p_limit integer default 500) returns table(deleted_count integer,complete boolean) language plpgsql security definer set search_path='' as $$declare n integer:=0;c integer;r record;begin
 perform public.community_lock();
 if p_limit is null or p_limit not between 1 and 500 then raise exception 'community_conflict';end if;
 if not exists(select 1 from public.community_withdrawal_jobs where user_id=p_user_id and generation=p_generation and completed_at is null) then return query select 0,true;return;end if;
 n:=public.community_routine_withdraw(p_user_id,p_generation,p_limit);
 c:=public.community_media_withdraw(p_user_id,p_generation,p_limit);n:=n+c;
 if exists(select 1 from public.community_routine_shares where user_id=p_user_id) or exists(select 1 from public.community_routine_imports where user_id=p_user_id) or exists(select 1 from public.community_media_assets where user_id=p_user_id) or exists(select 1 from public.community_media_review_actions where user_id=p_user_id) then return query select n,false;return;end if;
 for r in select * from public.community_withdrawal_batch_before_expansion_lifecycle(p_user_id,p_generation,p_limit) loop return query select n+r.deleted_count,r.complete;end loop;
end $$;
alter function public.community_retention_batch(integer) rename to community_retention_batch_before_expansion_lifecycle;
create function public.community_retention_batch(p_limit integer default 500) returns table(deleted_count integer) language plpgsql security definer set search_path='' as $$declare n integer:=0;c integer;r record;begin
 perform public.community_lock();if p_limit is null or p_limit not between 1 and 500 then raise exception 'community_conflict';end if;
 delete from public.community_messages where id in(select id from public.community_messages where created_at<=now()-interval '90 days' limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_broader_discovery_usage where ctid in(select ctid from public.community_broader_discovery_usage where usage_day<current_date-1 limit p_limit);get diagnostics c=row_count;n:=n+c;
 for r in select * from public.community_retention_batch_before_expansion_lifecycle(p_limit) loop return query select n+r.deleted_count;end loop;
end $$;
revoke all on function public.community_export_page(text,text,integer),public.community_export_page_before_expansion_lifecycle(text,text,integer),public.community_withdrawal_batch(uuid,integer,integer),public.community_withdrawal_batch_before_expansion_lifecycle(uuid,integer,integer),public.community_retention_batch(integer),public.community_retention_batch_before_expansion_lifecycle(integer) from public,anon,authenticated,service_role;
grant execute on function public.community_export_page(text,text,integer) to authenticated;
grant execute on function public.community_withdrawal_batch(uuid,integer,integer),public.community_retention_batch(integer) to service_role;

-- Existing account worker must exhaust expansion rows before Auth cascade.
alter function public.community_account_cleanup_batch(uuid,uuid,text,integer) rename to community_account_cleanup_batch_before_expansion_lifecycle;
create function public.community_account_cleanup_batch(p_user_id uuid,p_job_id uuid,p_worker_id text,p_limit integer default 500) returns table(deleted_count integer,complete boolean) language plpgsql security definer set search_path='' as $$declare n integer:=0;c integer;r record;done boolean;pending boolean:=false;t text;begin
 perform public.community_lock();
 if p_limit is null or p_limit not between 1 and 500 then raise exception 'community_conflict';end if;
 if not exists(select 1 from public.account_deletion_jobs where id=p_job_id and user_id=p_user_id and status='in_progress' and worker_id=p_worker_id and lease_expires_at>now()) then raise exception 'community_access_denied';end if;
 select b.deleted_count,b.complete into n,done from public.community_account_cleanup_batch_before_expansion_lifecycle(p_user_id,p_job_id,p_worker_id,p_limit)b;
 delete from public.community_messages where id in(select id from public.community_messages where recipient_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 if exists(select 1 from public.community_messages where recipient_id=p_user_id) then done:=false;end if;
 -- Profile transition above revokes visibility, recovers group ownership and cancels challenges.
 foreach t in array array['community_comments','community_comment_settings','community_comment_preferences','community_comment_operations','community_comment_usage','community_comment_mentions','community_group_posts','community_group_operations','community_group_appeals','community_group_events','community_group_members','community_groups','community_routine_shares','community_routine_imports','community_messages','community_message_operations','community_messaging_preferences','community_broader_discovery_preferences','community_broader_discovery_usage','community_challenge_contributions','community_challenge_members','community_challenges','community_media_review_actions','community_media_assets'] loop
 execute format('delete from public.%I where ctid in(select ctid from public.%I where user_id=$1 limit $2)',t,t) using p_user_id,p_limit;
 get diagnostics c=row_count;n:=n+c;
 execute format('select exists(select 1 from public.%I where user_id=$1)',t) into pending using p_user_id;
 if pending then done:=false;end if;
 end loop;
 -- Cleanup tickets deliberately survive metadata/Auth deletion until physical Storage ACK.
 return query select n,done;
end $$;
revoke all on function public.community_account_cleanup_batch(uuid,uuid,text,integer),public.community_account_cleanup_batch_before_expansion_lifecycle(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.community_account_cleanup_batch(uuid,uuid,text,integer) to service_role;

-- Extend the original erasure guard to expansion targets without weakening case erasure.
create function public.community_audit_target_owner(p_type text,p_id text) returns uuid language plpgsql stable security definer set search_path='' as $$declare subject uuid;begin
 case p_type
 when 'profile' then select id into subject from auth.users where id::text=p_id;
 when 'activity' then select user_id into subject from public.shared_activities where id::text=p_id;
 when 'comment' then select user_id into subject from public.community_comments where id::text=p_id;
 when 'group' then select user_id into subject from public.community_groups where id::text=p_id;if subject is null then select user_id into subject from public.community_group_appeals where id::text=p_id;end if;
 when 'group_post' then select user_id into subject from public.community_group_posts where id::text=p_id;
 when 'routine' then select user_id into subject from public.community_routine_shares where id::text=p_id;
 when 'message' then select user_id into subject from public.community_messages where id::text=p_id;
 when 'challenge' then select user_id into subject from public.community_challenges where id::text=p_id;
 when 'media' then select user_id into subject from public.community_media_assets where id::text=p_id;
 else subject:=null;end case;return subject;end $$;
create or replace function public.community_audit_erasure_guard() returns trigger language plpgsql security definer set search_path='' as $$declare report public.community_reports;subject uuid;erased_operator boolean:=false;inspection boolean:=false;begin
 select * into report from public.community_reports where id=new.report_id;
 subject:=public.community_audit_target_owner(new.target_type,new.target_id);
 if TG_OP='UPDATE' then erased_operator:=old.staff_operator is not null and new.staff_operator is null;end if;
 -- No-case quarantine/appeal inspections have their own named MFA authority and no body snapshot.
 inspection:=coalesce(new.report_id is null and subject is not null and ((new.target_type='media' and new.action='inspect' and exists(select 1 from public.community_media_assets where id::text=new.target_id and state='pending')) or (new.target_type='group' and new.action in('inspect','reverse','dismiss') and exists(select 1 from public.community_group_appeals where id::text=new.target_id and status='pending'))) and new.staff_operator=auth.uid() and auth.jwt()->>'aal'='aal2' and exists(select 1 from public.community_moderation_staff where user_id=auth.uid() and active),false);
 if not inspection and (report.id is null or report.reporter_user_id is null or report.subject_user_id is null or subject is distinct from report.subject_user_id) or erased_operator then new.reason:='Retained moderation audit metadata; evidence removed.';new.staff_notes:=null;end if;
 if not inspection and (report.id is null or report.subject_user_id is null or subject is distinct from report.subject_user_id) then new.target_id:='deleted';end if;
 if inspection then new.staff_notes:=null;new.reason:=case when new.target_type='media' then 'Pending media quarantine inspection' when new.action='inspect' then 'Group appeal inspection' else 'Group appeal decision' end;end if;
 return new;end $$;
create function public.community_expansion_audit_erasure() returns trigger language plpgsql security definer set search_path='' as $$begin
 update public.community_moderation_actions set target_id='deleted',reason='Retained moderation audit metadata; evidence removed.',staff_notes=null where target_type=TG_ARGV[0] and target_id=old.id::text;
 return old;end $$;
create trigger community_comment_audit_erasure before delete on public.community_comments for each row execute function public.community_expansion_audit_erasure('comment');
create trigger community_group_audit_erasure before delete on public.community_groups for each row execute function public.community_expansion_audit_erasure('group');
create trigger community_group_appeal_audit_erasure before delete on public.community_group_appeals for each row execute function public.community_expansion_audit_erasure('group');
create trigger community_group_post_audit_erasure before delete on public.community_group_posts for each row execute function public.community_expansion_audit_erasure('group_post');
create trigger community_routine_audit_erasure before delete on public.community_routine_shares for each row execute function public.community_expansion_audit_erasure('routine');
create trigger community_message_audit_erasure before delete on public.community_messages for each row execute function public.community_expansion_audit_erasure('message');
create trigger community_challenge_audit_erasure before delete on public.community_challenges for each row execute function public.community_expansion_audit_erasure('challenge');
create trigger community_media_audit_erasure before delete on public.community_media_assets for each row execute function public.community_expansion_audit_erasure('media');
revoke all on function public.community_audit_target_owner(text,text),public.community_audit_erasure_guard(),public.community_expansion_audit_erasure() from public,anon,authenticated,service_role;
commit;
