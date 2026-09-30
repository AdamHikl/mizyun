-- Preserve ordinary cooldowns without recreating Auth FK children during erasure.
-- A parent Auth row is already absent when its cascading edge deletion fires.
begin;
create or replace function public.community_capture_follow_cooldown() returns trigger
language plpgsql security definer set search_path = '' as $$
declare edge public.community_relationships;
begin
 if tg_op = 'DELETE' then edge := old; else edge := new; end if;
 if edge.status in ('declined','canceled') and edge.updated_at + interval '48 hours' > now()
 and exists(select 1 from auth.users where id = edge.follower_user_id)
 and exists(select 1 from auth.users where id = edge.target_user_id) then
  insert into public.community_follow_cooldowns(user_id,target_user_id,expires_at)
  values(edge.follower_user_id,edge.target_user_id,edge.updated_at + interval '48 hours')
  on conflict(user_id,target_user_id) do update set expires_at = greatest(community_follow_cooldowns.expires_at,excluded.expires_at);
 end if;
 return null;
end $$;
revoke all on function public.community_capture_follow_cooldown() from public,anon,authenticated;
commit;
