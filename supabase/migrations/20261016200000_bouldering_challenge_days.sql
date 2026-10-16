-- BOULDER-001 BLD-06 / ADR-0066: a completed bouldering session counts as a
-- workout day in cooperative challenges. Workout cards and routine shares of a
-- bouldering session stay blocked; the challenge metric is unchanged (days).
create or replace function public.boulder_child_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare workout_id uuid; is_session boolean;
begin
 if tg_table_name='workout_sets' then workout_id:=new.workout_id; else workout_id:=new.source_workout_id; end if;
 is_session:=exists(select 1 from public.workouts where id=workout_id and (details->>'activityType'='bouldering' or details ? 'boulderSession'));
 if tg_table_name='shared_activities' then
  if new.activity_kind='bouldering' then
   -- During erasure/session cascades the source row may already be gone.
   if tg_op='INSERT' and not is_session then raise exception 'boulder_invalid' using errcode='22023'; end if;
   return new;
  end if;
 end if;
 if tg_table_name='community_challenge_contributions' and is_session then
  if new.kind='workout' and exists(select 1 from public.workouts where id=workout_id and user_id=new.user_id and completed_at is not null) then return new; end if;
  raise exception 'boulder_invalid' using errcode='22023';
 end if;
 if is_session then raise exception 'boulder_invalid' using errcode='22023'; end if;
 return new;
end; $$;
revoke all on function public.boulder_child_guard() from public,anon,authenticated,service_role;
