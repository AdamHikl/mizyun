-- User reviews and feedback (FEEDBACK-001)
--
-- Authenticated users can submit feedback (what they like, what they dislike,
-- ideas / requested changes, bug reports, and general reviews with optional rating).
-- Row Level Security enforces that users can only select, insert, and delete their own feedback.

create table public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('like', 'dislike', 'change', 'bug', 'general')),
  rating smallint check (rating between 1 and 5),
  message text not null check (char_length(trim(message)) >= 1 and char_length(message) <= 4000),
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index user_feedback_user_id_idx on public.user_feedback(user_id, created_at desc);

alter table public.user_feedback enable row level security;

create policy user_feedback_own_all on public.user_feedback
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, delete on public.user_feedback to authenticated;
