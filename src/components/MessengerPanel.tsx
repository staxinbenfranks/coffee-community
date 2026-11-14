"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { DOCK_TOPIC, chatError, fetchInbox, personName, presenceTopic, resolveStatus, type Buddy, type InboxRoom } from "@/lib/chat";
import type { PresenceStatus } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import Avatar from "./Avatar";

type Me = { id: string; username: string; display_name: string | null; avatar_url: string | null };

const STATUS_LABEL: Record<PresenceStatus, string> = {
  online: "Online",
  away: "Away",
  offline: "Offline",
};

function dockOpen() {
  return window.sessionStorage.getItem("chat-dock") === "open";
}

function subscribeDock(onStoreChange: () => void) {
  window.addEventListener("chat-dock", onStoreChange);
  return () => window.removeEventListener("chat-dock", onStoreChange);
}

export default function MessengerPanel({
  me,
  initialBuddies,
  initialRooms,
  initialError,
}: {
  me: Me;
  initialBuddies: Buddy[];
  initialRooms: InboxRoom[];
  initialError: string | null;
}) {
  const router = useRouter();
  const path = usePathname();
  const inThread = /^\/messages\/[^/]+$/.test(path);
  const open = useSyncExternalStore(subscribeDock, dockOpen, () => false);
  const [buddies, setBuddies] = useState(initialBuddies);
  const [rooms, setRooms] = useState(initialRooms);
  const [presence, setPresence] = useState<Record<string, PresenceStatus | undefined>>({});
  const [away, setAway] = useState(false);
  const [username, setUsername] = useState("");
  const [error, setError] = useState(initialError ?? "");
  const [busy, setBusy] = useState(false);
  const selfChannel = useRef<RealtimeChannel | null>(null);
  const [serverInbox, setServerInbox] = useState({ buddies: initialBuddies, rooms: initialRooms, error: initialError });
  if (serverInbox.buddies !== initialBuddies || serverInbox.rooms !== initialRooms || serverInbox.error !== initialError) {
    setServerInbox({ buddies: initialBuddies, rooms: initialRooms, error: initialError });
    setBuddies(initialBuddies);
    setRooms(initialRooms);
    if (initialError) setError(initialError);
  }

  function setDock(next: boolean) {
    window.sessionStorage.setItem("chat-dock", next ? "open" : "closed");
    window.dispatchEvent(new Event("chat-dock"));
  }

  const buddyKey = buddies.map((buddy) => buddy.id).sort().join(",");

  useEffect(() => {
    const supabase = createClient();
    let stopped = false;
    const channels: RealtimeChannel[] = [];

    const publish = (userId: string, channel: RealtimeChannel) => {
      const state = channel.presenceState() as Record<string, { status?: string }[]>;
      const status = state[userId]?.find((meta) => meta.status === "online" || meta.status === "away")?.status as PresenceStatus | undefined;
      setPresence((prev) => {
        if (status) return prev[userId] === status ? prev : { ...prev, [userId]: status };
        if (!prev[userId]) return prev;
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    };

    const current = (): PresenceStatus => (document.hidden || away ? "away" : "online");

    const self = supabase.channel(presenceTopic(me.id), {
      config: { private: true, presence: { key: me.id } },
    });
    selfChannel.current = self;
    self.on("presence", { event: "sync" }, () => publish(me.id, self));
    self.subscribe(async (status) => {
      if (status === "SUBSCRIBED" && !stopped) await self.track({ status: current() });
    });
    channels.push(self);

    for (const id of buddyKey ? buddyKey.split(",") : []) {
      const channel = supabase.channel(presenceTopic(id), {
        config: { private: true, presence: { key: id } },
      });
      channel.on("presence", { event: "sync" }, () => publish(id, channel));
      channel.subscribe();
      channels.push(channel);
    }

    void supabase.schema("chat").rpc("touch_status", { p_status: current() });
    const beat = window.setInterval(() => {
      const status = current();
      void supabase.schema("chat").rpc("touch_status", { p_status: status });
      void self.track({ status });
    }, 30000);

    const onVis = () => {
      const status = current();
      void self.track({ status });
      void supabase.schema("chat").rpc("touch_status", { p_status: status });
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(beat);
      selfChannel.current = null;
      for (const channel of channels) supabase.removeChannel(channel);
    };
  }, [me.id, buddyKey, away]);

  useEffect(() => {
    const supabase = createClient();
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const next = await fetchInbox(supabase, me.id);
        if (next.error) return;
        setBuddies(next.buddies);
        setRooms(next.rooms);
      }, 300);
    };
    const channel = supabase
      .channel(DOCK_TOPIC, { config: { private: true } })
      .on("postgres_changes", { event: "*", schema: "chat", table: "messages" }, schedule)
      .on("postgres_changes", { event: "*", schema: "chat", table: "user_status" }, schedule)
      .on("postgres_changes", { event: "*", schema: "chat", table: "buddies", filter: `owner_id=eq.${me.id}` }, schedule)
      .on("postgres_changes", { event: "*", schema: "chat", table: "room_members", filter: `user_id=eq.${me.id}` }, schedule)
      .subscribe();
    return () => {
      window.clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [me.id]);

  const shown = useMemo(
    () => buddies.map((buddy) => ({ ...buddy, status: resolveStatus(presence[buddy.id], buddy) })).sort(byStatus),
    [buddies, presence],
  );
  const unread = rooms.reduce((sum, room) => sum + room.unread, 0);
  const online = shown.filter((buddy) => buddy.status === "online").length;

  async function addBuddy(e: React.FormEvent) {
    e.preventDefault();
    const name = username.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    const { error: addError } = await createClient().schema("chat").rpc("add_buddy", { p_username: name });
    setBusy(false);
    if (addError) {
      setError(chatError(addError.message));
      return;
    }
    setUsername("");
    const next = await fetchInbox(createClient(), me.id);
    if (!next.error) {
      setBuddies(next.buddies);
      setRooms(next.rooms);
    }
    router.refresh();
  }

  async function openBuddy(name: string) {
    setError("");
    const { data, error: dmError } = await createClient().schema("chat").rpc("start_dm", { p_username: name });
    if (dmError || !data) {
      setError(chatError(dmError?.message ?? "Could not open a conversation."));
      return;
    }
    setDock(false);
    router.push(`/messages/${data}`);
  }

  return (
    <aside className={`fixed inset-x-0 bottom-0 z-30 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-80 ${inThread ? "hidden sm:block" : ""}`} style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      {open ? (
        <div className="flex h-[min(70dvh,32rem)] flex-col border-t border-stone-300 bg-[#faf7f2] shadow-xl sm:rounded-2xl sm:border">
          <header className="flex items-center gap-2 border-b border-stone-200 px-3 py-2">
            <h2 className="font-semibold text-amber-950">Buddies</h2>
            <button
              type="button"
              onClick={() => setAway((value) => !value)}
              className="min-h-11 rounded-full px-2 text-xs font-medium text-stone-600"
              aria-pressed={away}
            >
              {away ? "Set online" : "Set away"}
            </button>
            <button type="button" onClick={() => setDock(false)} className="ml-auto min-h-11 px-2 text-sm text-stone-500" aria-label="Close buddies">
              Close
            </button>
          </header>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Buddies</h3>
              {shown.length === 0 ? <p className="mt-1 text-sm text-stone-500">Add someone by username.</p> : null}
              <ul className="mt-1">
                {shown.map((buddy) => (
                  <li key={buddy.id}>
                    <button type="button" onClick={() => void openBuddy(buddy.username)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left hover:bg-white">
                      <StatusDot status={buddy.status} />
                      <Avatar url={buddy.avatar_url} name={personName(buddy)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{personName(buddy)}</span>
                        <span className="block truncate text-xs text-stone-500">
                          {buddy.status === "offline" && buddy.last_seen ? `Last seen ${timeAgo(buddy.last_seen)}` : STATUS_LABEL[buddy.status]}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Chats</h3>
              {rooms.length === 0 ? <p className="mt-1 text-sm text-stone-500">Join a cafe or message a buddy.</p> : null}
              <ul className="mt-1">
                {rooms.map((room) => (
                  <li key={room.id}>
                    <Link href={`/messages/${room.id}`} onClick={() => setDock(false)} className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-1 hover:bg-white">
                      <span className="min-w-0 truncate text-sm">{room.title}</span>
                      {room.unread > 0 ? <span className="rounded-full bg-amber-900 px-2 py-0.5 text-xs font-medium text-white">{room.unread}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            <form onSubmit={(e) => void addBuddy(e)} className="flex gap-2">
              <label className="sr-only" htmlFor="add-buddy">Add buddy by username</label>
              <input
                id="add-buddy"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="username"
                autoCapitalize="none"
                autoCorrect="off"
                className="min-h-11 min-w-0 flex-1 rounded-full border border-stone-300 bg-white px-3"
              />
              <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-amber-900 px-3 text-sm font-medium text-white disabled:opacity-50">Add</button>
            </form>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
          </div>
        </div>
      ) : (
        <div className="flex justify-center sm:justify-end">
          <button
            type="button"
            onClick={() => setDock(true)}
            aria-expanded={false}
            className="mb-2 flex min-h-11 items-center gap-2 rounded-full border border-stone-300 bg-white px-4 text-sm font-medium shadow-lg"
          >
            <span className="text-amber-950">Buddies</span>
            <span className="text-stone-500">{online} online</span>
            {unread > 0 ? <span className="rounded-full bg-amber-900 px-2 py-0.5 text-xs text-white">{unread}</span> : null}
          </button>
        </div>
      )}
    </aside>
  );
}

function StatusDot({ status }: { status: PresenceStatus }) {
  const color = status === "online" ? "bg-green-500" : status === "away" ? "bg-amber-400" : "bg-stone-300";
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${color}`} aria-label={STATUS_LABEL[status]} />;
}

function byStatus(a: Buddy, b: Buddy) {
  const rank: Record<PresenceStatus, number> = { online: 0, away: 1, offline: 2 };
  return rank[a.status] - rank[b.status] || personName(a).localeCompare(personName(b));
}
