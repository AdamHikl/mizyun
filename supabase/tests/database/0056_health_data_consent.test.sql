-- PRIV-01: health-data consent is owner scoped, state checked, and its
-- grant/withdrawal history is append-only for clients.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id, email) values
  ('e0560000-0000-4000-8000-000000000001', 'health-consent-a@mizyun.test'),
  ('e0560000-0000-4000-8000-000000000002', 'health-consent-b@mizyun.test');

select ok((select relrowsecurity from pg_class where oid = 'public.user_health_data_consents'::regclass),
  'consent table enables RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.user_health_data_consent_events'::regclass),
  'consent history enables RLS');
select ok(exists(select 1 from pg_indexes where schemaname = 'public' and indexname = 'user_health_data_consents_user_idx'),
  'consent table has a user_id index');
select ok(not has_table_privilege('anon', 'public.user_health_data_consents', 'SELECT'),
  'anonymous clients cannot read consents');
select ok(not has_table_privilege('authenticated', 'public.user_health_data_consents', 'DELETE'),
  'clients cannot delete a consent record');
select ok(not has_table_privilege('authenticated', 'public.user_health_data_consent_events', 'INSERT'),
  'clients cannot forge consent history');
select ok(not has_table_privilege('authenticated', 'public.user_health_data_consent_events', 'UPDATE'),
  'clients cannot rewrite consent history');
select ok(not has_function_privilege('authenticated', 'public.record_health_data_consent_event()', 'EXECUTE'),
  'clients cannot call the history trigger function');
select ok(not has_function_privilege('authenticated', 'public.stamp_health_data_consent()', 'EXECUTE'),
  'clients cannot call the timestamp trigger function');

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claim.sub = 'e0560000-0000-4000-8000-000000000001';

select lives_ok($$insert into public.user_health_data_consents(user_id, granted, consent_version, consented_at)
  values ('e0560000-0000-4000-8000-000000000001', true, '2026-10-27', now())$$,
  'the owner records a grant');
select throws_ok($$insert into public.user_health_data_consents(user_id, granted, consent_version, consented_at)
  values ('e0560000-0000-4000-8000-000000000002', true, '2026-10-27', now())$$,
  '42501', null, 'a user cannot record consent for another user');
update public.user_health_data_consents set revoked_at = now()
  where user_id = 'e0560000-0000-4000-8000-000000000001';
select ok((select granted and revoked_at is null from public.user_health_data_consents
  where user_id = 'e0560000-0000-4000-8000-000000000001'),
  'a granted row never carries a withdrawal time');
select lives_ok($$update public.user_health_data_consents
  set granted = false, consented_at = null, revoked_at = now(), updated_at = now()
  where user_id = 'e0560000-0000-4000-8000-000000000001'$$,
  'the owner withdraws consent');
select is((select count(*)::int from public.user_health_data_consent_events
  where user_id = 'e0560000-0000-4000-8000-000000000001'), 2,
  'grant and withdrawal are both kept in the history');
select lives_ok($$update public.user_health_data_consents
  set revoked_at = '2020-01-01', created_at = '2020-01-01'
  where user_id = 'e0560000-0000-4000-8000-000000000001'$$,
  'a client may send its own times');
select ok((select revoked_at > '2026-01-01' and created_at > '2026-01-01' from public.user_health_data_consents
  where user_id = 'e0560000-0000-4000-8000-000000000001'),
  'but the database keeps its own withdrawal and creation times');
select is((select string_agg(granted::text, ',' order by id) from public.user_health_data_consent_events
  where user_id = 'e0560000-0000-4000-8000-000000000001'), 'true,false',
  'the history keeps the order of decisions');
select throws_ok($$insert into public.user_health_data_consent_events(user_id, granted, consent_version)
  values ('e0560000-0000-4000-8000-000000000001', true, 'forged')$$,
  '42501', null, 'the owner cannot insert history directly');

-- PostgREST upsert shape used by the API adapter.
select lives_ok($$insert into public.user_health_data_consents(user_id, granted, consent_version, consented_at, revoked_at, updated_at)
  values ('e0560000-0000-4000-8000-000000000001', true, '2026-10-27', '2020-01-01', null, now())
  on conflict (user_id) do update set granted = excluded.granted, consent_version = excluded.consent_version,
    consented_at = excluded.consented_at, revoked_at = excluded.revoked_at, updated_at = excluded.updated_at
  returning *$$,
  'the owner re-grants through an upsert');
select ok((select granted and consented_at > '2026-01-01' and revoked_at is null from public.user_health_data_consents
  where user_id = 'e0560000-0000-4000-8000-000000000001'),
  'a re-grant gets a database-set consent time');
create temporary table first_grant on commit drop as
  select consented_at from public.user_health_data_consents where user_id = 'e0560000-0000-4000-8000-000000000001';
select lives_ok($$update public.user_health_data_consents set granted = true, consent_version = '2026-10-27'
  where user_id = 'e0560000-0000-4000-8000-000000000001'$$,
  'agreeing again to the same version is accepted');
select is((select consented_at from public.user_health_data_consents where user_id = 'e0560000-0000-4000-8000-000000000001'),
  (select consented_at from first_grant), 'agreeing again keeps the original consent time');

reset role;
set local role service_role;
insert into public.user_health_data_consents(user_id, granted, consent_version, consented_at)
  values ('e0560000-0000-4000-8000-000000000002', true, '2026-10-27', now());
reset role;

set local role authenticated;
set local request.jwt.claim.sub = 'e0560000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.user_health_data_consents), 1,
  'a user sees only their own consent');
select is((select count(*)::int from public.user_health_data_consent_events), 3,
  'a user sees only their own history');
select is_empty($$update public.user_health_data_consents set granted = true, consented_at = now(), revoked_at = null
  where user_id = 'e0560000-0000-4000-8000-000000000002' returning 1$$,
  'a user cannot change another user''s consent');
reset role;

delete from auth.users where id = 'e0560000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.user_health_data_consent_events
  where user_id = 'e0560000-0000-4000-8000-000000000001'), 0,
  'account deletion removes the consent history');

select * from finish();
rollback;
