-- Existing LA Coffee database only. Do not re-run schema.sql.
-- Safe to run more than once: adds columns, policies, and indexes without deleting rows.
-- Run this whole file in the Supabase SQL editor BEFORE deploying the app change.
--
-- If it stops on "case-insensitive duplicate usernames", rename those profiles
-- so each lower(username) is unique, then run this file again.

do $$
begin
  if exists (
    select 1
    from public.profiles
    group by lower(username)
    having count(*) > 1
  ) then
    raise exception 'case-insensitive duplicate usernames exist; rename them before re-running this migration';
  end if;
end $$;

-- ───────── Soft-delete columns ─────────
alter table public.posts add column if not exists deleted_at timestamptz;
alter table public.comments add column if not exists deleted_at timestamptz;

do $$
declare
  r record;
begin
  for r in
    select conname
    from pg_constraint
    where conrelid = 'public.comments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%body%'
  loop
    execute format('alter table public.comments drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.comments
  add constraint comments_body_check check (
    (deleted_at is null and char_length(body) between 1 and 5000)
    or (deleted_at is not null and body = '')
  );

-- Blank the body whenever a comment is marked deleted, including updates that
-- only set deleted_at. Authors cannot put the text back: the update policy
-- below only matches rows that are not deleted yet.
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

drop trigger if exists comments_blank_on_soft_delete on public.comments;
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

drop trigger if exists posts_blank_on_soft_delete on public.posts;
create trigger posts_blank_on_soft_delete
  before update of deleted_at, title, body on public.posts
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.blank_deleted_post();

-- Inserts stay normal comments and posts. Soft-delete is an update.
drop policy if exists "insert own post" on public.posts;
create policy "insert own post" on public.posts for insert to authenticated
  with check (author_id = auth.uid() and deleted_at is null);

drop policy if exists "insert own comment" on public.comments;
create policy "insert own comment" on public.comments for insert to authenticated
  with check (author_id = auth.uid() and deleted_at is null);

-- Column grants: the soft-delete update cannot change author, community, or parent.
revoke update on public.posts from anon, authenticated;
grant update (title, body, deleted_at) on public.posts to authenticated;

revoke update on public.comments from anon, authenticated;
grant update (body, deleted_at) on public.comments to authenticated;

drop policy if exists "soft-delete own or admin post" on public.posts;
create policy "soft-delete own or admin post" on public.posts for update to authenticated
  using ((author_id = auth.uid() or public.is_admin()) and deleted_at is null)
  with check (
    deleted_at is not null
    and title = '[deleted]'
    and body is null
    and (author_id = auth.uid() or public.is_admin())
  );

drop policy if exists "soft-delete own or admin comment" on public.comments;
create policy "soft-delete own or admin comment" on public.comments for update to authenticated
  using ((author_id = auth.uid() or public.is_admin()) and deleted_at is null)
  with check (
    deleted_at is not null
    and body = ''
    and (author_id = auth.uid() or public.is_admin())
  );

-- Comments can no longer be hard-deleted by the API: that cascaded through replies.
-- Posts still can, so creating a post can roll back if attaching photos fails.
-- The Supabase SQL editor bypasses RLS and can still remove either.
drop policy if exists "delete own or admin comment" on public.comments;

-- ───────── Post photos ─────────
create table if not exists public.post_photos (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  path text not null check (char_length(path) between 1 and 500),
  url text not null check (char_length(url) between 1 and 2000),
  position int not null default 0 check (position >= 0),
  created_at timestamptz not null default now()
);

create index if not exists post_photos_post_position_idx on public.post_photos (post_id, position);

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

drop trigger if exists post_photos_limit on public.post_photos;
create trigger post_photos_limit
  before insert on public.post_photos
  for each row execute function public.enforce_post_photo_limit();

alter table public.post_photos enable row level security;

drop policy if exists "read post photos" on public.post_photos;
create policy "read post photos" on public.post_photos for select using (true);

drop policy if exists "insert own post photo" on public.post_photos;
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

drop policy if exists "update own post photo" on public.post_photos;
create policy "update own post photo" on public.post_photos for update to authenticated
  using (author_id = auth.uid())
  with check (
    author_id = auth.uid()
    and path like auth.uid()::text || '/%'
    and path not like '%..%'
    and path not like '%/%/%'
  );

drop policy if exists "delete own or admin post photo" on public.post_photos;
create policy "delete own or admin post photo" on public.post_photos for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

revoke update on public.post_photos from anon, authenticated;
grant update (position) on public.post_photos to authenticated;

-- Reorder is one transaction so a failed swap cannot leave two photos on the same step.
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

grant execute on function public.reorder_post_photos(uuid, uuid[]) to authenticated;

-- ───────── Usernames ─────────
create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));

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

grant execute on function public.username_available(text) to anon, authenticated;

-- ───────── Storage: public post-photos bucket ─────────
insert into storage.buckets (id, name, public)
values ('post-photos', 'post-photos', true)
on conflict (id) do update set public = true;

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'post-photos';

drop policy if exists "public read post photos" on storage.objects;
create policy "public read post photos" on storage.objects for select
  using (bucket_id = 'post-photos');

drop policy if exists "users upload own post photos" on storage.objects;
create policy "users upload own post photos" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users update own post photos" on storage.objects;
create policy "users update own post photos" on storage.objects for update to authenticated
  using (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users delete own post photos" on storage.objects;
create policy "users delete own post photos" on storage.objects for delete to authenticated
  using (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "admin delete post photo objects" on storage.objects;
create policy "admin delete post photo objects" on storage.objects for delete to authenticated
  using (bucket_id = 'post-photos' and public.is_admin());
