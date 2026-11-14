-- Coffee Community schema.
-- Fresh project: run this whole file once in the Supabase SQL editor, then seed.sql.
-- It includes chat (schema `chat` + cafe memberships). After it succeeds, add `chat` to
-- Exposed schemas (Settings → API). See docs/chat-backend.md.
-- Existing project: do not re-run this file. Run the files in supabase/migrations/ in order
-- (002_photos_comments_usernames.sql, then 003_chat.sql). Run 003 before deploying chat.

create extension if not exists pgcrypto;

-- ───────── Tables ─────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  avatar_url text,
  bio text,
  role text check (role in ('barista','owner','coffee_lover')),
  city text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.cafes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  city text not null,
  state text not null,
  address text,
  description text,
  menu_url text,
  instagram text,
  tiktok text,
  website text,
  photos text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  cafe_id uuid unique references public.cafes(id) on delete cascade
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  body text check (char_length(body) <= 10000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  parent_comment_id uuid references public.comments(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint comments_body_check check (
    (deleted_at is null and char_length(body) between 1 and 5000)
    or (deleted_at is not null and body = '')
  )
);

-- path is the object key in the post-photos bucket ("{author uid}/{file}").
-- url is the public URL so the app can render it without rebuilding the path.
create table public.post_photos (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  path text not null check (char_length(path) between 1 and 500),
  url text not null check (char_length(url) between 1 and 2000),
  position int not null default 0 check (position >= 0),
  created_at timestamptz not null default now()
);

create index on public.cafes (lower(name));
create index on public.cafes (lower(city), lower(state));
create index on public.posts (community_id, created_at desc);
create index on public.comments (post_id, created_at);
create index post_photos_post_position_idx on public.post_photos (post_id, position);
create unique index profiles_username_lower_idx on public.profiles (lower(username));

-- ───────── Helpers & triggers ─────────
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- Every new auth user gets a profile with a placeholder username.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, 'user_' || substr(replace(new.id::text, '-', ''), 1, 8));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Every cafe automatically gets its own discussion community.
create or replace function public.handle_new_cafe() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.communities (name, slug, cafe_id)
  values (new.name, 'cafe-' || new.slug, new.id);
  return new;
end $$;

create trigger on_cafe_created
  after insert on public.cafes
  for each row execute function public.handle_new_cafe();

create or replace function public.handle_cafe_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.communities set name = new.name, slug = 'cafe-' || new.slug where cafe_id = new.id;
  return new;
end $$;

create trigger on_cafe_updated
  after update of name, slug on public.cafes
  for each row execute function public.handle_cafe_update();

create or replace function public.blank_deleted_comment()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.deleted_at is not null then
    new.body := '';
  end if;
  return new;
end $$;

create trigger comments_blank_on_soft_delete
  before update of deleted_at, body on public.comments
  for each row
  when (new.deleted_at is not null)
  execute function public.blank_deleted_comment();

create or replace function public.blank_deleted_post()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    new.title := '[deleted]';
    new.body := null;
  end if;
  return new;
end $$;

create trigger posts_blank_on_soft_delete
  before update of deleted_at, title, body on public.posts
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.blank_deleted_post();

create or replace function public.enforce_post_photo_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Queue concurrent inserts for this post so two uploads can't both pass the cap.
  perform pg_advisory_xact_lock(hashtext('post-photos:' || new.post_id::text));
  if (select count(*) from public.post_photos where post_id = new.post_id) >= 6 then
    raise exception 'A post can have at most 6 photos';
  end if;
  return new;
end $$;

create trigger post_photos_limit
  before insert on public.post_photos
  for each row execute function public.enforce_post_photo_limit();

-- Case-insensitive availability. Excludes the signed-in user so they can keep their own name.
create or replace function public.username_available(candidate text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles
    where lower(username) = lower(btrim(candidate))
      and id is distinct from auth.uid()
  );
$$;

