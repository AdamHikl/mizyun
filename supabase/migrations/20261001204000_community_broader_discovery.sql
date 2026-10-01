begin;
create table public.community_broader_discovery_preferences(user_id uuid primary key references auth.users(id) on delete cascade,enabled boolean not null default false,generation integer not null);
create table public.community_broader_discovery_usage(user_id uuid not null references auth.users(id) on delete cascade,usage_day date not null default current_date,count integer not null default 0 check(count between 0 and 30),last_at timestamptz,primary key(user_id,usage_day));
do $$declare t text;begin foreach t in array array['community_broader_discovery_preferences','community_broader_discovery_usage'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;
create function public.community_broader_discovery_rpc(p_operation text,p_args jsonb default '{}') returns table(result jsonb) language plpgsql volatile security definer set search_path='' as $$declare u uuid:=auth.uid();gen integer;pref public.community_broader_discovery_preferences;term text;begin
 perform public.community_lock();if u is null then raise exception 'community_access_denied';end if;
 select generation into gen from public.community_profiles where user_id=u;if gen is null then raise exception 'community_unavailable';end if;
 if p_operation='preferences' then
 if p_args ? 'enabled' and (p_args->>'enabled')::boolean and not public.community_feature_enabled('discovery',u) then raise exception 'community_unavailable';end if;
 insert into public.community_broader_discovery_preferences(user_id,generation) values(u,gen) on conflict do nothing;
 update public.community_broader_discovery_preferences set enabled=case when p_args ? 'enabled' then (p_args->>'enabled')::boolean else enabled and generation=gen end,generation=gen where user_id=u returning * into pref;return query select jsonb_build_object('enabled',pref.enabled);return;
 end if;
 if p_operation<>'search' or not public.community_feature_enabled('discovery',u) then raise exception 'community_unavailable';end if;
 term:=lower(btrim(p_args->>'prefix'));if term is null or char_length(term) not between 3 and 24 or term !~ '^[a-z0-9_]+$' then raise exception 'community_invalid_input';end if;
 if exists(select 1 from public.community_broader_discovery_usage where user_id=u and usage_day=current_date and(count>=30 or last_at>now()-interval '10 seconds')) then raise exception 'community_rate_limited';end if;
 insert into public.community_broader_discovery_usage(user_id,usage_day,count,last_at) values(u,current_date,1,now()) on conflict(user_id,usage_day) do update set count=community_broader_discovery_usage.count+1,last_at=now();
 -- No total counts, private bios, relationship graph or historical cards. Query terms are never persisted.
 return query select jsonb_build_object('profiles',coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'handle',handle,'displayName',display_name,'avatarSymbol',avatar_symbol)),'[]')) from (
 select p.user_id,p.handle,p.display_name,p.avatar_symbol from public.community_profiles p join public.community_broader_discovery_preferences d using(user_id) where p.user_id<>u and p.is_searchable and d.enabled and d.generation=p.generation and public.community_feature_enabled('discovery',p.user_id) and left(p.handle,char_length(term))=term and not exists(select 1 from public.community_blocks where(blocker_user_id=u and blocked_user_id=p.user_id)or(blocker_user_id=p.user_id and blocked_user_id=u)) order by p.handle,p.user_id limit 10) t;
end $$;
create function public.community_broader_discovery_withdraw() returns trigger language plpgsql security definer set search_path='' as $$begin if old.status='active' and new.status<>'active' then delete from public.community_broader_discovery_preferences where user_id=new.user_id;delete from public.community_broader_discovery_usage where user_id=new.user_id;end if;return new;end $$;
create trigger community_broader_discovery_withdraw after update of status on public.community_profiles for each row execute function public.community_broader_discovery_withdraw();
alter function public.community_export_page(text,text,integer) rename to community_export_page_before_broader_discovery;
create function public.community_export_page(p_category text,p_after text default null,p_limit integer default 500) returns table(item_key text,item jsonb) language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or p_limit is null or p_limit not between 1 and 500 then raise exception 'community_access_denied';end if;
 if p_category='broaderDiscoveryPreferences' then return query select user_id::text,jsonb_build_object('enabled',enabled) from public.community_broader_discovery_preferences where user_id=auth.uid() and(p_after is null or user_id::text>p_after) limit p_limit;
 else return query select * from public.community_export_page_before_broader_discovery(p_category,p_after,p_limit);end if;end $$;
revoke all on function public.community_broader_discovery_rpc(text,jsonb),public.community_broader_discovery_withdraw(),public.community_export_page(text,text,integer),public.community_export_page_before_broader_discovery(text,text,integer) from public,anon,authenticated;
grant execute on function public.community_broader_discovery_rpc(text,jsonb),public.community_export_page(text,text,integer) to authenticated;
commit;
