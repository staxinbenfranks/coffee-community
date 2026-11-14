-- LOCAL ONLY. Supabase-shaped stubs so 003_chat.sql can be applied twice on plain Postgres.
-- Do not run this against the hosted project.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create schema if not exists public;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  display_name text,
  avatar_url text,
  bio text,
  role text,
  city text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.cafes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  city text not null default 'Los Angeles',
  state text not null default 'CA'
);

create table if not exists public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  cafe_id uuid unique references public.cafes(id) on delete cascade
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema auth, public to anon, authenticated, service_role;
grant select on public.profiles, public.cafes, public.communities to anon, authenticated;
alter table public.profiles enable row level security;
alter table public.cafes enable row level security;
alter table public.communities enable row level security;
drop policy if exists "read profiles" on public.profiles;
create policy "read profiles" on public.profiles for select using (true);
drop policy if exists "read cafes" on public.cafes;
create policy "read cafes" on public.cafes for select using (true);
drop policy if exists "read communities" on public.communities;
create policy "read communities" on public.communities for select using (true);

create schema if not exists realtime;
create table if not exists realtime.messages (
  id bigint generated always as identity primary key
);
alter table realtime.messages enable row level security;
create or replace function realtime.topic()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.realtime_topic', true), '')
$$;
grant usage on schema realtime to anon, authenticated;
grant select on realtime.messages to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
