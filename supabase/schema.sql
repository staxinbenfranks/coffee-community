-- Coffee Community schema.
-- Fresh project: run this whole file once in the Supabase SQL editor, then seed.sql.
-- Existing project: do not re-run this file. Run supabase/migrations/002_photos_comments_usernames.sql.

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
