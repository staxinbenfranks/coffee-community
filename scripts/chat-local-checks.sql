-- LOCAL ONLY. Runs after scripts/chat-local-stub.sql and two applications of 003_chat.sql.
-- Do not run this against the hosted project.

create schema if not exists test;
create or replace function test.expect(ok boolean, msg text)
returns void
language plpgsql
as $$
begin
  if not ok then
    raise exception 'FAIL: %', msg;
  end if;
  raise notice 'ok: %', msg;
end $$;
grant usage on schema test to anon, authenticated;
grant execute on function test.expect(boolean, text) to anon, authenticated;

-- Idempotent objects exist once.
select test.expect(
  (select count(*) from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'chat' and p.polname = 'read rooms as member') = 1,
  'one read-rooms policy after two runs'
);
select test.expect(
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'chat' and tablename = 'messages') = 1,
  'messages published once'
);
select test.expect(
  (select count(*) from pg_policy where polname = 'chat realtime read') = 1,
  'one chat realtime read policy'
);
select test.expect(
  (select count(*) from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'chat'
     and (p.prosrc ilike '%public.cafes%'
       or p.prosrc ilike '%public.posts%'
       or p.prosrc ilike '%public.comments%'
       or p.prosrc ilike '%public.communities%')) = 0,
  'chat functions do not reference coffee tables'
);
select test.expect(
  (select indexdef from pg_indexes
    where schemaname = 'chat' and indexname = 'messages_room_created_idx')
    ilike '%(room_id, created_at DESC)%',
  'message pagination index'
);

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'a@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'b@example.com'),
  ('33333333-3333-4333-8333-333333333333', 'c@example.com');

insert into public.profiles (id, username, is_admin) values
  ('11111111-1111-4111-8111-111111111111', 'ada', true),
  ('22222222-2222-4222-8222-222222222222', 'bob', false),
  ('33333333-3333-4333-8333-333333333333', 'cam', false);

insert into public.cafes (id, name, slug) values
  ('44444444-4444-4444-8444-444444444444', 'Test Cafe', 'test-cafe');

insert into public.communities (id, name, slug, cafe_id) values
  ('55555555-5555-4555-8555-555555555555', 'Test Cafe', 'cafe-test-cafe', '44444444-4444-4444-8444-444444444444');

insert into public.communities (id, name, slug) values
  ('66666666-6666-4666-8666-666666666666', 'LA Coffee', 'la-coffee');

select test.expect(
  (select count(*) from chat.rooms where context_type = 'community') = 2,
  'a room was created per community'
);

create temp table fixture_ids as
select id as cafe_room from chat.rooms where context_id = '55555555-5555-4555-8555-555555555555';
grant select on fixture_ids to authenticated;

-- Ada joins the cafe and can post. Bob cannot see it yet.
begin;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;
insert into public.cafe_memberships (cafe_id, user_id)
values ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111');
insert into chat.messages (room_id, sender_id, body)
select id, '11111111-1111-4111-8111-111111111111', 'hello from ada'
from chat.rooms where context_id = '55555555-5555-4555-8555-555555555555';
select test.expect((select count(*) from chat.messages) = 1, 'ada sees her message');
commit;

begin;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
set local role authenticated;
select test.expect((select count(*) from chat.rooms) = 0, 'bob cannot see the cafe room');
select test.expect((select count(*) from chat.messages) = 0, 'bob cannot read cafe messages');
do $$
begin
  begin
    insert into chat.messages (room_id, sender_id, body)
    select cafe_room, auth.uid(), 'sneak' from fixture_ids;
    raise exception 'bob insert should not succeed';
  exception
    when insufficient_privilege or check_violation then
      null;
  end;
end $$;
rollback;

-- Bob joins, both can read, bob cannot delete ada's message, ada (admin) can.
begin;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
set local role authenticated;
insert into public.cafe_memberships (cafe_id, user_id)
values ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222');
select test.expect((select count(*) from chat.messages) = 1, 'bob can read after joining');
do $$
declare n int;
begin
  update chat.messages set deleted_at = now(), body = '' where sender_id <> auth.uid();
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'bob deleted % messages', n;
  end if;
end $$;
commit;

begin;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;
update chat.messages set deleted_at = now(), body = '' where body = 'hello from ada';
select test.expect(
  (select body = '' and deleted_at is not null from chat.messages),
  'admin member soft-deleted the message and the body was blanked'
);
commit;

-- Cam is a member but not an admin, and cannot delete bob's new message.
begin;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
set local role authenticated;
insert into public.cafe_memberships (cafe_id, user_id)
values ('44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333');
commit;

begin;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
set local role authenticated;
insert into chat.messages (room_id, sender_id, body)
select r.id, auth.uid(), 'from bob'
from chat.rooms r where r.context_id = '55555555-5555-4555-8555-555555555555';
update chat.messages set body = 'from bob, edited' where body = 'from bob';
select test.expect(
  (select edited_at is not null from chat.messages where body = 'from bob, edited'),
  'editing sets edited_at'
);
commit;

begin;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
set local role authenticated;
do $$
declare n int;
begin
  update chat.messages set deleted_at = now(), body = '' where body = 'from bob, edited';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'non-admin deleted someone else''s message';
  end if;
end $$;
select test.expect((select count(*) from chat.messages where body = 'from bob, edited') = 1, 'bob''s message survived');
commit;

