begin;
-- Preserve the scalar table-name iteration while avoiding a plpgsql_check
-- false positive that substituted the whole FOREACH array into dynamic SQL.
-- Existing lease, ownership, bounds, security settings and privileges are unchanged.
create or replace function public.community_account_cleanup_batch(p_user_id uuid,p_job_id uuid,p_worker_id text,p_limit integer default 500) returns table(deleted_count integer,complete boolean) language plpgsql security definer set search_path='' as $$declare n integer:=0;c integer;r record;done boolean;pending boolean:=false;t text;begin
 perform public.community_lock();
 if p_limit is null or p_limit not between 1 and 500 then raise exception 'community_conflict';end if;
 if not exists(select 1 from public.account_deletion_jobs where id=p_job_id and user_id=p_user_id and status='in_progress' and worker_id=p_worker_id and lease_expires_at>now()) then raise exception 'community_access_denied';end if;
 select b.deleted_count,b.complete into n,done from public.community_account_cleanup_batch_before_expansion_lifecycle(p_user_id,p_job_id,p_worker_id,p_limit)b;
 delete from public.community_messages where id in(select id from public.community_messages where recipient_id=p_user_id limit p_limit);get diagnostics c=row_count;n:=n+c;
 if exists(select 1 from public.community_messages where recipient_id=p_user_id) then done:=false;end if;
 -- Profile transition above revokes visibility, recovers group ownership and cancels challenges.
 for t in select pg_catalog.unnest(array['community_comments','community_comment_settings','community_comment_preferences','community_comment_operations','community_comment_usage','community_comment_mentions','community_group_posts','community_group_operations','community_group_appeals','community_group_events','community_group_members','community_groups','community_routine_shares','community_routine_imports','community_messages','community_message_operations','community_messaging_preferences','community_broader_discovery_preferences','community_broader_discovery_usage','community_challenge_contributions','community_challenge_members','community_challenges','community_media_review_actions','community_media_assets']::text[]) loop
 execute format('delete from public.%I where ctid in(select ctid from public.%I where user_id=$1 limit $2)',t,t) using p_user_id,p_limit;
 get diagnostics c=row_count;n:=n+c;
 execute format('select exists(select 1 from public.%I where user_id=$1)',t) into pending using p_user_id;
 if pending then done:=false;end if;
 end loop;
 -- Cleanup tickets deliberately survive metadata/Auth deletion until physical Storage ACK.
 return query select n,done;
end $$;
commit;
