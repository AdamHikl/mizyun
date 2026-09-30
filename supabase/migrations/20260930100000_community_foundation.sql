-- 20260930100000_community_foundation.sql
-- Community Foundation: Isolated social data boundary, directional follow relationships,
-- bilateral blocking, snapshot publications, encouragement reactions, reports, and invitations.
-- Work Package: COMM-02 (Parent #137, ADR-0030)

set check_function_bodies = off;

-- 1. Community Profiles (Opt-in social identity decoupled from private profiles)
create table if not exists public.community_profiles (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  handle           text not null,
  display_name     text not null,
  avatar_symbol    text not null default 'MZ',
  bio              text null,
  is_searchable    boolean not null default true,
  status           text not null default 'active' check (status in ('active', 'withdrawn', 'suspended')),
  generation       integer not null default 1 check (generation >= 1),
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now()),
  constraint community_profiles_handle_unique unique (handle),
  constraint community_profiles_handle_format check (handle ~ '^[a-z0-9_]{3,24}$'),
  constraint community_profiles_display_name_len check (char_length(display_name) between 1 and 32),
  constraint community_profiles_avatar_symbol_len check (char_length(avatar_symbol) between 1 and 4),
  constraint community_profiles_bio_len check (bio is null or char_length(bio) <= 160)
);

create index if not exists idx_community_profiles_user_id on public.community_profiles(user_id);
create index if not exists idx_community_profiles_handle on public.community_profiles(handle);
create index if not exists idx_community_profiles_search on public.community_profiles(handle)
  where is_searchable = true and status = 'active';

alter table public.community_profiles enable row level security;

-- 2. Relationships (Directional follows with explicit recipient approvals)
create table if not exists public.community_relationships (
  id               uuid primary key default gen_random_uuid(),
  follower_user_id uuid not null references auth.users(id) on delete cascade,
  target_user_id   uuid not null references auth.users(id) on delete cascade,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'canceled')),
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now()),
  constraint community_relationships_no_self check (follower_user_id <> target_user_id),
  constraint community_relationships_unique_pair unique (follower_user_id, target_user_id)
);

create index if not exists idx_community_relationships_follower on public.community_relationships(follower_user_id, status);
create index if not exists idx_community_relationships_target on public.community_relationships(target_user_id, status);

alter table public.community_relationships enable row level security;

-- 3. Blocks (Bilateral safety boundary)
create table if not exists public.community_blocks (
  id              uuid primary key default gen_random_uuid(),
  blocker_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at      timestamptz not null default timezone('utc', now()),
  constraint community_blocks_no_self check (blocker_user_id <> blocked_user_id),
  constraint community_blocks_unique_pair unique (blocker_user_id, blocked_user_id)
);

create index if not exists idx_community_blocks_blocker on public.community_blocks(blocker_user_id);
create index if not exists idx_community_blocks_blocked on public.community_blocks(blocked_user_id);
create index if not exists idx_community_blocks_lookup on public.community_blocks(blocker_user_id, blocked_user_id);

alter table public.community_blocks enable row level security;

-- 4. Shared Activities (Field-limited snapshot projections of completed workouts)
create table if not exists public.shared_activities (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  source_workout_id uuid not null references public.workouts(id) on delete cascade,
  category          text not null default 'other' check (category in ('strength', 'running', 'cycling', 'hiit', 'mobility', 'walking', 'other')),
  shared_day        text not null check (shared_day ~ '^\d{4}-\d{2}-\d{2}$'),
  duration_seconds  integer null check (duration_seconds is null or duration_seconds >= 0),
  version           integer not null default 1 check (version >= 1),
  published_at      timestamptz not null default timezone('utc', now()),
  revoked_at        timestamptz null
);

create index if not exists idx_shared_activities_user_id on public.shared_activities(user_id);
create index if not exists idx_shared_activities_source_workout on public.shared_activities(source_workout_id);
create index if not exists idx_shared_activities_feed on public.shared_activities(published_at desc)
  where revoked_at is null;

alter table public.shared_activities enable row level security;

-- 5. Reactions (Predefined supportive encouragement reactions)
create table if not exists public.community_reactions (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.shared_activities(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  reaction    text not null check (reaction in ('clap', 'fire', 'high_five', 'fist_bump', 'thumbs_up')),
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now()),
  constraint community_reactions_unique_activity_user unique (activity_id, user_id)
);