-- One transaction so a failed reorder cannot leave two photos on the same step.
create or replace function public.reorder_post_photos(p_post_id uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  n int;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if not exists (
    select 1 from public.posts
    where id = p_post_id and author_id = uid and deleted_at is null
  ) then
    raise exception 'Only the author can reorder photos';
  end if;

  select count(*) into n from public.post_photos where post_id = p_post_id and author_id = uid;
  if n is distinct from coalesce(array_length(p_ids, 1), 0)
     or n is distinct from (select count(distinct x) from unnest(p_ids) as t(x))
     or exists (
       select 1 from unnest(p_ids) as t(id)
       where not exists (
         select 1 from public.post_photos ph
         where ph.id = t.id and ph.post_id = p_post_id and ph.author_id = uid
       )
     )
  then
    raise exception 'Photo list does not match this post';
  end if;

  update public.post_photos ph
  set position = (u.ord - 1)::int
  from unnest(p_ids) with ordinality as u(id, ord)
  where ph.id = u.id and ph.post_id = p_post_id;
end $$;

grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.reorder_post_photos(uuid, uuid[]) to authenticated;

-- The general space.
insert into public.communities (name, slug) values ('LA Coffee', 'la-coffee');

-- ───────── Row level security ─────────
alter table public.profiles    enable row level security;
alter table public.cafes       enable row level security;
alter table public.communities enable row level security;
alter table public.posts       enable row level security;
alter table public.comments    enable row level security;
alter table public.post_photos enable row level security;

-- Anyone can read.
create policy "read profiles"    on public.profiles    for select using (true);
create policy "read cafes"       on public.cafes       for select using (true);
create policy "read communities" on public.communities for select using (true);
create policy "read posts"       on public.posts       for select using (true);
create policy "read comments"    on public.comments    for select using (true);
create policy "read post photos" on public.post_photos for select using (true);

-- Profiles: you edit only your own row, and never the is_admin column.
create policy "update own profile" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (username, display_name, avatar_url, bio, role, city) on public.profiles to authenticated;

-- Cafes: admin only.
create policy "admin insert cafes" on public.cafes for insert with check (public.is_admin());
create policy "admin update cafes" on public.cafes for update using (public.is_admin()) with check (public.is_admin());
create policy "admin delete cafes" on public.cafes for delete using (public.is_admin());

-- Posts & comments: signed-in users write as themselves.
-- Deletes in the app are soft (deleted_at) so replies are kept.
create policy "insert own post" on public.posts for insert to authenticated
  with check (author_id = auth.uid() and deleted_at is null);
create policy "insert own comment" on public.comments for insert to authenticated
  with check (author_id = auth.uid() and deleted_at is null);
-- Posts keep a hard-delete policy so a failed photo attach can roll the new post back.
-- Comments do not: a hard delete cascades through replies, so removal is soft-delete only.
create policy "delete own or admin post" on public.posts for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

revoke update on public.posts from anon, authenticated;
grant update (title, body, deleted_at) on public.posts to authenticated;
create policy "soft-delete own or admin post" on public.posts for update to authenticated
  using ((author_id = auth.uid() or public.is_admin()) and deleted_at is null)
  with check (
    deleted_at is not null
    and title = '[deleted]'
    and body is null
    and (author_id = auth.uid() or public.is_admin())
  );

revoke update on public.comments from anon, authenticated;
grant update (body, deleted_at) on public.comments to authenticated;
create policy "soft-delete own or admin comment" on public.comments for update to authenticated
  using ((author_id = auth.uid() or public.is_admin()) and deleted_at is null)
  with check (
    deleted_at is not null
    and body = ''
    and (author_id = auth.uid() or public.is_admin())
  );

-- Post photos: anyone reads; the author manages their own; admins can delete any.
create policy "insert own post photo" on public.post_photos for insert to authenticated
  with check (
    author_id = auth.uid()
    and position >= 0
    and path like auth.uid()::text || '/%'
    and path not like '%..%'
    and path not like '%/%/%'
    and exists (
      select 1 from public.posts p
      where p.id = post_id
        and p.author_id = auth.uid()
        and p.deleted_at is null
    )
  );
create policy "update own post photo" on public.post_photos for update to authenticated
  using (author_id = auth.uid())
  with check (
    author_id = auth.uid()
    and path like auth.uid()::text || '/%'
    and path not like '%..%'
    and path not like '%/%/%'
  );
create policy "delete own or admin post photo" on public.post_photos for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());
revoke update on public.post_photos from anon, authenticated;
grant update (position) on public.post_photos to authenticated;

