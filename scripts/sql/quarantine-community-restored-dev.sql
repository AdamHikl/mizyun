-- ONLY for the runner's disposable, unexposed mizyun_restore database.
-- This closes restored social authority. It does not reconcile erasures or
-- replace the external revocation journal; no restored service may reopen.
begin;
do $$begin
 if current_database()<>'mizyun_restore'
 or current_setting('mizyun.restore_environment',true) is distinct from 'dev'
 or coalesce(current_setting('mizyun.restore_run_id',true),'') !~ '^[a-f0-9]{32}$'
 then raise exception 'quarantine_target_mismatch';end if;
 if to_regclass('public.community_operations') is null then raise exception 'quarantine_schema_missing';end if;
end $$;
update public.community_operations set enabled=false,enrollment=false,discovery=false,publish=false,engagement=false,delivery=false,cohort_required=true;
delete from public.community_pilot_cohort;
delete from public.community_notification_outbox;
delete from public.community_push_tokens;
do $$begin
 if to_regclass('public.community_feature_controls') is not null then
 update public.community_feature_controls set enabled=false,updated_at=now();end if;
 if to_regclass('public.community_media_assets') is not null then
 update public.community_media_assets set state='pending',version=version+1,updated_at=now() where state='approved';end if;
 if to_regclass('public.community_feature_controls') is not null and exists(select 1 from public.community_feature_controls where enabled) then raise exception 'quarantine_features_open';end if;
 if to_regclass('public.community_media_assets') is not null and exists(select 1 from public.community_media_assets where state='approved') then raise exception 'quarantine_media_open';end if;
end $$;
-- Identity/source rows remain restricted inside the offline container for
-- later reconciliation. Owner export/RPC exemptions are NOT a reopen path.
select jsonb_build_object(
 'operationsClosed',not exists(select 1 from public.community_operations where enabled or enrollment or discovery or publish or engagement or delivery or not cohort_required),
 'cohortEmpty',not exists(select 1 from public.community_pilot_cohort),
 'deliveryEmpty',not exists(select 1 from public.community_notification_outbox),
 'pushTokensEmpty',not exists(select 1 from public.community_push_tokens),
 'featureFlagsClosed',true,'mediaQuarantined',true,
 'revocationsReconciled',false,'reopenPermitted',false);
commit;