create index if not exists idx_community_reactions_activity on public.community_reactions(activity_id);
create index if not exists idx_community_reactions_user on public.community_reactions(user_id);

alter table public.community_reactions enable row level security;

-- 6. Reports (Content filtering and abuse moderation queue)
create table if not exists public.community_reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  target_type      text not null check (target_type in ('profile', 'activity')),
  target_id        text not null,
  reason           text not null check (reason in ('harassment', 'offensive_content', 'impersonation', 'spam', 'other')),
  notes            text null check (notes is null or char_length(notes) <= 500),
  status           text not null default 'submitted' check (status in ('submitted', 'under_review', 'resolved', 'dismissed')),
  created_at       timestamptz not null default timezone('utc', now()),
  updated_at       timestamptz not null default timezone('utc', now())
);

create index if not exists idx_community_reports_reporter on public.community_reports(reporter_user_id);
create index if not exists idx_community_reports_status on public.community_reports(status);

alter table public.community_reports enable row level security;

-- 7. Invitations (Revocable, expiring invite tokens)
create table if not exists public.community_invitations (
  id              uuid primary key default gen_random_uuid(),
  token           text not null unique,
  inviter_user_id uuid not null references auth.users(id) on delete cascade,
  expires_at      timestamptz not null default timezone('utc', now() + interval '7 days'),
  revoked_at      timestamptz null,
  created_at      timestamptz not null default timezone('utc', now())
);

create index if not exists idx_community_invitations_token on public.community_invitations(token);
create index if not exists idx_community_invitations_inviter on public.community_invitations(inviter_user_id);

alter table public.community_invitations enable row level security;

-- ============================================================================
-- Security Definer Triggers
-- ============================================================================

-- Bilateral block trigger: automatically sever follow edges in both directions
create or replace function public.handle_community_block_inserted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Delete relationships in both directions
  delete from public.community_relationships
   where (follower_user_id = new.blocker_user_id and target_user_id = new.blocked_user_id)
      or (follower_user_id = new.blocked_user_id and target_user_id = new.blocker_user_id);

  -- Clean up reactions between the two users
  delete from public.community_reactions
   where (user_id = new.blocker_user_id and activity_id in (select id from public.shared_activities where user_id = new.blocked_user_id))
      or (user_id = new.blocked_user_id and activity_id in (select id from public.shared_activities where user_id = new.blocker_user_id));

  return new;
end;
$$;


drop trigger if exists tr_community_block_cleanup on public.community_blocks;
create trigger tr_community_block_cleanup
  after insert on public.community_blocks
  for each row execute function public.handle_community_block_inserted();

-- ============================================================================
-- Row Level Security (RLS) Policies
-- ============================================================================

-- RLS: Community Profiles
-- Owner can do all on their own profile
create policy community_profiles_owner_all on public.community_profiles
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Other authenticated users can view active searchable profiles or approved follower/target profiles,
-- provided neither party has blocked the other.
create policy community_profiles_viewer_select on public.community_profiles
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      status = 'active'
      and not exists (
        select 1 from public.community_blocks b
         where (b.blocker_user_id = (select auth.uid()) and b.blocked_user_id = community_profiles.user_id)
            or (b.blocker_user_id = community_profiles.user_id and b.blocked_user_id = (select auth.uid()))
      )
      and (
        is_searchable = true
        or exists (
          select 1 from public.community_relationships r
           where r.status = 'approved'
             and ((r.follower_user_id = (select auth.uid()) and r.target_user_id = community_profiles.user_id)
               or (r.target_user_id = (select auth.uid()) and r.follower_user_id = community_profiles.user_id))
        )
      )
    )
  );

-- RLS: Community Relationships
-- Only participants can see the relationship
create policy community_relationships_select on public.community_relationships
  for select to authenticated
  using (
    follower_user_id = (select auth.uid())
    or target_user_id = (select auth.uid())
  );

-- Requester can insert a pending request if not self-requesting
create policy community_relationships_insert on public.community_relationships
  for insert to authenticated
  with check (
    follower_user_id = (select auth.uid())
    and follower_user_id <> target_user_id
    and status = 'pending'
    and not exists (
      select 1 from public.community_blocks b
       where (b.blocker_user_id = (select auth.uid()) and b.blocked_user_id = target_user_id)
          or (b.blocker_user_id = target_user_id and b.blocked_user_id = (select auth.uid()))
    )
  );

