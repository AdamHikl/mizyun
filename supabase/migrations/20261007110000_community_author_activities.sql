begin;

-- Addressable profiles expose the same current publication audience as a card.
-- Constrain the author before paging; never filter a loaded global feed page.
-- The API returns at most50; one extra internal row establishes continuation.
create function public.community_author_activities(
 p_author_user_id uuid,p_limit integer,p_before_time timestamptz,p_before_id uuid
) returns setof public.shared_activities
language plpgsql volatile security definer set search_path='' as $$
declare a public.shared_activities;
begin
 if not public.community_active(auth.uid()) then return; end if;
 for a in
 select s.* from public.shared_activities s
 where s.user_id=p_author_user_id and s.revoked_at is null
 and s.published_at>now()-interval '365 days'
 and public.community_can_view_card(s.id)
 and not exists(select 1 from public.community_mutes m where m.user_id=auth.uid() and m.target_user_id=s.user_id)
 and (p_before_time is null or (s.published_at,s.id)<(p_before_time,p_before_id))
 order by s.published_at desc,s.id desc
 limit greatest(1,least(coalesce(p_limit,20),51)) loop
 -- The profile timeline has no private-source management context, even for self.
 a.source_workout_id:='00000000-0000-0000-0000-000000000000';
 return next a;
 end loop;
end $$;
revoke all on function public.community_author_activities(uuid,integer,timestamptz,uuid) from public,anon;
grant execute on function public.community_author_activities(uuid,integer,timestamptz,uuid) to authenticated,service_role;
commit;