-- ───────── Storage ─────────
insert into storage.buckets (id, name, public) values
  ('avatars', 'avatars', true),
  ('cafe-photos', 'cafe-photos', true),
  ('post-photos', 'post-photos', true)
on conflict (id) do nothing;

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'post-photos';

create policy "public read images" on storage.objects for select
  using (bucket_id in ('avatars', 'cafe-photos', 'post-photos'));

create policy "users upload own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users update own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "admin upload cafe photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'cafe-photos' and public.is_admin());

create policy "users upload own post photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'post-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users update own post photos" on storage.objects for update to authenticated
  using (bucket_id = 'post-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'post-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users delete own post photos" on storage.objects for delete to authenticated
  using (bucket_id = 'post-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "admin delete post photo objects" on storage.objects for delete to authenticated
  using (bucket_id = 'post-photos' and public.is_admin());

-- ───────── Make yourself admin (after you've signed in once) ─────────
-- update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = 'YOUR_EMAIL');

-- ───────── Chat ─────────
-- Same SQL as supabase/migrations/003_chat.sql. Kept inline so a fresh install is one file.
-- Cafe insert (including seed.sql, which runs next) creates a community, and the trigger
-- below creates that community's chat room. The LA Coffee community inserted above is
-- backfilled at the end of this section.
create extension if not exists pgcrypto;

create schema if not exists chat;

comment on schema chat is
  'Reusable chat (rooms, DMs, buddies, blocks). Coffee membership glue stays in public.';

-- ───────── Tables ─────────
-- Generic on purpose: context_type/context_id point at a community without a foreign key
-- into public.cafes or public.communities, so this schema does not depend on coffee tables.

create table if not exists chat.rooms (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('group', 'dm')),
  slug text not null,
  title text,
  created_by uuid references public.profiles(id) on delete set null,
  context_type text,
  context_id uuid,
  created_at timestamptz not null default now(),
  constraint rooms_context_pair check (
    (context_type is null and context_id is null)
    or (
      context_type is not null
      and context_id is not null
      and char_length(context_type) between 1 and 40
    )
  ),
  constraint rooms_slug_len check (char_length(slug) between 1 and 200),
  constraint rooms_title_len check (title is null or char_length(title) between 1 and 200)
);

create unique index if not exists rooms_slug_key on chat.rooms (slug);
create unique index if not exists rooms_context_key
  on chat.rooms (context_type, context_id)
  where context_id is not null;

create table if not exists chat.room_members (
  room_id uuid not null references chat.rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'moderator')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_members_user_idx on chat.room_members (user_id);

create table if not exists chat.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references chat.rooms(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint messages_body_check check (
    (deleted_at is null and char_length(body) between 1 and 2000)
    or (deleted_at is not null and body = '')
  )
);

-- Pagination: newest page is room_id + created_at desc, then keyset on created_at.
create index if not exists messages_room_created_idx
  on chat.messages (room_id, created_at desc);

create table if not exists chat.buddies (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  buddy_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, buddy_id),
  constraint buddies_not_self check (owner_id <> buddy_id)
);

create index if not exists buddies_buddy_idx on chat.buddies (buddy_id);

create table if not exists chat.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

create index if not exists blocks_blocked_idx on chat.blocks (blocked_id);