-- Target can approve or decline; requester can cancel
create policy community_relationships_update on public.community_relationships
  for update to authenticated
  using (
    follower_user_id = (select auth.uid())
    or target_user_id = (select auth.uid())
  )
  with check (
    (target_user_id = (select auth.uid()) and status in ('approved', 'declined'))
    or (follower_user_id = (select auth.uid()) and status = 'canceled')
  );

-- Either participant can remove/unfollow/delete
create policy community_relationships_delete on public.community_relationships
  for delete to authenticated
  using (
    follower_user_id = (select auth.uid())
    or target_user_id = (select auth.uid())
  );

-- RLS: Community Blocks
-- Blocker can see, create, and delete their own blocks
create policy community_blocks_select on public.community_blocks
  for select to authenticated
  using (blocker_user_id = (select auth.uid()));

create policy community_blocks_insert on public.community_blocks
  for insert to authenticated
  with check (
    blocker_user_id = (select auth.uid())
    and blocker_user_id <> blocked_user_id
  );

create policy community_blocks_delete on public.community_blocks
  for delete to authenticated
  using (blocker_user_id = (select auth.uid()));

-- RLS: Shared Activities
-- Author has full access to their own shared activities
create policy shared_activities_owner_all on public.shared_activities
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Approved followers can select unrevoked cards if author is active and no bilateral block exists
create policy shared_activities_follower_select on public.shared_activities
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      revoked_at is null
      and exists (
        select 1 from public.community_profiles cp
         where cp.user_id = shared_activities.user_id
           and cp.status = 'active'
      )
      and exists (
        select 1 from public.community_relationships r
         where r.follower_user_id = (select auth.uid())
           and r.target_user_id = shared_activities.user_id
           and r.status = 'approved'
      )
      and not exists (
        select 1 from public.community_blocks b
         where (b.blocker_user_id = (select auth.uid()) and b.blocked_user_id = shared_activities.user_id)
            or (b.blocker_user_id = shared_activities.user_id and b.blocked_user_id = (select auth.uid()))
      )
    )
  );

-- RLS: Community Reactions
-- User can insert/update/delete their own reactions if they have access to the activity
create policy community_reactions_owner_manage on public.community_reactions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.shared_activities a
       where a.id = activity_id
         and a.revoked_at is null
    )
  );

-- Reactions are visible to author and approved followers who can see the card
create policy community_reactions_select on public.community_reactions
  for select to authenticated
  using (
    exists (
      select 1 from public.shared_activities a
       where a.id = community_reactions.activity_id
         and (
           a.user_id = (select auth.uid())
           or (
             a.revoked_at is null
             and exists (
               select 1 from public.community_relationships r
                where r.follower_user_id = (select auth.uid())
                  and r.target_user_id = a.user_id
                  and r.status = 'approved'
             )
           )
         )
    )
  );

-- RLS: Community Reports
-- Reporter can create and view their own reports
create policy community_reports_insert on public.community_reports
  for insert to authenticated
  with check (reporter_user_id = (select auth.uid()));

create policy community_reports_select_owner on public.community_reports
  for select to authenticated
  using (reporter_user_id = (select auth.uid()));

-- RLS: Community Invitations
-- Inviter can manage their own invitations
create policy community_invitations_owner_all on public.community_invitations
  for all to authenticated
  using (inviter_user_id = (select auth.uid()))
  with check (inviter_user_id = (select auth.uid()));

-- Authenticated users can resolve valid unrevoked invitations
create policy community_invitations_select_valid on public.community_invitations
  for select to authenticated
  using (
    revoked_at is null
    and expires_at > timezone('utc', now())
  );

-- ============================================================================
-- Explicit Grants
-- ============================================================================
grant select, insert, update, delete on public.community_profiles to authenticated;
grant select, insert, update, delete on public.community_relationships to authenticated;
grant select, insert, update, delete on public.community_blocks to authenticated;
grant select, insert, update, delete on public.shared_activities to authenticated;
grant select, insert, update, delete on public.community_reactions to authenticated;
grant select, insert, update, delete on public.community_reports to authenticated;
grant select, insert, update, delete on public.community_invitations to authenticated;

grant all on public.community_profiles to service_role;
grant all on public.community_relationships to service_role;
grant all on public.community_blocks to service_role;
grant all on public.shared_activities to service_role;
grant all on public.community_reactions to service_role;
grant all on public.community_reports to service_role;
grant all on public.community_invitations to service_role;
