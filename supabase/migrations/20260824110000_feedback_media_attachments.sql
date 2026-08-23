-- Feedback screenshot & photo attachments (FEEDBACK-002)
--
-- 1. Extend media_assets purpose check constraint to allow 'feedback'.
-- 2. Add media_asset_ids array column to public.user_feedback.

alter table public.media_assets drop constraint if exists media_assets_purpose_check;
alter table public.media_assets add constraint media_assets_purpose_check
  check (purpose in ('food', 'progress', 'workout', 'profile', 'feedback'));

alter table public.user_feedback
  add column if not exists media_asset_ids uuid[] not null default '{}'::uuid[];
