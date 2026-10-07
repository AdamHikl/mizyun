-- Stable public authorship for already-authorized routine/image projections.
-- The existing RPC predicates still authorize every read; these helpers stay internal.
begin;

create or replace function public.community_routine_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'authorHandle',p.handle,'authorUserId',r.user_id,'version',r.version,'isOwner',r.user_id=auth.uid(),'available',public.community_can_view_routine(r.id),'createdAt',r.created_at,'snapshot',r.snapshot)
 from public.community_routine_shares r join public.community_profiles p on p.user_id=r.user_id where r.id=p_id
$$;

create or replace function public.community_media_dto(p_id uuid) returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('id',a.id,'authorHandle',p.handle,'authorUserId',a.user_id,'altText',a.alt_text,'state',a.state,'width',a.width,'height',a.height,'isOwner',a.user_id=auth.uid(),'createdAt',a.created_at) from public.community_media_assets a join public.community_profiles p on p.user_id=a.user_id where a.id=p_id $$;

commit;
