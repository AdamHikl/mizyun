-- COMM-18: private groups are a separate audience. No diary rows are copied.
begin;
create table public.community_groups (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 created_by uuid references auth.users(id) on delete set null,operation_id uuid not null,
 name text not null check(length(name) between 1 and 60),rules text not null check(length(rules) between 1 and 1000),
 invite_code text,invite_expires_at timestamptz,created_at timestamptz not null default now(),
 unique(created_by,operation_id),unique(invite_code)
);
create index community_groups_user_id on public.community_groups(user_id);
create table public.community_group_members (
 group_id uuid not null references public.community_groups(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
 role text not null default 'member' check(role in ('owner','moderator','member')),
 state text not null check(state in ('member','invited','pending','banned','removed')),generation integer not null,version integer not null default 1,
 joined_at timestamptz,changed_by uuid references auth.users(id) on delete set null,reason text,
 primary key(group_id,user_id)
);
create index community_group_members_user_id on public.community_group_members(user_id);
create unique index community_group_single_owner on public.community_group_members(group_id) where role='owner' and state='member';
create table public.community_group_posts (
 id uuid primary key default gen_random_uuid(),group_id uuid not null references public.community_groups(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,operation_id uuid not null,generation integer not null,
 body text not null check(length(body) between 1 and 1000),created_at timestamptz not null default now(),revoked_at timestamptz,
 unique(user_id,operation_id)
);
create index community_group_posts_user_id on public.community_group_posts(user_id);
create index community_group_posts_page on public.community_group_posts(group_id,created_at desc,id desc) where revoked_at is null;
-- Bounded digest tombstones prevent a lost/stale response from recreating disbanded groups or erased posts.
create table public.community_group_operations (
 user_id uuid not null references auth.users(id) on delete cascade,operation_id uuid not null,
 kind text not null check(kind in ('create','post')),group_id uuid not null,payload_digest text not null,
 membership_version integer,created_at timestamptz not null default now(),primary key(user_id,operation_id)
);
create index community_group_operations_user_id on public.community_group_operations(user_id,created_at);
create table public.community_group_appeals (
 id uuid primary key default gen_random_uuid(),group_id uuid not null references public.community_groups(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,reason text not null check(length(reason) between 1 and 1000),
 issued_by uuid references auth.users(id) on delete set null,membership_version integer not null,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),response text,created_at timestamptz not null default now()
);
create unique index community_group_appeal_pending on public.community_group_appeals(group_id,user_id) where status='pending';
create index community_group_appeals_user_id on public.community_group_appeals(user_id);
create table public.community_group_events (
 id uuid primary key default gen_random_uuid(),group_id uuid references public.community_groups(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,kind text not null,created_at timestamptz not null default now()
);
create index community_group_events_user_id on public.community_group_events(user_id);
-- All mutations use one current-authority RPC; no table write grants.
create function public.community_group_incarnation() returns trigger language plpgsql set search_path='' as $$begin
 if (new.state,new.role,new.generation,new.joined_at) is distinct from (old.state,old.role,old.generation,old.joined_at) then new.version:=old.version+1;end if;return new;
end $$;
create trigger community_group_incarnation before update on public.community_group_members for each row execute function public.community_group_incarnation();
create function public.community_group_member(p_group uuid,p_user uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select public.community_active(p_user) and exists(select 1 from public.community_group_members m join public.community_groups g on g.id=m.group_id
 join public.community_profiles p on p.user_id=m.user_id where m.group_id=p_group and m.user_id=p_user and m.state='member' and m.generation=p.generation
 and public.community_active(g.user_id) and not public.community_blocked_between(p_user,g.user_id))
$$;
create function public.community_group_role(p_group uuid,p_user uuid) returns text language sql volatile security definer set search_path='' as $$
 select role from public.community_group_members where group_id=p_group and user_id=p_user and public.community_group_member(p_group,p_user)
$$;
create function public.community_group_post_visible(p_post uuid,p_user uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select p_user=auth.uid() and exists(select 1 from public.community_group_posts p join public.community_group_members m on m.group_id=p.group_id and m.user_id=p_user
 join public.community_profiles author on author.user_id=p.user_id where p.id=p_post and p.revoked_at is null and p.created_at>now()-interval '365 days'
 and p.created_at>=m.joined_at and public.community_feature_enabled('groups',p_user) and public.community_group_member(p.group_id,p_user)
 and public.community_group_member(p.group_id,p.user_id) and p.generation=author.generation and not public.community_blocked_between(p_user,p.user_id))
$$;
create function public.community_group_summary(p_group uuid,p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',g.id,'name',g.name,'rules',g.rules,'role',m.role,'state',m.state,'membershipVersion',m.version)
 from public.community_groups g join public.community_group_members m on m.group_id=g.id and m.user_id=p_user where g.id=p_group
$$;
create function public.community_group_event(p_group uuid,p_user uuid,p_kind text) returns void language plpgsql security definer set search_path='' as $$begin
 delete from public.community_group_events where user_id=p_user and (created_at<=now()-interval '30 days' or id in(select id from public.community_group_events where user_id=p_user order by created_at desc,id desc offset 99));
 insert into public.community_group_events(group_id,user_id,kind) values(p_group,p_user,p_kind);
end $$;
create function public.community_group_capture_member_receipt(p_group uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$declare owner_id uuid;begin
 select user_id into owner_id from public.community_groups where id=p_group;
 if owner_id is null or owner_id=p_user or not public.community_group_member(p_group,p_user) or not public.community_feature_enabled('groups',p_user) then return;end if;
 insert into public.community_report_receipts(user_id,target_type,target_id,subject_user_id,evidence_snapshot)
 values(p_user,'group',p_group::text,owner_id,public.community_social_snapshot('group',p_group::text));
end $$;
create function public.community_group_recover_owner(p_group uuid,p_old uuid) returns void language plpgsql security definer set search_path='' as $$declare successor uuid;begin
 select m.user_id into successor from public.community_group_members m join public.community_profiles p on p.user_id=m.user_id
 where m.group_id=p_group and m.user_id<>p_old and m.state='member' and m.generation=p.generation and public.community_active(m.user_id) and not public.community_blocked_between(m.user_id,p_old)
 order by (m.role='moderator') desc,m.joined_at,m.user_id limit 1;
 if successor is null then delete from public.community_groups where id=p_group;else
 update public.community_group_members set role='member' where group_id=p_group and role='owner';
 update public.community_groups set user_id=successor,invite_code=null,invite_expires_at=null where id=p_group;
 update public.community_group_members set role='owner' where group_id=p_group and user_id=successor;
 perform public.community_group_event(p_group,successor,'owner_recovered');end if;
end $$;
create function public.community_group_cleanup_user(p_user uuid) returns void language plpgsql security definer set search_path='' as $$declare g uuid;begin
 perform public.community_lock();
 for g in select id from public.community_groups where user_id=p_user loop perform public.community_group_recover_owner(g,p_user);end loop;
 delete from public.community_group_posts where user_id=p_user;
 delete from public.community_group_members where user_id=p_user;
 delete from public.community_group_appeals where user_id=p_user;
 delete from public.community_group_events where user_id=p_user;
end $$;
create function public.community_group_lifecycle() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_table_name='users' then perform public.community_group_cleanup_user(old.id);return old;end if;
 if new.status<>'active' and old.status='active' then perform public.community_group_cleanup_user(new.user_id);end if;return new;
end $$;
create trigger community_groups_auth_cleanup before delete on auth.users for each row execute function public.community_group_lifecycle();
create trigger community_groups_profile_cleanup after update of status on public.community_profiles for each row execute function public.community_group_lifecycle();
create function public.community_groups_rpc(p_operation text,p_args jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();gid uuid;target uuid;g public.community_groups;m public.community_group_members;t public.community_group_members;
 actor text;gen integer;prior public.community_group_operations;digest text;post public.community_group_posts;a public.community_group_appeals;result jsonb;txt text;op uuid;seen record;operator_id uuid;staff_limit integer;
begin
 perform public.community_lock();
 if u is null then raise exception 'community_access_denied';end if;
 -- Privacy reductions/ban appeals remain reachable after groups are frozen.
 if p_operation not in ('leave','disband','deletePost','appeal','inbox','list','staffAppeals','staffResolveAppeal') and (not public.community_active(u) or not public.community_feature_enabled('groups',u)) then raise exception 'community_unavailable';end if;
 if p_operation in ('staffAppeals','staffResolveAppeal') then
 operator_id:=public.community_staff_required();
 if nullif(btrim(p_args->>'reason'),'') is null or length(p_args->>'reason')>500 then raise exception 'community_invalid_action';end if;
 if p_operation='staffAppeals' then
 staff_limit:=coalesce((p_args->>'limit')::integer,20);if staff_limit not between 1 and 20 then raise exception 'community_invalid_action';end if;
 result:='[]';
 for a in select * from public.community_group_appeals ca where ca.status='pending' and ca.user_id<>operator_id and ca.issued_by is distinct from operator_id and (p_args->>'after' is null or ca.id::text>p_args->>'after') order by ca.id::text limit staff_limit loop
 insert into public.community_moderation_actions(target_type,target_id,action,reason,staff_operator) values('group',a.id::text,'inspect',p_args->>'reason',operator_id);
 result:=result||jsonb_build_array(jsonb_build_object('id',a.id,'groupId',a.group_id,'userId',a.user_id,'membershipVersion',a.membership_version,'reason',a.reason,'status',a.status,'response',a.response));end loop;
 return jsonb_build_object('appeals',result,'complete',jsonb_array_length(result)<staff_limit);
 end if;
 select * into a from public.community_group_appeals where id=(p_args->>'appealId')::uuid;
 select * into t from public.community_group_members where group_id=a.group_id and user_id=a.user_id;
 if a.id is null or a.status<>'pending' or a.user_id=operator_id or a.issued_by=operator_id or t.user_id is null or a.membership_version<>t.version or (p_args->>'appealMembershipVersion') is null or (p_args->>'appealMembershipVersion')::integer<>a.membership_version then raise exception 'community_access_denied';end if;
 if coalesce(p_args->>'decision','') not in ('approved','rejected') then raise exception 'community_invalid_action';end if;
 insert into public.community_moderation_actions(target_type,target_id,action,reason,staff_operator) values('group',a.id::text,case when p_args->>'decision'='approved' then 'reverse' else 'dismiss' end,p_args->>'reason',operator_id);
 update public.community_group_appeals set status=p_args->>'decision',response=p_args->>'reason' where id=a.id;
 if p_args->>'decision'='approved' then update public.community_group_members set state='removed',role='member',joined_at=null where group_id=a.group_id and user_id=a.user_id;end if;
 perform public.community_group_event(a.group_id,a.user_id,'appeal_decision');return '{}';
 end if;
 if p_operation='inbox' then
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'groupId',q.group_id,'kind',q.kind,'createdAt',q.created_at)),'[]') into result from
 (select * from public.community_group_events where user_id=u and created_at>now()-interval '30 days' order by created_at desc,id desc limit 100) q;
 return jsonb_build_object('events',result);
 elsif p_operation='list' then
 select coalesce(jsonb_agg(case when public.community_feature_enabled('groups',u) and public.community_group_member(q.group_id,u) then public.community_group_summary(q.group_id,u) else public.community_group_summary(q.group_id,u)||jsonb_build_object('name','Private group','rules','') end),'[]') into result from (select gm.group_id from public.community_group_members gm
 join public.community_groups cg on cg.id=gm.group_id join public.community_profiles cp on cp.user_id=gm.user_id where gm.user_id=u and gm.generation=cp.generation
 order by cg.created_at desc,cg.id limit 50) q;
 return jsonb_build_object('groups',result,'appeals',(select coalesce(jsonb_agg(jsonb_build_object('id',ga.id,'groupId',ga.group_id,'userId',ga.user_id,'membershipVersion',ga.membership_version,'reason',ga.reason,'status',ga.status,'response',ga.response)),'[]') from (select * from public.community_group_appeals own_appeals where own_appeals.user_id=u order by (status='pending') desc,created_at desc,id desc limit 100) ga));
 elsif p_operation='create' then
 op:=(p_args->>'operationId')::uuid;txt:=btrim(p_args->>'name');
 if op is null or txt is null or length(txt) not between 1 and 60 or nullif(btrim(p_args->>'rules'),'') is null or length(btrim(p_args->>'rules')) not between 1 and 1000 or not public.community_text_safe(txt) or not public.community_text_safe(p_args->>'rules') or txt~'[[:cntrl:]]' or (p_args->>'rules')~'[[:cntrl:]]' then raise exception 'community_invalid_action';end if;
 digest:=encode(sha256(convert_to(jsonb_build_object('name',txt,'rules',btrim(p_args->>'rules'))::text,'UTF8')),'hex');
 select * into prior from public.community_group_operations where user_id=u and operation_id=op;
 if prior.user_id is not null and (prior.kind<>'create' or prior.payload_digest<>digest or not exists(select 1 from public.community_groups where id=prior.group_id)) then raise exception 'community_conflict';end if;
 select * into g from public.community_groups where created_by=u and operation_id=op;
 if g.id is not null then
 if g.name<>txt or g.rules<>p_args->>'rules' or not public.community_group_member(g.id,u) then raise exception 'community_conflict';end if;
 return jsonb_build_object('group',public.community_group_summary(g.id,u));end if;
 if (select count(*) from public.community_group_operations where user_id=u)>=10000 then raise exception 'community_rate_limited';end if;
 if (select count(*) from public.community_groups where user_id=u)>=5 or (select count(*) from public.community_group_members where user_id=u)>=50 or (select count(*) from public.community_group_members where user_id=u and state in ('member','pending','invited'))>=10 then raise exception 'community_rate_limited';end if;
 insert into public.community_groups(user_id,created_by,operation_id,name,rules) values(u,u,op,txt,btrim(p_args->>'rules')) returning * into g;
 insert into public.community_group_members(group_id,user_id,role,state,generation,joined_at) select g.id,u,'owner','member',generation,now() from public.community_profiles where user_id=u;
 insert into public.community_group_operations(user_id,operation_id,kind,group_id,payload_digest) values(u,op,'create',g.id,digest);
 return jsonb_build_object('group',public.community_group_summary(g.id,u));
 elsif p_operation='request' then
 select * into g from public.community_groups where invite_code=p_args->>'token' and invite_expires_at>now();
 if g.id is null or not public.community_group_member(g.id,g.user_id) or public.community_blocked_between(u,g.user_id) then raise exception 'community_unavailable';end if;gid:=g.id;
 else gid:=(p_args->>'groupId')::uuid;select * into g from public.community_groups where id=gid;end if;
 if g.id is null then raise exception 'community_unavailable';end if;
 select generation into gen from public.community_profiles where user_id=u;
 select * into m from public.community_group_members where group_id=gid and user_id=u;
 actor:=public.community_group_role(gid,u);
 if p_operation='appeal' then
 if m.user_id is null or m.state not in ('banned','removed') or nullif(btrim(p_args->>'reason'),'') is null or length(p_args->>'reason')>1000 then raise exception 'community_access_denied';end if;
 if (select count(*) from public.community_group_appeals where group_id=gid and user_id=u)>=50 then raise exception 'community_rate_limited';end if;
 insert into public.community_group_appeals(group_id,user_id,issued_by,membership_version,reason) values(gid,u,m.changed_by,m.version,p_args->>'reason') on conflict(group_id,user_id) where status='pending' do nothing;
 perform public.community_group_event(gid,g.user_id,'appeal');return '{}';
 elsif p_operation='leave' then
 if m.user_id is null then return '{}';end if;
 if m.role='owner' and m.state='member' then
 if exists(select 1 from public.community_group_members where group_id=gid and user_id<>u and state='member') then raise exception 'community_conflict';end if;
 delete from public.community_groups where id=gid;return '{}';end if;
 -- Do not remove a ban by leaving and requesting again.
 if m.state<>'banned' then update public.community_group_members set state='removed',joined_at=null where group_id=gid and user_id=u;end if;
 update public.community_group_posts set revoked_at=coalesce(revoked_at,now()) where group_id=gid and user_id=u;return '{}';
 elsif p_operation='deletePost' then
 select * into post from public.community_group_posts where id=(p_args->>'postId')::uuid and group_id=gid;
 if post.id is null then raise exception 'community_unavailable';end if;
 if post.user_id<>u and (not public.community_feature_enabled('groups',u) or coalesce(actor,'') not in ('owner','moderator')) then raise exception 'community_access_denied';end if;
 update public.community_group_posts set revoked_at=coalesce(revoked_at,now()) where id=post.id;return '{}';
 elsif p_operation='disband' then
 if g.user_id<>u then raise exception 'community_access_denied';end if;
 delete from public.community_groups where id=gid;return '{}';
 elsif p_operation='request' then
 if m.state='banned' then raise exception 'community_access_denied';end if;
 if m.generation=gen and m.state in ('member','pending','invited') then return jsonb_build_object('group',public.community_group_summary(gid,u)||case when m.state='member' then '{}'::jsonb else jsonb_build_object('name','Private group','rules','') end);end if;
 if (m.user_id is null and ((select count(*) from public.community_group_members where group_id=gid)>=100 or (select count(*) from public.community_group_members where user_id=u)>=50)) or (select count(*) from public.community_group_members where group_id=gid and state in ('member','pending','invited'))>=30 or (select count(*) from public.community_group_members where user_id=u and state in ('member','pending','invited'))>=10 then raise exception 'community_rate_limited';end if;
 insert into public.community_group_members(group_id,user_id,state,generation) values(gid,u,'pending',gen) on conflict(group_id,user_id) do update set state='pending',role='member',generation=gen,joined_at=null;
 perform public.community_group_event(gid,g.user_id,'join_request');return jsonb_build_object('group',public.community_group_summary(gid,u)||jsonb_build_object('name','Private group','rules',''));
 elsif p_operation='join' then
 if m.user_id is null or m.state<>'invited' or m.generation<>gen or not public.community_group_member(gid,g.user_id) or public.community_blocked_between(u,g.user_id) then raise exception 'community_access_denied';end if;
 if p_args->>'membershipVersion' is null or (p_args->>'membershipVersion')::integer<>m.version then raise exception 'community_conflict';end if;
 update public.community_group_members set state='member',joined_at=now() where group_id=gid and user_id=u;return jsonb_build_object('group',public.community_group_summary(gid,u));
 end if;
 if actor is null then raise exception 'community_access_denied';end if;
 if p_operation not in ('read','deletePost','leave','appeal') and ((p_args->>'membershipVersion') is null or (p_args->>'membershipVersion')::integer<>m.version) then raise exception 'community_conflict';end if;
 if p_operation='read' then
 perform public.community_group_capture_member_receipt(gid,u);
 for seen in select p.id,p.user_id,p.body from public.community_group_posts p where p.group_id=gid and p.user_id<>u and public.community_group_post_visible(p.id,u) order by p.created_at desc,p.id desc limit 50 loop
 insert into public.community_report_receipts(user_id,target_type,target_id,subject_user_id,evidence_snapshot) values(u,'group_post',seen.id::text,seen.user_id,jsonb_build_object('body',seen.body));end loop;
 select coalesce(jsonb_agg(jsonb_build_object('userId',q.user_id,'handle',q.handle,'displayName',q.display_name,'role',q.role,'state',q.state,'membershipVersion',q.version)),'[]') into result from
 (select gm.*,cp.handle,cp.display_name from public.community_group_members gm join public.community_profiles cp on cp.user_id=gm.user_id where gm.group_id=gid
 and gm.generation=cp.generation and public.community_active(gm.user_id) and not public.community_blocked_between(u,gm.user_id)
 and (gm.state='member' or actor in ('owner','moderator')) order by gm.user_id limit 100) q;
 result:=jsonb_build_object('group',public.community_group_summary(gid,u),'members',result);
 return result||jsonb_build_object('posts',(select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'userId',q.user_id,'displayName',q.display_name,'body',q.body,'createdAt',q.created_at)),'[]') from
 (select p.*,cp.display_name from public.community_group_posts p join public.community_profiles cp on cp.user_id=p.user_id where p.group_id=gid and public.community_group_post_visible(p.id,u) order by p.created_at desc,p.id desc limit 50) q),
 'appeals',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'groupId',group_id,'userId',user_id,'membershipVersion',membership_version,'reason',reason,'status',status,'response',response)),'[]') from (select * from public.community_group_appeals group_appeals where group_appeals.group_id=gid and (group_appeals.user_id=u or actor='owner') order by (status='pending') desc,created_at desc,id desc limit 100) current_appeals));
 elsif p_operation='post' then
 txt:=btrim(p_args->>'body');op:=(p_args->>'operationId')::uuid;
 if op is null or txt is null or length(txt) not between 1 and 1000 or not public.community_text_safe(txt) or txt~'[[:cntrl:]]' or p_args->>'acceptedAudience' is distinct from 'true' then raise exception 'community_invalid_action';end if;
 digest:=encode(sha256(convert_to(jsonb_build_object('groupId',gid,'body',txt,'generation',gen)::text,'UTF8')),'hex');
 select * into prior from public.community_group_operations where user_id=u and operation_id=op;
 if prior.user_id is not null and (prior.kind<>'post' or prior.payload_digest<>digest or prior.membership_version<>m.version or not exists(select 1 from public.community_group_posts where user_id=u and operation_id=op and revoked_at is null)) then raise exception 'community_conflict';end if;
 select * into post from public.community_group_posts where user_id=u and operation_id=op;
 if post.id is not null then
 if post.group_id<>gid or post.body<>txt or post.generation<>gen or post.revoked_at is not null then raise exception 'community_conflict';end if;return '{}';end if;
 if (select count(*) from public.community_group_operations where user_id=u)>=10000 or (select count(*) from public.community_group_posts where group_id=gid)>=500 or (select count(*) from public.community_group_operations where user_id=u and kind='post' and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')>=20 then raise exception 'community_rate_limited';end if;
 insert into public.community_group_posts(group_id,user_id,operation_id,generation,body) values(gid,u,op,gen,txt);
 insert into public.community_group_operations(user_id,operation_id,kind,group_id,payload_digest,membership_version) values(u,op,'post',gid,digest,m.version);return '{}';
 end if;
 if actor not in ('owner','moderator') then raise exception 'community_access_denied';end if;
 if p_operation='code' then
 update public.community_groups set invite_code=encode(extensions.gen_random_bytes(16),'hex'),invite_expires_at=now()+interval '7 days' where id=gid returning * into g;
 return jsonb_build_object('inviteCode',g.invite_code);
 elsif p_operation='rules' then
 if actor<>'owner' or nullif(btrim(p_args->>'rules'),'') is null or length(p_args->>'rules')>1000 or not public.community_text_safe(p_args->>'rules') or (p_args->>'rules')~'[[:cntrl:]]' then raise exception 'community_invalid_action';end if;
 update public.community_groups set rules=btrim(p_args->>'rules') where id=gid;return '{}';
 elsif p_operation='resolveAppeal' then
 if actor<>'owner' then raise exception 'community_access_denied';end if;
 select * into a from public.community_group_appeals where id=(p_args->>'appealId')::uuid and group_id=gid and status='pending';
 select * into t from public.community_group_members where group_id=gid and user_id=a.user_id;
 if a.id is null or a.issued_by=u or a.user_id=u or a.membership_version<>t.version or (p_args->>'appealMembershipVersion') is null or (p_args->>'appealMembershipVersion')::integer<>a.membership_version or coalesce(p_args->>'decision','') not in ('approved','rejected') or nullif(btrim(p_args->>'reason'),'') is null or length(p_args->>'reason')>500 then raise exception 'community_access_denied';end if;
 update public.community_group_appeals set status=p_args->>'decision',response=p_args->>'reason' where id=a.id;
 if p_args->>'decision'='approved' then update public.community_group_members set state='removed',role='member',joined_at=null where group_id=gid and user_id=a.user_id;end if;
 perform public.community_group_event(gid,a.user_id,'appeal_decision');return '{}';
 end if;
 target:=(p_args->>'targetUserId')::uuid;
 if target is null or target=u or public.community_blocked_between(u,target) then raise exception 'community_access_denied';end if;
 select * into t from public.community_group_members where group_id=gid and user_id=target;
 if p_operation='invite' then
 if not public.community_active(target) or not exists(select 1 from public.community_relationships where follower_user_id=u and target_user_id=target and status='approved') then raise exception 'community_unavailable';end if;
 if t.state='banned' then raise exception 'community_access_denied';end if;
 if t.generation=(select generation from public.community_profiles where user_id=target) and t.state in ('member','invited') then return '{}';end if;
 if (t.user_id is null and ((select count(*) from public.community_group_members where group_id=gid)>=100 or (select count(*) from public.community_group_members where user_id=target)>=50)) or (select count(*) from public.community_group_members where group_id=gid and state in ('member','pending','invited'))>=30 or (select count(*) from public.community_group_members where user_id=target and state in ('member','pending','invited'))>=10 then raise exception 'community_rate_limited';end if;
 insert into public.community_group_members(group_id,user_id,state,generation,changed_by) select gid,target,'invited',generation,u from public.community_profiles where user_id=target
 on conflict(group_id,user_id) do update set state='invited',role='member',generation=excluded.generation,joined_at=null,changed_by=u;
 perform public.community_group_event(gid,target,'invitation');return '{}';
 end if;
 if t.user_id is null then raise exception 'community_unavailable';end if;
 if p_args->>'targetMembershipVersion' is null or (p_args->>'targetMembershipVersion')::integer<>t.version then raise exception 'community_conflict';end if;
 if p_operation='transfer' then
 if actor<>'owner' or not public.community_group_member(gid,target) then raise exception 'community_access_denied';end if;
 update public.community_group_members set role='member' where group_id=gid and user_id=u;
 update public.community_group_members set role='owner' where group_id=gid and user_id=target;
 update public.community_groups set user_id=target,invite_code=null,invite_expires_at=null where id=gid;perform public.community_group_event(gid,target,'owner_transfer');return '{}';
 elsif p_operation='role' then
 if actor<>'owner' or t.role='owner' or t.state<>'member' or coalesce(p_args->>'role','') not in ('moderator','member') then raise exception 'community_access_denied';end if;
 update public.community_group_members set role=p_args->>'role' where group_id=gid and user_id=target;return '{}';
 end if;
 if t.role='owner' or (actor='moderator' and t.role<>'member') then raise exception 'community_access_denied';end if;
 if p_operation='approve' then
 if t.state<>'pending' or not public.community_active(target) or t.generation<>(select generation from public.community_profiles where user_id=target) then raise exception 'community_conflict';end if;
 update public.community_group_members set state='member',joined_at=now(),changed_by=u where group_id=gid and user_id=target;
 elsif p_operation in ('remove','ban','unban') then
 if p_operation='unban' and (actor<>'owner' or t.state<>'banned') then raise exception 'community_access_denied';end if;
 if p_operation='ban' and (nullif(btrim(p_args->>'reason'),'') is null or length(p_args->>'reason')>500) then raise exception 'community_invalid_action';end if;
 perform public.community_group_capture_member_receipt(gid,target);
 update public.community_group_appeals set status='rejected',response='Membership action changed; submit a fresh appeal.' where group_id=gid and user_id=target and status='pending';
 update public.community_group_members set state=case when p_operation='ban' then 'banned' else 'removed' end,role='member',joined_at=null,changed_by=u,reason=case when p_operation='ban' then p_args->>'reason' end where group_id=gid and user_id=target;
 update public.community_group_posts set revoked_at=coalesce(revoked_at,now()) where group_id=gid and user_id=target;
 else raise exception 'community_invalid_action';end if;
 perform public.community_group_event(gid,target,'membership_changed');return '{}';
end $$;
-- RLS covers direct reads too. Invite codes have no raw client SELECT grant.
alter table public.community_groups enable row level security;
alter table public.community_group_members enable row level security;
alter table public.community_group_posts enable row level security;
alter table public.community_group_appeals enable row level security;
alter table public.community_group_events enable row level security;
alter table public.community_group_operations enable row level security;
revoke all on public.community_groups,public.community_group_members,public.community_group_posts,public.community_group_appeals,public.community_group_events,public.community_group_operations from public,anon,authenticated;
grant all on public.community_groups,public.community_group_members,public.community_group_posts,public.community_group_appeals,public.community_group_events,public.community_group_operations to service_role;
grant select on public.community_group_posts to authenticated;
create policy community_group_post_read on public.community_group_posts for select to authenticated using(public.community_group_post_visible(id,(select auth.uid())));
do $$declare f record;begin for f in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname like 'community_group%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
 if f.proname in ('community_groups_rpc','community_group_post_visible') then execute format('grant execute on function %s to authenticated',f.signature);end if;
 end loop;end $$;
-- Extend public safety/lifecycle ports without losing preceding modules.
alter function public.community_social_snapshot(text,text) rename to community_social_snapshot_before_groups;
create function public.community_social_snapshot(p_type text,p_id text) returns jsonb language sql stable security definer set search_path='' as $$
 select case when p_type='group' then (select jsonb_build_object('name',name,'rules',rules) from public.community_groups where id::text=p_id)
 when p_type='group_post' then (select jsonb_build_object('body',body) from public.community_group_posts where id::text=p_id)
 else public.community_social_snapshot_before_groups(p_type,p_id) end
$$;
alter function public.community_issue_report_receipt(text,text) rename to community_issue_report_receipt_before_groups;
create function public.community_issue_report_receipt(p_target_type text,p_target_id text) returns table(id uuid) language plpgsql security definer set search_path='' as $$
declare subject uuid; snap jsonb; found_id uuid;
begin
 if p_target_type not in ('group','group_post') then return query select * from public.community_issue_report_receipt_before_groups(p_target_type,p_target_id);return;end if;
 perform public.community_lock();
 if p_target_type='group' then select g.user_id into subject from public.community_groups g where g.id::text=p_target_id and public.community_group_member(g.id,auth.uid()) and public.community_feature_enabled('groups',auth.uid());
 else select p.user_id into subject from public.community_group_posts p where p.id::text=p_target_id and public.community_group_post_visible(p.id,auth.uid());end if;
 if subject is null or subject=auth.uid() then raise exception 'community_unavailable';end if;
 snap:=public.community_social_snapshot(p_target_type,p_target_id);
 select r.id into found_id from public.community_report_receipts r where r.user_id=auth.uid() and r.target_type=p_target_type and r.target_id=p_target_id and r.subject_user_id=subject and r.evidence_snapshot=snap and r.expires_at>now() order by r.created_at desc limit 1;
 if found_id is null then insert into public.community_report_receipts(user_id,target_type,target_id,subject_user_id,evidence_snapshot) values(auth.uid(),p_target_type,p_target_id,subject,snap) returning community_report_receipts.id into found_id;end if;
 if found_id is null then raise exception 'community_rate_limited';end if;return query select found_id;
end $$;
alter function public.community_submit_report(text,text,text,text,uuid) rename to community_submit_report_before_groups;
create function public.community_submit_report(p_target_type text,p_target_id text,p_reason text,p_notes text default null,p_interaction_receipt_id uuid default null) returns setof public.community_reports language plpgsql security definer set search_path='' as $$
declare receipt public.community_report_receipts;r public.community_reports;rid uuid;n integer;
begin
 if p_target_type not in ('group','group_post') then return query select * from public.community_submit_report_before_groups(p_target_type,p_target_id,p_reason,p_notes,p_interaction_receipt_id);return;end if;
 perform public.community_lock();
 if auth.uid() is null then raise exception 'community_access_denied';end if;
 if p_reason is null or p_reason not in ('harassment','offensive_content','impersonation','spam','unsafe_or_sexual_content','other') or length(p_notes)>1000 then raise exception 'community_invalid_action';end if;
 select * into receipt from public.community_report_receipts where user_id=auth.uid() and target_type=p_target_type and target_id=p_target_id and expires_at>now() and (p_interaction_receipt_id is null or id=p_interaction_receipt_id) order by created_at desc limit 1;
 if receipt.id is null then
 if p_interaction_receipt_id is not null then raise exception 'community_unavailable';end if;
 select id into rid from public.community_issue_report_receipt(p_target_type,p_target_id);select * into receipt from public.community_report_receipts where id=rid;end if;
 select * into r from public.community_reports where reporter_user_id=auth.uid() and target_type=p_target_type and target_id=p_target_id and reason=p_reason and status in ('submitted','under_review') order by created_at limit 1;
 if r.id is null then
 insert into public.community_report_usage(user_id,report_date,report_count) values(auth.uid(),(now() at time zone 'UTC')::date,1) on conflict(user_id,report_date) do update set report_count=community_report_usage.report_count+1 where community_report_usage.report_count<10 returning report_count into n;
 if n is null then raise exception 'community_rate_limited';end if;
 insert into public.community_reports(reporter_user_id,target_type,target_id,reason,notes,priority,subject_user_id,evidence_snapshot) values(auth.uid(),p_target_type,p_target_id,p_reason,p_notes,case when p_reason in ('harassment','unsafe_or_sexual_content') then 'urgent' else 'normal' end,receipt.subject_user_id,receipt.evidence_snapshot) returning * into r;
 end if;
 r.subject_user_id:=null;r.evidence_snapshot:='{}';r.staff_notes:=null;r.assigned_to:=null;return next r;
end $$;
alter function public.community_apply_moderation_action(uuid,text,text,text,integer) rename to community_apply_moderation_action_before_groups;
create function public.community_apply_moderation_action(p_report_id uuid,p_decision text,p_decision_reason text,p_staff_notes text default null,p_suspension_duration_days integer default null) returns setof public.community_reports language plpgsql security definer set search_path='' as $$
declare r public.community_reports;operator uuid;
begin
 perform public.community_lock();select * into r from public.community_reports where id=p_report_id;
 if r.target_type not in ('group','group_post') or p_decision is distinct from 'remove' then return query select * from public.community_apply_moderation_action_before_groups(p_report_id,p_decision,p_decision_reason,p_staff_notes,p_suspension_duration_days);return;end if;
 operator:=public.community_staff_required();
 if r.status not in ('submitted','under_review') or (r.assigned_to is not null and r.assigned_to<>operator::text) then raise exception 'community_conflict';end if;
 if operator=r.subject_user_id or operator=r.reporter_user_id then raise exception 'community_access_denied';end if;
 if nullif(btrim(p_decision_reason),'') is null or length(p_decision_reason)>500 or length(p_staff_notes)>1000 then raise exception 'community_invalid_action';end if;
 if r.target_type='group' then delete from public.community_groups where id::text=r.target_id;else update public.community_group_posts set revoked_at=coalesce(revoked_at,now()) where id::text=r.target_id;end if;
 insert into public.community_moderation_actions(report_id,target_type,target_id,action,reason,staff_operator,staff_notes) values(r.id,r.target_type,r.target_id,'remove',p_decision_reason,operator,p_staff_notes);
 return query update public.community_reports set status='resolved',decision='remove',decision_reason=p_decision_reason,staff_notes=p_staff_notes,assigned_to=operator::text,action_taken_at=now(),updated_at=now() where id=r.id returning *;
end $$;
alter function public.community_export_page(text,text,integer) rename to community_export_page_before_groups;
create function public.community_export_page(p_category text,p_after text default null,p_limit integer default 500) returns table(item_key text,item jsonb) language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null then raise exception 'community_access_denied';end if;
 if p_limit is null or p_limit<1 or p_limit>500 then raise exception 'community_conflict';end if;
 if p_category='groupMemberships' then return query select q.k,to_jsonb(q)-'k' from (select group_id::text k,group_id,role,state,generation,joined_at,reason from public.community_group_members where user_id=auth.uid() and (p_after is null or group_id::text>p_after) order by group_id::text limit p_limit) q;
 elsif p_category='groupPosts' then return query select q.k,to_jsonb(q)-'k' from (select id::text k,id,group_id,body,created_at,revoked_at from public.community_group_posts where user_id=auth.uid() and (p_after is null or id::text>p_after) order by id::text limit p_limit) q;
 elsif p_category='groupAppeals' then return query select q.k,to_jsonb(q)-'k' from (select id::text k,id,group_id,reason,status,response,created_at from public.community_group_appeals where user_id=auth.uid() and (p_after is null or id::text>p_after) order by id::text limit p_limit) q;
 elsif p_category='groupOperations' then return query select q.k,to_jsonb(q)-'k' from (select operation_id::text k,operation_id,kind,group_id,created_at from public.community_group_operations where user_id=auth.uid() and (p_after is null or operation_id::text>p_after) order by operation_id::text limit p_limit) q;
 elsif p_category='groupEvents' then return query select q.k,to_jsonb(q)-'k' from (select id::text k,id,group_id,kind,created_at from public.community_group_events where user_id=auth.uid() and (p_after is null or id::text>p_after) order by id::text limit p_limit) q;
 else return query select * from public.community_export_page_before_groups(p_category,p_after,p_limit);end if;
end $$;
alter function public.community_retention_batch(integer) rename to community_retention_batch_before_groups;
create function public.community_retention_batch(p_limit integer default 500) returns table(deleted_count integer) language plpgsql security definer set search_path='' as $$declare n integer;c integer;begin
 select b.deleted_count into n from public.community_retention_batch_before_groups(p_limit) b;
 delete from public.community_group_posts where ctid in(select ctid from public.community_group_posts where revoked_at<=now()-interval '30 days' or created_at<=now()-interval '365 days' limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_group_events where ctid in(select ctid from public.community_group_events where created_at<=now()-interval '30 days' limit p_limit);get diagnostics c=row_count;n:=n+c;
 delete from public.community_group_appeals where ctid in(select ctid from public.community_group_appeals where status<>'pending' and created_at<=now()-interval '180 days' limit p_limit);get diagnostics c=row_count;n:=n+c;
 return query select n;
end $$;
revoke all on function public.community_social_snapshot_before_groups(text,text),public.community_social_snapshot(text,text),public.community_issue_report_receipt_before_groups(text,text),public.community_submit_report_before_groups(text,text,text,text,uuid),public.community_apply_moderation_action_before_groups(uuid,text,text,text,integer),public.community_export_page_before_groups(text,text,integer),public.community_retention_batch_before_groups(integer) from public,anon,authenticated,service_role;
revoke all on function public.community_issue_report_receipt(text,text),public.community_submit_report(text,text,text,text,uuid),public.community_apply_moderation_action(uuid,text,text,text,integer),public.community_export_page(text,text,integer),public.community_retention_batch(integer) from public,anon,authenticated,service_role;
grant execute on function public.community_issue_report_receipt(text,text),public.community_submit_report(text,text,text,text,uuid),public.community_apply_moderation_action(uuid,text,text,text,integer),public.community_export_page(text,text,integer) to authenticated;
grant execute on function public.community_retention_batch(integer) to service_role;
commit;
