begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(8);

-- Setup synthetic test user
insert into auth.users (id, email)
values
  ('b0000000-0000-4000-8000-000000000001', 'tester-draft@mizyun.test');

-- 1. Test RPC ai_reserve_draft permits within budget
select results_eq(
  $$select allowed, retry_after from public.ai_reserve_draft(
      'b0000000-0000-4000-8000-000000000001'::uuid,
      current_date,
      5,
      1
    )$$,
  $$values (true, 0)$$,
  'ai_reserve_draft permits first draft within budget 5'
);

-- Commit that draft
select lives_ok(
  $$select public.ai_commit_draft('b0000000-0000-4000-8000-000000000001'::uuid, current_date, 1)$$,
  'ai_commit_draft executes cleanly'
);

-- Reserve remaining 4 drafts
select results_eq(
  $$select allowed from public.ai_reserve_draft(
      'b0000000-0000-4000-8000-000000000001'::uuid,
      current_date,
      5,
      4
    )$$,
  $$values (true)$$,
  'ai_reserve_draft permits remaining 4 drafts up to budget 5'
);

-- 6th draft must be rejected
select results_eq(
  $$select allowed from public.ai_reserve_draft(
      'b0000000-0000-4000-8000-000000000001'::uuid,
      current_date,
      5,
      1
    )$$,
  $$values (false)$$,
  'ai_reserve_draft rejects when budget 5 is exceeded'
);

-- Switch to authenticated user to test beta_pro_requests
set local role authenticated;
set local request.jwt.claim.sub = 'b0000000-0000-4000-8000-000000000001';
set local request.jwt.claim.role = 'authenticated';
set local search_path = public, extensions;

-- Authenticated user can insert request with pending status
select lives_ok(
  $$insert into public.beta_pro_requests (user_id, email, status)
    values ('b0000000-0000-4000-8000-000000000001', 'tester-draft@mizyun.test', 'pending')$$,
  'authenticated user can submit beta pro request with status pending'
);

-- Authenticated user cannot insert request with approved status
select throws_ok(
  $$insert into public.beta_pro_requests (user_id, email, status)
    values ('b0000000-0000-4000-8000-000000000002', 'other@mizyun.test', 'approved')$$,
  '42501',
  NULL,
  'authenticated user cannot insert request with status approved'
);

-- Authenticated user cannot update status
select throws_ok(
  $$update public.beta_pro_requests set status = 'approved' where user_id = 'b0000000-0000-4000-8000-000000000001'$$,
  '42501',
  NULL,
  'authenticated user cannot update beta pro request'
);

-- Switch back to service_role / admin to approve request
set local role service_role;
set local search_path = public, extensions;

-- Admin updates status to approved
update public.beta_pro_requests
   set status = 'approved'
 where user_id = 'b0000000-0000-4000-8000-000000000001';

-- Verify trigger updated profiles.plan_tier to 'paid'
select results_eq(
  $$select plan_tier from public.profiles where id = 'b0000000-0000-4000-8000-000000000001'$$,
  array['paid'],
  'handle_beta_pro_approval trigger automatically upgraded plan_tier to paid'
);

select * from finish();
rollback;