create table if not exists chat.user_status (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'offline' check (status in ('online', 'away', 'offline')),
  last_seen timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────── Triggers ─────────

create or replace function chat.prepare_message()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is not null then
      raise exception 'New messages cannot be deleted';
    end if;
    new.edited_at := null;
  end if;

  if new.deleted_at is not null then
    new.body := '';
    return new;
  end if;

  if btrim(new.body) = '' then
    raise exception 'Message is empty';
  end if;
  if char_length(new.body) > 2000 then
    raise exception 'Message is too long';
  end if;

  if tg_op = 'UPDATE' and new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end $$;

drop trigger if exists messages_prepare on chat.messages;
create trigger messages_prepare
  before insert or update of body, deleted_at on chat.messages
  for each row execute function chat.prepare_message();

-- Hard cap: a DM never grows past the two people start_dm inserted.
create or replace function chat.enforce_dm_member_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, chat
as $$
declare
  room_kind text;
  n int;
begin
  select kind into room_kind from chat.rooms where id = new.room_id;
  if room_kind = 'dm' then
    select count(*) into n from chat.room_members where room_id = new.room_id;
    if n >= 2 then
      raise exception 'DM rooms have exactly 2 members';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists room_members_dm_limit on chat.room_members;
create trigger room_members_dm_limit
  before insert on chat.room_members
  for each row execute function chat.enforce_dm_member_limit();

create or replace function chat.touch_user_status()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  new.last_seen := now();
  return new;
end $$;

drop trigger if exists user_status_touch on chat.user_status;
create trigger user_status_touch
  before insert or update of status on chat.user_status
  for each row execute function chat.touch_user_status();

-- ───────── Helpers (RLS + RPCs) ─────────
-- security definer functions are revoked from public below and granted only to
-- authenticated. Each one checks auth.uid() and does not read coffee tables.

create or replace function chat.is_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, chat
as $$
  select exists (
    select 1 from chat.room_members
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;

create or replace function chat.can_moderate(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, chat, public
as $$
  -- Coffee admins moderate only rooms they have joined. They do not gain a
  -- backdoor into DMs. public.is_admin() reads profiles, not cafes or posts.
  select exists (
    select 1 from chat.room_members
    where room_id = p_room_id
      and user_id = auth.uid()
      and (role = 'moderator' or public.is_admin())
  );
$$;

-- True only when the caller is in this DM and either person has blocked the other.
-- Non-members always get false so the function cannot be used to probe blocks.
create or replace function chat.dm_blocked(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, chat
as $$
  select
    auth.uid() is not null
    and exists (
      select 1 from chat.room_members me
      where me.room_id = p_room_id and me.user_id = auth.uid()
    )
    and exists (
      select 1
      from chat.rooms r
      join chat.room_members a on a.room_id = r.id
      join chat.room_members b on b.room_id = r.id and b.user_id <> a.user_id
      join chat.blocks k
        on k.blocker_id = a.user_id and k.blocked_id = b.user_id
      where r.id = p_room_id and r.kind = 'dm'
    );
$$;

create or replace function chat.topic_room_id(p_topic text)
returns uuid
language plpgsql
stable
set search_path = pg_catalog
as $$
begin
  if p_topic ~ '^chat-room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return substring(p_topic from 11)::uuid;
  end if;
  return null;
end $$;

create or replace function chat.start_dm(p_username text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, chat, public
as $$
declare
  me uuid := auth.uid();
  other uuid;
  uname text := lower(btrim(coalesce(p_username, '')));
  room uuid;
  dm_slug text;
  low uuid;
  high uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if uname !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Username: 3–20 letters, numbers or underscores.';
  end if;

  select id into other from public.profiles where lower(username) = uname;
  if other is null then
    raise exception 'No one uses that username';
  end if;
  if other = me then
    raise exception 'You cannot message yourself';
  end if;

  if other < me then
    low := other;
    high := me;
  else
    low := me;
    high := other;
  end if;
  dm_slug := 'dm:' || low::text || ':' || high::text;

  perform pg_advisory_xact_lock(hashtext(dm_slug)::bigint);

  select r.id into room from chat.rooms r where r.slug = dm_slug;
  if room is null then
    if exists (
      select 1 from chat.blocks k
      where (k.blocker_id = me and k.blocked_id = other)
         or (k.blocker_id = other and k.blocked_id = me)
    ) then
      raise exception 'You cannot message this person';
    end if;

    insert into chat.rooms (kind, slug, title, created_by)
    values ('dm', dm_slug, null, me)
    returning id into room;

    insert into chat.room_members (room_id, user_id, role)
    values (room, me, 'member'), (room, other, 'member');
  end if;

  return room;
end $$;

create or replace function chat.add_buddy(p_username text)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, chat, public
as $$
declare
  me uuid := auth.uid();
  buddy uuid;
  uname text := lower(btrim(coalesce(p_username, '')));
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if uname !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Username: 3–20 letters, numbers or underscores.';
  end if;
  select id into buddy from public.profiles where lower(username) = uname;
  if buddy is null then
    raise exception 'No one uses that username';
  end if;
  if buddy = me then
    raise exception 'You cannot add yourself';
  end if;
  insert into chat.buddies (owner_id, buddy_id) values (me, buddy)
  on conflict (owner_id, buddy_id) do nothing;
end $$;

create or replace function chat.remove_buddy(p_username text)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, chat, public
as $$
declare
  me uuid := auth.uid();
  buddy uuid;
  uname text := lower(btrim(coalesce(p_username, '')));
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  select id into buddy from public.profiles where lower(username) = uname;
  if buddy is null then
    raise exception 'No one uses that username';
  end if;
  delete from chat.buddies where owner_id = me and buddy_id = buddy;
end $$;

create or replace function chat.block_user(p_username text)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, chat, public
as $$
declare
  me uuid := auth.uid();
  other uuid;
  uname text := lower(btrim(coalesce(p_username, '')));
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if uname !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Username: 3–20 letters, numbers or underscores.';
  end if;
  select id into other from public.profiles where lower(username) = uname;
  if other is null then
    raise exception 'No one uses that username';
  end if;
  if other = me then
    raise exception 'You cannot block yourself';
  end if;
  insert into chat.blocks (blocker_id, blocked_id) values (me, other)
  on conflict (blocker_id, blocked_id) do nothing;
end $$;

create or replace function chat.unblock_user(p_username text)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, chat, public
as $$
declare
  me uuid := auth.uid();
  other uuid;
  uname text := lower(btrim(coalesce(p_username, '')));
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  select id into other from public.profiles where lower(username) = uname;
  if other is null then
    raise exception 'No one uses that username';
  end if;
  delete from chat.blocks where blocker_id = me and blocked_id = other;
end $$;

create or replace function chat.mark_read(p_room_id uuid)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, chat
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update chat.room_members
  set last_read_at = now()
  where room_id = p_room_id and user_id = auth.uid();
  if not found then
    raise exception 'Not a member of this room';
  end if;
end $$;

create or replace function chat.unread_counts()
returns table (room_id uuid, unread bigint)
language sql
stable
security invoker
set search_path = pg_catalog, chat
as $$
  select m.room_id, count(*)::bigint
  from chat.messages m
  join chat.room_members rm
    on rm.room_id = m.room_id
   and rm.user_id = auth.uid()
  where m.deleted_at is null
    and m.sender_id is distinct from auth.uid()
    and m.created_at > rm.last_read_at
  group by m.room_id;
$$;

create or replace function chat.touch_status(p_status text)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, chat
as $$
declare
  me uuid := auth.uid();
  next_status text := lower(btrim(coalesce(p_status, '')));
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if next_status not in ('online', 'away', 'offline') then
    raise exception 'Status must be online, away, or offline';
  end if;
  insert into chat.user_status (user_id, status)
  values (me, next_status)
  on conflict (user_id) do update set status = excluded.status;
end $$;

-- ───────── Row level security ─────────

alter table chat.rooms enable row level security;
alter table chat.room_members enable row level security;
alter table chat.messages enable row level security;
alter table chat.buddies enable row level security;
alter table chat.blocks enable row level security;
alter table chat.user_status enable row level security;

drop policy if exists "read rooms as member" on chat.rooms;
create policy "read rooms as member" on chat.rooms
  for select to authenticated
  using (chat.is_member(id));

drop policy if exists "read room members" on chat.room_members;
create policy "read room members" on chat.room_members
  for select to authenticated
  using (chat.is_member(room_id));

drop policy if exists "update own read cursor" on chat.room_members;
create policy "update own read cursor" on chat.room_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "read messages as member" on chat.messages;
create policy "read messages as member" on chat.messages
  for select to authenticated
  using (chat.is_member(room_id));

drop policy if exists "insert own message" on chat.messages;
create policy "insert own message" on chat.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and deleted_at is null
    and edited_at is null
    and chat.is_member(room_id)
    and not chat.dm_blocked(room_id)
    and char_length(btrim(body)) between 1 and 2000
  );

drop policy if exists "edit own message" on chat.messages;
create policy "edit own message" on chat.messages
  for update to authenticated
  using (sender_id = auth.uid() and deleted_at is null and chat.is_member(room_id))
  with check (
    sender_id = auth.uid()
    and deleted_at is null
    and chat.is_member(room_id)
    and char_length(btrim(body)) between 1 and 2000
  );

drop policy if exists "soft-delete own or moderator message" on chat.messages;
create policy "soft-delete own or moderator message" on chat.messages
  for update to authenticated
  using (
    deleted_at is null
    and chat.is_member(room_id)
    and (sender_id = auth.uid() or chat.can_moderate(room_id))
  )
  with check (deleted_at is not null and body = '');

drop policy if exists "read own buddies" on chat.buddies;
create policy "read own buddies" on chat.buddies
  for select to authenticated
  using (owner_id = auth.uid());

drop policy if exists "insert own buddy" on chat.buddies;
create policy "insert own buddy" on chat.buddies
  for insert to authenticated
  with check (owner_id = auth.uid() and buddy_id <> auth.uid());

drop policy if exists "delete own buddy" on chat.buddies;
create policy "delete own buddy" on chat.buddies
  for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists "read own blocks" on chat.blocks;
create policy "read own blocks" on chat.blocks
  for select to authenticated
  using (blocker_id = auth.uid());

drop policy if exists "insert own block" on chat.blocks;
create policy "insert own block" on chat.blocks
  for insert to authenticated
  with check (blocker_id = auth.uid() and blocked_id <> auth.uid());

drop policy if exists "delete own block" on chat.blocks;
create policy "delete own block" on chat.blocks
  for delete to authenticated
  using (blocker_id = auth.uid());

drop policy if exists "read buddy status" on chat.user_status;
create policy "read buddy status" on chat.user_status
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from chat.buddies b
      where b.owner_id = auth.uid() and b.buddy_id = user_status.user_id
    )
  );

drop policy if exists "insert own status" on chat.user_status;
create policy "insert own status" on chat.user_status
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "update own status" on chat.user_status;
create policy "update own status" on chat.user_status
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No insert/delete policies on rooms or room_members.
-- Membership is created by chat.start_dm and by public cafe/community functions.

-- ───────── Grants ─────────
-- anon can see the schema (required once `chat` is exposed) but cannot read rows.
-- There is no client path that uses the service-role key.

grant usage on schema chat to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema chat to service_role;
grant usage, select on all sequences in schema chat to service_role;
grant execute on all functions in schema chat to service_role;

revoke all on all tables in schema chat from anon, authenticated;
grant select on
  chat.rooms,
  chat.room_members,
  chat.messages,
  chat.buddies,
  chat.blocks,
  chat.user_status
to authenticated;

grant insert (room_id, sender_id, body) on chat.messages to authenticated;
grant update (body, deleted_at) on chat.messages to authenticated;
grant update (last_read_at) on chat.room_members to authenticated;
grant insert (owner_id, buddy_id) on chat.buddies to authenticated;
grant delete on chat.buddies to authenticated;
grant insert (blocker_id, blocked_id) on chat.blocks to authenticated;
grant delete on chat.blocks to authenticated;
grant insert (user_id, status) on chat.user_status to authenticated;
grant update (status) on chat.user_status to authenticated;

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'chat'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
  end loop;
end $$;

grant execute on function chat.is_member(uuid) to authenticated;
grant execute on function chat.can_moderate(uuid) to authenticated;
grant execute on function chat.dm_blocked(uuid) to authenticated;
grant execute on function chat.topic_room_id(text) to authenticated;
grant execute on function chat.start_dm(text) to authenticated;
grant execute on function chat.add_buddy(text) to authenticated;
grant execute on function chat.remove_buddy(text) to authenticated;
grant execute on function chat.block_user(text) to authenticated;
grant execute on function chat.unblock_user(text) to authenticated;
grant execute on function chat.mark_read(uuid) to authenticated;
grant execute on function chat.unread_counts() to authenticated;
grant execute on function chat.touch_status(text) to authenticated;
-- Trigger functions run as the table owner. Authenticated still needs execute
-- on Postgres versions that check the invoker's privilege when a trigger fires.
grant execute on function chat.prepare_message() to authenticated;
grant execute on function chat.enforce_dm_member_limit() to authenticated;
grant execute on function chat.touch_user_status() to authenticated;

alter default privileges in schema chat
  grant all on tables to service_role;
alter default privileges in schema chat
  grant all on functions to service_role;

-- ───────── Realtime ─────────
alter table chat.messages replica identity full;
alter table chat.room_members replica identity full;
alter table chat.buddies replica identity full;
alter table chat.blocks replica identity full;
alter table chat.user_status replica identity full;

do $$
declare
  tbl text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found; skipped chat publication';
    return;
  end if;
  foreach tbl in array array['messages', 'room_members', 'buddies', 'blocks', 'user_status']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'chat'
        and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table chat.%I', tbl);
    end if;
  end loop;
end $$;

-- Private channels. Skipped when this file is applied to a database without Realtime
-- (local idempotency check). Hosted Supabase has realtime.messages already; do not
-- ALTER it or enable RLS here — that table is owned by the Realtime service.
do $realtime$
begin
  if to_regclass('realtime.messages') is null or to_regprocedure('realtime.topic()') is null then
    raise notice 'realtime.messages or realtime.topic() missing; skipped chat channel policies';
    return;
  end if;

  execute 'drop policy if exists "chat realtime read" on realtime.messages';
  execute 'drop policy if exists "chat realtime write" on realtime.messages';

  execute $pol$
    create policy "chat realtime read" on realtime.messages
    for select to authenticated
    using (
      (select realtime.topic()) = 'chat-dock'
      or (
        (select realtime.topic()) like 'chat-room:%'
        and chat.is_member(chat.topic_room_id((select realtime.topic())))
      )
      or (select realtime.topic()) = 'chat:presence:' || (select auth.uid())::text
      or exists (
        select 1 from chat.buddies b
        where b.owner_id = (select auth.uid())
          and (select realtime.topic()) = 'chat:presence:' || b.buddy_id::text
      )
    )
  $pol$;

  execute $pol$
    create policy "chat realtime write" on realtime.messages
    for insert to authenticated
    with check (
      (select realtime.topic()) = 'chat:presence:' || (select auth.uid())::text
    )
  $pol$;

  -- Membership rows are already world-readable. This only lets the Join button
  -- hear inserts/deletes when Realtime public access is turned off.
  execute 'drop policy if exists "cafe membership realtime" on realtime.messages';
  execute $pol$
    create policy "cafe membership realtime" on realtime.messages
    for select to anon, authenticated
    using ((select realtime.topic()) like 'cafe-members:%')
  $pol$;
end
$realtime$;

-- ───────── Coffee glue (public) ─────────
-- Joining a cafe is the only client write. The trigger below puts that person
-- in the community's chat room and takes them out when they leave.

create table if not exists public.cafe_memberships (
  cafe_id uuid not null references public.cafes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (cafe_id, user_id)
);

create index if not exists cafe_memberships_user_idx on public.cafe_memberships (user_id);

alter table public.cafe_memberships enable row level security;

drop policy if exists "read cafe memberships" on public.cafe_memberships;
create policy "read cafe memberships" on public.cafe_memberships
  for select using (true);

drop policy if exists "join cafe as self" on public.cafe_memberships;
create policy "join cafe as self" on public.cafe_memberships
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "leave cafe as self" on public.cafe_memberships;
create policy "leave cafe as self" on public.cafe_memberships
  for delete to authenticated
  using (user_id = auth.uid());

grant select on public.cafe_memberships to anon, authenticated;
grant insert, delete on public.cafe_memberships to authenticated;
revoke update on public.cafe_memberships from anon, authenticated;

alter table public.cafe_memberships replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'cafe_memberships'
     )
  then
    alter publication supabase_realtime add table public.cafe_memberships;
  end if;
end $$;

create or replace function public.sync_community_chat_room()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, chat
as $$
declare
  room_title text := left(btrim(new.name), 200);
begin
  if room_title is null or room_title = '' then
    room_title := 'Chat';
  end if;
  insert into chat.rooms (kind, slug, title, context_type, context_id)
  values ('group', 'community:' || new.id::text, room_title, 'community', new.id)
  on conflict (slug) do update
    set title = excluded.title
    where chat.rooms.title is distinct from excluded.title;
  return new;
end $$;

drop trigger if exists communities_chat_room on public.communities;
create trigger communities_chat_room
  after insert or update of name on public.communities
  for each row execute function public.sync_community_chat_room();

create or replace function public.sync_cafe_chat_member()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, chat
as $$
declare
  cafe uuid;
  uid uuid;
  rid uuid;
begin
  if tg_op = 'INSERT' then
    cafe := new.cafe_id;
    uid := new.user_id;
  else
    cafe := old.cafe_id;
    uid := old.user_id;
  end if;

  select r.id into rid
  from chat.rooms r
  join public.communities c on c.id = r.context_id
  where r.context_type = 'community'
    and c.cafe_id = cafe;

  if rid is null then
    raise exception 'Chat room for this cafe is not ready';
  end if;

  if tg_op = 'INSERT' then
    insert into chat.room_members (room_id, user_id, role)
    values (rid, uid, 'member')
    on conflict (room_id, user_id) do nothing;
  else
    delete from chat.room_members where room_id = rid and user_id = uid;
  end if;
  return null;
end $$;

drop trigger if exists cafe_memberships_chat_sync on public.cafe_memberships;
create trigger cafe_memberships_chat_sync
  after insert or delete on public.cafe_memberships
  for each row execute function public.sync_cafe_chat_member();

-- General communities (no cafe), such as LA Coffee. Cafe chats are joined only
-- by inserting public.cafe_memberships so the two lists cannot drift.
create or replace function public.join_community_chat(p_community_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, chat
as $$
declare
  me uuid := auth.uid();
  cafe uuid;
  room uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  select c.cafe_id into cafe from public.communities c where c.id = p_community_id;
  if not found then
    raise exception 'Community not found';
  end if;
  if cafe is not null then
    raise exception 'Join the cafe to enter this chat';
  end if;
  select r.id into room
  from chat.rooms r
  where r.context_type = 'community' and r.context_id = p_community_id;
  if room is null then
    raise exception 'Chat room is not ready';
  end if;
  insert into chat.room_members (room_id, user_id, role)
  values (room, me, 'member')
  on conflict (room_id, user_id) do nothing;
  return room;
end $$;

create or replace function public.leave_community_chat(p_community_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, chat
as $$
declare
  me uuid := auth.uid();
  cafe uuid;
  room uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  select c.cafe_id into cafe from public.communities c where c.id = p_community_id;
  if not found then
    raise exception 'Community not found';
  end if;
  if cafe is not null then
    raise exception 'Leave the cafe to exit this chat';
  end if;
  select r.id into room
  from chat.rooms r
  where r.context_type = 'community' and r.context_id = p_community_id;
  if room is null then
    return;
  end if;
  delete from chat.room_members where room_id = room and user_id = me;
end $$;

create or replace function public.community_member_count(p_community_id uuid)
returns bigint
language sql
stable
security definer
set search_path = pg_catalog, public, chat
as $$
  select count(*)::bigint
  from chat.room_members rm
  join chat.rooms r on r.id = rm.room_id
  where r.context_type = 'community' and r.context_id = p_community_id;
$$;

revoke all on function public.sync_community_chat_room() from public, anon, authenticated;
revoke all on function public.sync_cafe_chat_member() from public, anon, authenticated;
revoke all on function public.join_community_chat(uuid) from public, anon, authenticated;
revoke all on function public.leave_community_chat(uuid) from public, anon, authenticated;
revoke all on function public.community_member_count(uuid) from public, anon, authenticated;

grant execute on function public.join_community_chat(uuid) to authenticated;
grant execute on function public.leave_community_chat(uuid) to authenticated;
grant execute on function public.community_member_count(uuid) to anon, authenticated;
-- Same reason as the chat trigger functions.
grant execute on function public.sync_community_chat_room() to authenticated;
grant execute on function public.sync_cafe_chat_member() to authenticated;

-- Rooms for communities that already exist (including LA Coffee).
insert into chat.rooms (kind, slug, title, context_type, context_id)
select
  'group',
  'community:' || c.id::text,
  case when btrim(c.name) = '' then 'Chat' else left(btrim(c.name), 200) end,
  'community',
  c.id
from public.communities c
on conflict (slug) do update
  set title = excluded.title
  where chat.rooms.title is distinct from excluded.title;
