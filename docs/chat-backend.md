# Chat backend

Shared by the LA Coffee web app and a later iOS/Android app on the same Supabase project (`rrggopsymaurnvdpjxnc`). Both clients use the anon key plus the signed-in user's access token. Neither client uses the service-role key.

The chat tables are generic. Coffee-specific behavior (who is a member of a cafe) stays in `public`.

## Schemas

| Schema | What it is |
| --- | --- |
| `chat` | Rooms, members, messages, buddies, blocks, last-seen. No foreign keys to cafes, posts, or communities. |
| `public` | `cafe_memberships`, plus the triggers and RPCs that open or close a community's room when someone joins or leaves. |

`chat` is not exposed by default. After the migration, add it under **Settings → API → Exposed schemas** (keep `public`). Until you do, `.schema('chat')` returns a schema error.

Grants:

- `anon` and `authenticated` get `USAGE` on schema `chat`.
- `anon` gets no table privileges. Logged-out clients cannot read messages.
- `authenticated` gets the column grants listed below. Row level security still applies.
- `service_role` is granted for Supabase internals. Do not put that key in a client.

## Tables

### `chat.rooms`

| Column | Notes |
| --- | --- |
| `id` | uuid primary key |
| `kind` | `group` or `dm` |
| `slug` | unique. Group rooms use `community:<community uuid>`. DMs use `dm:<smaller uuid>:<larger uuid>`. Clients should not invent slugs; call `start_dm`. |
| `title` | Group room title (community name). Null for DMs; show the other person's name. |
| `created_by` | Profile id, null for rooms the database created. |
| `context_type`, `context_id` | Optional link for the host app. Coffee uses `context_type = 'community'` and the community's id. Both null, or both set. There is no foreign key, so chat does not depend on coffee tables. |
| `created_at` | |

One room per `(context_type, context_id)`.

### `chat.room_members`

| Column | Notes |
| --- | --- |
| `room_id`, `user_id` | Primary key. `user_id` is `public.profiles.id` (the auth user id). |
| `role` | `member` or `moderator`. |
| `joined_at` | |
| `last_read_at` | Defaults to join time, so old history is not unread. The only column `authenticated` may update. |

Clients cannot insert or delete membership rows. `chat.start_dm` and the public cafe/community functions do that.

A DM cannot have a third member. A before-insert trigger raises `DM rooms have exactly 2 members`.

### `chat.messages`

| Column | Notes |
| --- | --- |
| `id`, `room_id`, `sender_id` | `sender_id` becomes null if that profile is deleted. |
| `body` | 1–2000 characters. Blanked to `''` when soft-deleted. |
| `created_at`, `edited_at`, `deleted_at` | `edited_at` is set by a trigger when `body` changes. |

Index for pagination: `messages_room_created_idx` on `(room_id, created_at desc)`.

Load a page with the newest 50, then older pages with `created_at < <oldest>`:

```js
supabase.schema('chat').from('messages')
  .select('id, room_id, sender_id, body, created_at, edited_at, deleted_at')
  .eq('room_id', roomId)
  .order('created_at', { ascending: false })
  .limit(50)
```

`authenticated` may insert `(room_id, sender_id, body)` and update `(body, deleted_at)`. There is no delete grant. Soft-delete is an update that sets `deleted_at` and `body` to `''`.

### `chat.buddies`

One-way, like an AIM list. `(owner_id, buddy_id)`, owner cannot add themselves. You only see rows you own. Adding someone does not add you to their list.

### `chat.blocks`

`(blocker_id, blocked_id)`. You only see blocks you created. If either person has blocked the other:

- `start_dm` will not create a new room (`You cannot message this person`).
- If the DM already exists, `start_dm` still returns it so either person can read history.
- Inserts into that DM fail for both people. Group/cafe rooms ignore blocks.

### `chat.user_status`

| Column | Notes |
| --- | --- |
| `user_id` | Primary key |
| `status` | `online`, `away`, or `offline`. The only column clients update. |
| `last_seen`, `updated_at` | Set by a trigger whenever `status` is written. |

Readable by you, and by people who have you on their buddy list. Call `chat.touch_status` on a timer (the web app uses 30 seconds) and when the app goes to background.

The web buddy list prefers Realtime Presence. It falls back to `user_status` only when `last_seen` is under 60 seconds old. Match that if you want the same dots.

### `public.cafe_memberships`

| Column | Notes |
| --- | --- |
| `cafe_id`, `user_id` | Primary key |
| `created_at` | |

Anyone can read (member counts and "My cafes"). A signed-in user can insert or delete only their own row. Joining inserts the chat membership for that cafe's community room. Leaving removes it. Messages stay in the room.

## Row level security

Enabled on every chat table and on `cafe_memberships`.

