begin;
-- Aggregate, service-only counts for the Production attention timer (TNS-01/PRIV-03).
-- Counts and ages only: no report ids, text, reporter/subject or user ids leave the database.
-- Clocks follow COMMUNITY_MODERATION_RUNBOOK.md: first response 4h urgent / 24h normal from server receipt.
create function public.community_operations_alert_counts(p_new_window_seconds integer default 3900)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w integer;
begin
 if p_new_window_seconds is null or p_new_window_seconds<60 or p_new_window_seconds>86400 then raise exception 'community_conflict';end if;
 w:=p_new_window_seconds;
 return jsonb_build_object(
  'openReports',(select count(*) from public.community_reports where status in ('submitted','under_review')),
  'unclaimedReports',(select count(*) from public.community_reports where status='submitted'),
  'urgentUnclaimed',(select count(*) from public.community_reports where status='submitted' and priority='urgent'),
  'overdueFirstResponse',(select count(*) from public.community_reports where status='submitted' and created_at<=now()-case when priority='urgent' then interval '4 hours' else interval '24 hours' end),
  'staleOpenReports',(select count(*) from public.community_reports where status in ('submitted','under_review') and created_at<=now()-interval '7 days'),
  'newReports',(select count(*) from public.community_reports where created_at>now()-make_interval(secs=>w)),
  'oldestUnclaimedSeconds',coalesce((select greatest(0,extract(epoch from now()-min(created_at))::bigint) from public.community_reports where status='submitted'),0),
  'pendingWithdrawals',(select count(*) from public.community_withdrawal_jobs where completed_at is null),
  'oldestWithdrawalSeconds',coalesce((select greatest(0,extract(epoch from now()-min(requested_at))::bigint) from public.community_withdrawal_jobs where completed_at is null),0));
end $$;
revoke all on function public.community_operations_alert_counts(integer) from public,anon,authenticated;
grant execute on function public.community_operations_alert_counts(integer) to service_role;
commit;
