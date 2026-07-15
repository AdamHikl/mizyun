-- Supabase no longer auto-exposes new public tables to Data API roles.
-- Expose only user-facing tables; internal provider references stay server-only.
grant select, insert, update, delete on table
  public.profiles,
  public.goals,
  public.body_measurements,
  public.food_entries,
  public.exercises,
  public.workouts,
  public.workout_sets,
  public.conversations,
  public.messages,
  public.memory_items,
  public.media_assets
to authenticated;

revoke all privileges on table public.memory_provider_refs
from anon, authenticated;