| Action | Who |
| --- | --- |
| Read a room, its members, or its messages | Current members only. `chat.is_member` is security definer so the membership check does not recurse through RLS. |
| Insert a message | `sender_id` is you, you are a member, the message is not already deleted, and `chat.dm_blocked` is false. |
| Edit a message | You, and only while it is not deleted. |
| Soft-delete a message | You, or a member whose role is `moderator`, or a coffee admin (`public.is_admin()`) who has joined that room. Admins do not gain access to DMs they have not joined. `public.is_admin()` reads `profiles` only. |
| Buddies and blocks | Only your own rows. |
| Status | Yours, plus the status of people on your buddy list. |
| Rooms and memberships | No client insert, update (except `last_read_at`), or delete. |

Chat policies do not read `public.cafes`, `public.posts`, `public.comments`, or `public.communities`. The public trigger functions do, and they are the only place that joins a cafe membership to a room.

Security definer functions in `chat` are revoked from `public` and `anon`. `authenticated` gets execute only on the RPCs and the helpers policies need. Each definer function sets `search_path` and uses `auth.uid()`.

## RPCs

Call chat functions with the `chat` schema. Call the three `public` functions on the default schema.

| Function | Who | What it does |
| --- | --- | --- |
| `chat.start_dm(p_username text)` | authenticated | Returns the DM room id for you and that username (3–20 chars, `[a-z0-9_]`, case-insensitive). Creates the room and exactly two members when needed. |
| `chat.add_buddy(p_username text)` | authenticated | Adds them to your list. |
| `chat.remove_buddy(p_username text)` | authenticated | |
| `chat.block_user(p_username text)` | authenticated | |
| `chat.unblock_user(p_username text)` | authenticated | |
| `chat.mark_read(p_room_id uuid)` | authenticated | Sets your `last_read_at` to now. |
| `chat.unread_counts()` | authenticated | `room_id`, `unread` for messages from other people newer than `last_read_at`. |
| `chat.touch_status(p_status text)` | authenticated | `online`, `away`, or `offline`. |
| `chat.dm_blocked(p_room_id uuid)` | authenticated | True only if you are in that DM and a block exists either way. Otherwise false (no probing). |
| `public.join_community_chat(p_community_id uuid)` | authenticated | Joins the room for a community that has **no** cafe (LA Coffee). Cafe communities raise `Join the cafe to enter this chat`. |
| `public.leave_community_chat(p_community_id uuid)` | authenticated | The matching leave. |
| `public.community_member_count(p_community_id uuid)` | anon, authenticated | Count of people in that community's room. |

Joining a cafe is not an RPC. Insert your own `public.cafe_memberships` row. Delete it to leave.

```js
const chat = supabase.schema('chat')
const { data: roomId, error } = await chat.rpc('start_dm', { p_username: 'ada' })
await supabase.from('cafe_memberships').insert({ cafe_id: cafeId, user_id: userId })
```

```bash
curl "$SUPABASE_URL/rest/v1/rpc/start_dm" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $USER_ACCESS_TOKEN" \
  -H "Content-Profile: chat" \
  -H "Content-Type: application/json" \
  -d '{"p_username":"ada"}'
```

Reads use `Accept-Profile: chat`. Writes use `Content-Profile: chat`.

## Realtime

The migration adds these tables to the `supabase_realtime` publication and sets `REPLICA IDENTITY FULL` so updates can be filtered:

- `chat.messages`
- `chat.room_members`
- `chat.buddies`
- `chat.blocks`
- `chat.user_status`
- `public.cafe_memberships`

Postgres Changes only delivers rows the user's RLS policies allow them to `select`. Subscribing to a channel is not enough to read someone else's DMs.

Every channel below is created with `{ config: { private: true } }`. Private channels are enforced only after **Realtime → Settings → Allow public access** is off. Turn that off. Policies on `realtime.messages` (not an `ALTER TABLE` — that table is owned by Realtime) allow:

| Topic | Who can join | Who can publish |
| --- | --- | --- |
| `chat-room:<room uuid>` | Members. Use this for postgres changes on `chat.messages` filtered by `room_id=eq.<room uuid>`. | Nobody (no insert policy). |
| `chat-dock` | Any signed-in user. The web dock listens for message, status, buddy, and membership changes, then refetches. Table RLS still hides other people's rows. | Nobody. |
| `chat:presence:<user uuid>` | That user, and anyone who has them as a buddy. | Only that user. |
| `cafe-members:<cafe uuid>` | Anyone, including logged-out. The membership table is already public. | Nobody. |

Presence track payload: `{ status: "online" }` or `{ status: "away" }`. The presence key is the user's id. Track only on your own topic. Subscribe to each buddy's topic; do not track there.

