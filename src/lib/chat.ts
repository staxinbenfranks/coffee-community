import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage, ChatPerson, PresenceStatus } from "@/lib/types";

export const MESSAGE_MAX = 2000;
export const MESSAGE_COLUMNS = "id, room_id, sender_id, body, created_at, edited_at, deleted_at";
export const DOCK_TOPIC = "chat-dock";
const RECENT_STATUS_MS = 60_000;

export type Buddy = ChatPerson & {
  status: PresenceStatus;
  stored_status: PresenceStatus;
  last_seen: string | null;
};

export type InboxRoom = {
  id: string;
  kind: "group" | "dm";
  title: string;
  context_type: string | null;
  context_id: string | null;
  unread: number;
  peer: ChatPerson | null;
};

export type RoomBundle = {
  id: string;
  kind: "group" | "dm";
  title: string;
  context_type: string | null;
  context_id: string | null;
  messages: ChatMessage[];
  authors: Record<string, ChatPerson>;
  peer: ChatPerson | null;
  blocked: boolean;
  canModerate: boolean;
  hasMore: boolean;
};

export function presenceTopic(userId: string) {
  return `chat:presence:${userId}`;
}

export function roomTopic(roomId: string) {
  return `chat-room:${roomId}`;
}

export function personName(person: { display_name?: string | null; username?: string | null } | null | undefined) {
  const display = person?.display_name?.trim();
  if (display) return display;
  if (person?.username) return person.username;
  return "Someone";
}

export function resolveStatus(
  presence: string | undefined,
  stored: { status?: string | null; last_seen?: string | null } | undefined,
  now = Date.now(),
): PresenceStatus {
  if (presence === "online" || presence === "away") return presence;
  if (!stored?.last_seen || (stored.status !== "online" && stored.status !== "away")) return "offline";
  const age = now - new Date(stored.last_seen).getTime();
  if (Number.isFinite(age) && age >= 0 && age < RECENT_STATUS_MS) return stored.status;
  return "offline";
}

export function chatError(message: string): string {
  if (/row-level security|permission denied/i.test(message)) return "You don't have permission to do that.";
  if (/message is empty/i.test(message)) return "Write a message first.";
  if (/too long/i.test(message)) return "That message is too long (2,000 characters max).";
  if (/cannot message this person/i.test(message)) return "You can't message this person.";
  if (/cannot message yourself/i.test(message)) return "You can't message yourself.";
  if (/cannot add yourself/i.test(message)) return "You can't add yourself.";
  if (/cannot block yourself/i.test(message)) return "You can't block yourself.";
  if (/no one uses that username/i.test(message)) return "No one uses that username.";
  if (/join the cafe/i.test(message)) return "Join the cafe to enter this chat.";
  return message;
}

function asPerson(row: { id: string; username: string; display_name: string | null; avatar_url: string | null }): ChatPerson {
  return { id: row.id, username: row.username, display_name: row.display_name, avatar_url: row.avatar_url };
}

export async function fetchInbox(supabase: SupabaseClient, userId: string): Promise<{ buddies: Buddy[]; rooms: InboxRoom[]; error: string | null }> {
  const chat = supabase.schema("chat");
  const [buddyRes, memberRes, unreadRes] = await Promise.all([
    chat.from("buddies").select("buddy_id").eq("owner_id", userId),
    chat.from("room_members").select("room_id").eq("user_id", userId),
    chat.rpc("unread_counts"),
  ]);
  const failed = buddyRes.error ?? memberRes.error ?? unreadRes.error;
  if (failed) return { buddies: [], rooms: [], error: failed.message };

  const buddyIds = ((buddyRes.data ?? []) as { buddy_id: string }[]).map((row) => row.buddy_id);
  const roomIds = ((memberRes.data ?? []) as { room_id: string }[]).map((row) => row.room_id);
  const unread = new Map<string, number>();
  for (const row of (unreadRes.data ?? []) as { room_id: string; unread: number | string }[]) {
    unread.set(row.room_id, Number(row.unread));
  }

  const [roomRes, peopleRes, statusRes] = await Promise.all([
    roomIds.length
      ? chat.from("rooms").select("id, kind, title, context_type, context_id").in("id", roomIds)
      : Promise.resolve({ data: [] as RoomRow[], error: null }),
    buddyIds.length
      ? supabase.from("profiles").select("id, username, display_name, avatar_url").in("id", buddyIds)
      : Promise.resolve({ data: [] as ProfileRow[], error: null }),
    buddyIds.length
      ? chat.from("user_status").select("user_id, status, last_seen").in("user_id", buddyIds)
      : Promise.resolve({ data: [] as StatusRow[], error: null }),
  ]);
  const second = roomRes.error ?? peopleRes.error ?? statusRes.error;
  if (second) return { buddies: [], rooms: [], error: second.message };

  const roomRows = (roomRes.data ?? []) as RoomRow[];
  const dmIds = roomRows.filter((room) => room.kind === "dm").map((room) => room.id);
  const peerRes = dmIds.length
    ? await chat.from("room_members").select("room_id, user_id").in("room_id", dmIds).neq("user_id", userId)
    : { data: [] as { room_id: string; user_id: string }[], error: null };
  if (peerRes.error) return { buddies: [], rooms: [], error: peerRes.error.message };

  const peerByRoom = new Map<string, string>();
  for (const row of (peerRes.data ?? []) as { room_id: string; user_id: string }[]) {
    peerByRoom.set(row.room_id, row.user_id);
  }
  const known = new Map<string, ChatPerson>();
  for (const row of (peopleRes.data ?? []) as ProfileRow[]) known.set(row.id, asPerson(row));
  const missingPeers = [...new Set([...peerByRoom.values()].filter((id) => !known.has(id)))];
  if (missingPeers.length) {
    const { data, error } = await supabase.from("profiles").select("id, username, display_name, avatar_url").in("id", missingPeers);
    if (error) return { buddies: [], rooms: [], error: error.message };
    for (const row of (data ?? []) as ProfileRow[]) known.set(row.id, asPerson(row));
  }

  const statusByUser = new Map<string, StatusRow>();
  for (const row of (statusRes.data ?? []) as StatusRow[]) statusByUser.set(row.user_id, row);
  const now = Date.now();
  const buddies = buddyIds
    .map((id) => {
      const person = known.get(id);
      if (!person) return null;
      const stored = statusByUser.get(id);
      const storedStatus: PresenceStatus = stored?.status === "online" || stored?.status === "away" ? stored.status : "offline";
      return {
        ...person,
        stored_status: storedStatus,
        last_seen: stored?.last_seen ?? null,
        status: resolveStatus(undefined, { status: storedStatus, last_seen: stored?.last_seen }, now),
      } satisfies Buddy;
    })
    .filter((row): row is Buddy => row !== null)
    .sort(compareBuddies);

  const rooms = roomRows
    .map((room) => {
      const peerId = peerByRoom.get(room.id);
      const peer = peerId ? known.get(peerId) ?? null : null;
      const title = room.kind === "dm" ? personName(peer) : (room.title ?? "Chat");
      return {
        id: room.id,
        kind: room.kind,
        title,
        context_type: room.context_type,
        context_id: room.context_id,
        unread: unread.get(room.id) ?? 0,
        peer,
      } satisfies InboxRoom;
    })
    .sort((a, b) => b.unread - a.unread || a.title.localeCompare(b.title));

  return { buddies, rooms, error: null };
}

