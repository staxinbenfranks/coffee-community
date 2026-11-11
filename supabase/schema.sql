-- Coffee Community: run this whole file once in Supabase -> SQL Editor.

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
  created_at timestamptz not null default now()
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  parent_comment_id uuid references public.comments(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);

create index on public.cafes (lower(name));
create index on public.cafes (lower(city), lower(state));
create index on public.posts (community_id, created_at desc);
create index on public.comments (post_id, created_at);

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

-- The general space.
insert into public.communities (name, slug) values ('LA Coffee', 'la-coffee');

-- ───────── Row level security ─────────
alter table public.profiles    enable row level security;
alter table public.cafes       enable row level security;
alter table public.communities enable row level security;
alter table public.posts       enable row level security;
alter table public.comments    enable row level security;

-- Anyone can read.
create policy "read profiles"    on public.profiles    for select using (true);
create policy "read cafes"       on public.cafes       for select using (true);
create policy "read communities" on public.communities for select using (true);
create policy "read posts"       on public.posts       for select using (true);
create policy "read comments"    on public.comments    for select using (true);

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
create policy "insert own post" on public.posts for insert to authenticated
  with check (author_id = auth.uid());
create policy "insert own comment" on public.comments for insert to authenticated
  with check (author_id = auth.uid());
create policy "delete own or admin post" on public.posts for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());
create policy "delete own or admin comment" on public.comments for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

-- ───────── Storage ─────────
insert into storage.buckets (id, name, public) values
  ('avatars', 'avatars', true),
  ('cafe-photos', 'cafe-photos', true)
on conflict (id) do nothing;

create policy "public read images" on storage.objects for select
  using (bucket_id in ('avatars', 'cafe-photos'));

create policy "users upload own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users update own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "admin upload cafe photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'cafe-photos' and public.is_admin());

-- ───────── Make yourself admin (after you've signed in once) ─────────
-- update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = 'YOUR_EMAIL');