```js
supabase.channel(`chat-room:${roomId}`, { config: { private: true } })
  .on('postgres_changes', {
    event: '*',
    schema: 'chat',
    table: 'messages',
    filter: `room_id=eq.${roomId}`,
  }, (payload) => { /* payload.new is the message row */ })
  .subscribe()

supabase.channel(`chat:presence:${userId}`, {
  config: { private: true, presence: { key: userId } },
})
  .on('presence', { event: 'sync' }, () => { /* presenceState()[userId] */ })
  .subscribe(async (status) => {
    if (status === 'SUBSCRIBED') await channel.track({ status: 'online' })
  })
```

UUIDs in topics are the lowercase text Postgres uses (`auth.uid()::text`). Soft-delete and edit arrive as `UPDATE`, not `DELETE`.

If a membership is revoked while a socket is still open, Realtime may keep the old authorization until the access token is refreshed. Keep JWT expiry at the project default and refresh the session as usual.

## Second client

1. Supabase URL `https://rrggopsymaurnvdpjxnc.supabase.co` and the anon (publishable) key. Same project as the website.
2. Sign the user in with Supabase Auth. Send the user access token on every request. Do not use the service-role key.
3. Set the schema to `chat` for chat tables and RPCs. Cafe membership and profiles stay on `public`.
4. Use the RPCs above rather than inserting into `chat.rooms` or `chat.room_members`.
5. Subscribe with the topic names in this document and `private: true`.
6. Usernames are stored lowercase, unique case-insensitively, and must match `[a-z0-9_]{3,20}`.

Official clients take a schema option (`schema('chat')` in supabase-js, the equivalent database schema setting in supabase-swift and supabase-kt). The REST headers are `Accept-Profile` and `Content-Profile`.

## Deploy

Do this on the existing project **before** the web app that calls `chat` is deployed. Do not re-run `schema.sql` or migrations 001/002. Do not change Auth settings, email templates, or storage.

1. Supabase → SQL Editor → paste `supabase/migrations/003_chat.sql` → Run. It is safe to run again; it does not delete rows.
2. Settings → API → Exposed schemas → add `chat` next to `public` → Save.
3. Database → Publications → `supabase_realtime` includes `chat.messages`, `chat.room_members`, `chat.buddies`, `chat.blocks`, `chat.user_status`, and `public.cafe_memberships`. The migration adds them. Confirm, and toggle any that are missing.
4. Realtime → Settings → turn **Allow public access** off so the private channel policies above are actually enforced.
5. Deploy the app. It keeps using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` only.

Fresh installs run `supabase/schema.sql` (chat is included) and then `supabase/seed.sql`, then do steps 2–4. Each seeded cafe gets a community and a group room from the triggers.

## Manual test plan

Two browsers, two accounts (A and B). Make A an admin only for the last cafe-chat check (`profiles.is_admin`). Run 003 and expose `chat` first.

1. **Join / leave.** Signed out, the cafe page shows a member count and Join sends you to login. As A, Join on the cafe page. The count goes up, "My cafes" on A's profile lists it, and the chat box appears. Join on the cafe's `/c/cafe-…` page is the same membership (Leave there removes it). B, who has not joined, cannot see messages. Leaving removes B from the room; old messages are still there when B joins again.
2. **General community.** On `/c/la-coffee`, Join / Leave enters that chat only. Join on a cafe community does not call this path.
3. **Group chat.** A and B both joined: each can send, see the other's message without a refresh, edit their own, and soft-delete their own ("Message deleted", empty body). A cannot delete B's message unless A is an admin who has joined. A non-member who guesses the room URL gets "Conversation unavailable".
4. **DMs.** On B's profile, A taps Message and lands in a thread. B sees it under Messages and in the buddy-list Chats with an unread count. Opening the thread clears the unread count. Message yourself fails. A second Message tap opens the same room, not a second one.
5. **Buddies and presence.** A adds B by username from the Buddies panel (and from B's profile). B shows online while B's tab is open, away after B taps "Set away" or hides the tab, and offline after B closes the tab, with a last-seen time. Remove buddy takes B off the list. A is not on B's list unless B adds A.
6. **Blocks.** A blocks B. B cannot start a new DM with A. In an existing DM, neither can send; both can still read history. A unblocks from the profile page. Sending works again.
7. **Phone width.** The buddy pill sits on the bottom safe area. Opening a thread hides it so the composer is usable. Join, send, and delete are tappable. Inputs do not zoom the page (16px).

## DO NOT TOUCH

- `public` coffee tables other than `cafe_memberships`: `profiles` (except the app's existing profile editor), `cafes`, `communities`, `posts`, `comments`, `post_photos`.
- Storage buckets and storage policies (`avatars`, `cafe-photos`, `post-photos`).
- Auth settings, providers, redirect URLs, and email templates.
- The service-role key. It must not ship in the web app or the mobile app.
- `supabase/migrations/002_photos_comments_usernames.sql`, and any earlier migration already applied on the project (this repo has no `001`). Do not edit or re-run them.
- Do not re-run `supabase/schema.sql` on the project that already has data. Use `003_chat.sql`.