export async function loadRoom(
  supabase: SupabaseClient,
  roomId: string,
  userId: string,
  isAdmin: boolean,
): Promise<{ bundle: RoomBundle | null; error: string | null }> {
  const chat = supabase.schema("chat");
  const { data, error } = await chat
    .from("rooms")
    .select("id, kind, title, context_type, context_id")
    .eq("id", roomId)
    .maybeSingle();
  if (error) return { bundle: null, error: error.message };
  const room = data as RoomRow | null;
  if (!room) return { bundle: null, error: null };

  const [messageRes, selfRes, peerRes, blockedRes] = await Promise.all([
    chat.from("messages").select(MESSAGE_COLUMNS).eq("room_id", roomId).order("created_at", { ascending: false }).limit(50),
    chat.from("room_members").select("role").eq("room_id", roomId).eq("user_id", userId).maybeSingle(),
    room.kind === "dm"
      ? chat.from("room_members").select("user_id").eq("room_id", roomId).neq("user_id", userId).limit(1)
      : Promise.resolve({ data: [] as { user_id: string }[], error: null }),
    chat.rpc("dm_blocked", { p_room_id: roomId }),
  ]);
  const failed = messageRes.error ?? selfRes.error ?? peerRes.error ?? blockedRes.error;
  if (failed) return { bundle: null, error: failed.message };

  const descending = (messageRes.data ?? []) as ChatMessage[];
  const messages = descending.slice().reverse();
  const senderIds = [...new Set(messages.map((message) => message.sender_id).filter((id): id is string => !!id))];
  const peerId = ((peerRes.data ?? []) as { user_id: string }[])[0]?.user_id ?? null;
  const profileIds = [...new Set([...senderIds, ...(peerId ? [peerId] : [])])];
  const authors: Record<string, ChatPerson> = {};
  if (profileIds.length) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .in("id", profileIds);
    if (profileError) return { bundle: null, error: profileError.message };
    for (const row of (profiles ?? []) as ProfileRow[]) authors[row.id] = asPerson(row);
  }

  const role = (selfRes.data as { role: string } | null)?.role;
  const peer = peerId ? authors[peerId] ?? null : null;
  return {
    error: null,
    bundle: {
      id: room.id,
      kind: room.kind,
      title: room.kind === "dm" ? personName(peer) : (room.title ?? "Chat"),
      context_type: room.context_type,
      context_id: room.context_id,
      messages,
      authors,
      peer,
      blocked: blockedRes.data === true,
      canModerate: role === "moderator" || isAdmin,
      hasMore: descending.length === 50,
    },
  };
}

function compareBuddies(a: Buddy, b: Buddy) {
  const rank: Record<PresenceStatus, number> = { online: 0, away: 1, offline: 2 };
  return rank[a.status] - rank[b.status] || personName(a).localeCompare(personName(b));
}

type RoomRow = {
  id: string;
  kind: "group" | "dm";
  title: string | null;
  context_type: string | null;
  context_id: string | null;
};

type ProfileRow = ChatPerson;

type StatusRow = {
  user_id: string;
  status: string;
  last_seen: string;
};