-- DM: exactly two members, same room on the second call, third insert fails.
begin;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;
select test.expect(chat.start_dm('BOB') = chat.start_dm('bob'), 'start_dm is case-insensitive and stable');
select test.expect(
  (select count(*) from chat.room_members rm
    join chat.rooms r on r.id = rm.room_id
   where r.kind = 'dm') = 2,
  'DM has exactly two members'
);
do $$
begin
  perform chat.start_dm('ada');
  raise exception 'self DM should fail';
exception when others then
  if sqlerrm not ilike '%yourself%' then
    raise;
  end if;
end $$;
commit;

do $$
declare room uuid;
begin
  select id into room from chat.rooms where kind = 'dm';
  begin
    insert into chat.room_members (room_id, user_id)
    values (room, '33333333-3333-4333-8333-333333333333');
    raise exception 'third DM member was inserted';
  exception when others then
    if sqlerrm not ilike '%exactly 2%' then
      raise;
    end if;
  end;
end $$;
select test.expect(true, 'third DM member was rejected');

-- Block stops a new DM and stops sends in an existing one. History stays readable.
begin;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
set local role authenticated;
select chat.block_user('bob');
reset role;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
set local role authenticated;
do $$
begin
  perform chat.start_dm('cam');
  raise exception 'blocked start_dm should fail';
exception when others then
  if sqlerrm not ilike '%cannot message%' then
    raise;
  end if;
end $$;
rollback;

begin;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;
select chat.block_user('bob');
do $$
begin
  insert into chat.messages (room_id, sender_id, body)
  select r.id, auth.uid(), 'after block'
  from chat.rooms r where r.kind = 'dm';
  raise exception 'blocked DM send should fail';
exception when insufficient_privilege or check_violation then
  null;
end $$;
select test.expect((select count(*) from chat.rooms where kind = 'dm') = 1, 'blocker can still see the DM');
commit;

begin;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
set local role authenticated;
select test.expect((select count(*) from chat.rooms where kind = 'dm') = 1, 'blocked user can still read the DM');
do $$
begin
  insert into chat.messages (room_id, sender_id, body)
  select r.id, auth.uid(), 'bob after block'
  from chat.rooms r where r.kind = 'dm';
  raise exception 'blocked user send should fail';
exception when insufficient_privilege or check_violation then
  null;
end $$;
commit;

-- Buddies are private. General-community join works; cafe communities refuse it.
begin;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;
select chat.add_buddy('bob');
select test.expect((select count(*) from chat.buddies) = 1, 'ada sees her buddy');
select public.join_community_chat('66666666-6666-4666-8666-666666666666');
select test.expect(
  (select count(*) from chat.room_members rm
    join chat.rooms r on r.id = rm.room_id
   where r.context_id = '66666666-6666-4666-8666-666666666666' and rm.user_id = auth.uid()) = 1,
  'ada joined the general community chat'
);
do $$
begin
  perform public.join_community_chat('55555555-5555-4555-8555-555555555555');
  raise exception 'cafe community join_community_chat should fail';
exception when others then
  if sqlerrm not ilike '%Join the cafe%' then
    raise;
  end if;
end $$;
select chat.touch_status('online');
select test.expect((select status = 'online' from chat.user_status where user_id = auth.uid()), 'status saved');
commit;

begin;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
set local role authenticated;
select test.expect((select count(*) from chat.buddies) = 0, 'bob cannot see ada''s buddy list');
select test.expect(
  (select count(*) from chat.user_status) = 0,
  'bob cannot read ada''s status without adding her'
);
select chat.add_buddy('ada');
select test.expect((select count(*) from chat.user_status) = 1, 'a buddy can read last_seen');
commit;

-- Leaving the cafe drops the chat membership and keeps the messages.
begin;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
set local role authenticated;
delete from public.cafe_memberships
where cafe_id = '44444444-4444-4444-8444-444444444444' and user_id = auth.uid();
select test.expect(
  (select count(*) from chat.room_members rm
    join chat.rooms r on r.id = rm.room_id
   where r.context_id = '55555555-5555-4555-8555-555555555555' and rm.user_id = auth.uid()) = 0,
  'leaving the cafe leaves the chat room'
);
commit;

select test.expect(
  (select count(*) from chat.messages where body = 'from bob, edited') = 1,
  'leaving did not delete messages'
);

-- Unread ignores your own messages and messages from before last_read_at.
begin;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;
select chat.mark_read(id) from chat.rooms where context_id = '55555555-5555-4555-8555-555555555555';
select test.expect(
  (select count(*) from chat.unread_counts()) = 0,
  'mark_read clears unread'
);
commit;

-- Realtime policies evaluate without throwing.
begin;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.realtime_topic', 'chat-room:55555555-5555-4555-8555-555555555555', true);
set local role authenticated;
select test.expect((select count(*) from realtime.messages) = 0, 'member room topic policy runs');
commit;

begin;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claim.realtime_topic', 'chat-room:not-a-uuid', true);
set local role authenticated;
select test.expect((select count(*) from realtime.messages) = 0, 'bad room topic does not throw');
commit;

-- Anon has no table privileges.
do $$
begin
  execute 'set local role anon';
  begin
    perform 1 from chat.messages;
    raise exception 'anon should not read messages';
  exception
    when insufficient_privilege then
      null;
  end;
  execute 'reset role';
end $$;
select test.expect(true, 'anon cannot read chat.messages');

-- Sentinel used by the shell script to prove a third run deletes nothing.
insert into chat.messages (room_id, sender_id, body)
select id, '11111111-1111-4111-8111-111111111111', 'sentinel-keep'
from chat.rooms where context_id = '55555555-5555-4555-8555-555555555555';
