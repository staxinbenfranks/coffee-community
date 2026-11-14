"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { fullDate, timeAgo } from "@/lib/format";
import { MESSAGE_COLUMNS, MESSAGE_MAX, chatError, personName, roomTopic } from "@/lib/chat";
import type { ChatMessage, ChatPerson } from "@/lib/types";
import Avatar from "./Avatar";

type Me = { id: string; username: string; display_name: string | null; avatar_url: string | null };

export default function ChatRoom({
  roomId,
  me,
  title,
  initialMessages,
  initialAuthors,
  canModerate,
  initiallyBlocked,
  hasMore: initialHasMore,
  variant = "page",
  href,
}: {
  roomId: string;
  me: Me;
  title: string;
  initialMessages: ChatMessage[];
  initialAuthors: Record<string, ChatPerson>;
  canModerate: boolean;
  initiallyBlocked: boolean;
  hasMore: boolean;
  variant?: "page" | "embedded";
  href?: string | null;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [authors, setAuthors] = useState(initialAuthors);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [text, setText] = useState("");
  const [blocked, setBlocked] = useState(initiallyBlocked);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const authorsRef = useRef(authors);
  const [roomKey, setRoomKey] = useState(roomId);
  if (roomKey !== roomId) {
    setRoomKey(roomId);
    setMessages(initialMessages);
    setAuthors(initialAuthors);
    setHasMore(initialHasMore);
    setBlocked(initiallyBlocked);
    setError("");
    setEditingId(null);
    setConfirmId(null);
  }

  useEffect(() => {
    authorsRef.current = authors;
  }, [authors]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const supabase = createClient();
    let gone = false;

    async function remember(senderId: string | null) {
      if (!senderId || authorsRef.current[senderId] || senderId === me.id) return;
      const { data } = await supabase.from("profiles").select("id, username, display_name, avatar_url").eq("id", senderId).maybeSingle();
      if (!data || gone) return;
      setAuthors((prev) => (prev[senderId] ? prev : { ...prev, [senderId]: data as ChatPerson }));
    }

    function apply(row: ChatMessage) {
      if (row.room_id !== roomId) return;
      setMessages((prev) => {
        const index = prev.findIndex((message) => message.id === row.id);
        if (index === -1) return [...prev, row].sort((a, b) => a.created_at.localeCompare(b.created_at));
        const next = prev.slice();
        next[index] = row;
        return next;
      });
      void remember(row.sender_id);
    }

    const channel = supabase
      .channel(roomTopic(roomId), { config: { private: true } })
      .on("postgres_changes", { event: "INSERT", schema: "chat", table: "messages", filter: `room_id=eq.${roomId}` }, (payload) => {
        apply(payload.new as ChatMessage);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "chat", table: "messages", filter: `room_id=eq.${roomId}` }, (payload) => {
        apply(payload.new as ChatMessage);
      })
      .on("postgres_changes", { event: "*", schema: "chat", table: "blocks" }, async () => {
        const { data } = await supabase.schema("chat").rpc("dm_blocked", { p_room_id: roomId });
        if (!gone) setBlocked(data === true);
      })
      .subscribe();

    return () => {
      gone = true;
      supabase.removeChannel(channel);
    };
  }, [roomId, me.id]);

  const latestId = messages.at(-1)?.id;

  useEffect(() => {
    const supabase = createClient();
    const mark = () => {
      if (document.hidden) return;
      void supabase.schema("chat").rpc("mark_read", { p_room_id: roomId });
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [roomId, latestId]);

  async function loadEarlier() {
    const oldest = messages[0]?.created_at;
    if (!oldest) return;
    const supabase = createClient();
    const { data, error: loadError } = await supabase
      .schema("chat")
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("room_id", roomId)
      .lt("created_at", oldest)
      .order("created_at", { ascending: false })
      .limit(50);
    if (loadError) {
      setError(chatError(loadError.message));
      return;
    }
    const older = ((data ?? []) as ChatMessage[]).slice().reverse();
    setHasMore(older.length === 50);
    stick.current = false;
    setMessages((prev) => {
      const seen = new Set(prev.map((message) => message.id));
      return [...older.filter((message) => !seen.has(message.id)), ...prev];
    });
    const missing = [...new Set(older.map((message) => message.sender_id).filter((id): id is string => !!id && !authorsRef.current[id]))];
    if (missing.length) {
      const { data: profiles } = await supabase.from("profiles").select("id, username, display_name, avatar_url").in("id", missing);
      if (profiles) {
        setAuthors((prev) => {
          const next = { ...prev };
          for (const row of profiles as ChatPerson[]) next[row.id] = row;
          return next;
        });
      }
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending || blocked) return;
    setSending(true);
    setError("");
    const supabase = createClient();
    const { data, error: sendError } = await supabase
      .schema("chat")
      .from("messages")
      .insert({ room_id: roomId, sender_id: me.id, body })
      .select(MESSAGE_COLUMNS)
      .single();
    setSending(false);
    if (sendError) {
      setError(chatError(sendError.message));
      if (/permission|row-level security|cannot message/i.test(sendError.message)) setBlocked(true);
      return;
    }
    setText("");
    stick.current = true;
    if (data) {
      setMessages((prev) => (prev.some((message) => message.id === data.id) ? prev : [...prev, data as ChatMessage]));
    }
  }

  async function saveEdit(id: string) {
    const body = draft.trim();
    if (!body) return;
    const supabase = createClient();
    const { data, error: editError } = await supabase.schema("chat").from("messages").update({ body }).eq("id", id).select(MESSAGE_COLUMNS).single();
    if (editError) {
      setError(chatError(editError.message));
      return;
    }
    if (data) setMessages((prev) => prev.map((message) => (message.id === id ? (data as ChatMessage) : message)));
    setEditingId(null);
  }

  async function remove(id: string) {
    const supabase = createClient();
    const { data, error: deleteError } = await supabase
      .schema("chat")
      .from("messages")
      .update({ deleted_at: new Date().toISOString(), body: "" })
      .eq("id", id)
      .select(MESSAGE_COLUMNS)
      .single();
    if (deleteError) {
      setError(chatError(deleteError.message));
      return;
    }
    if (data) setMessages((prev) => prev.map((message) => (message.id === id ? (data as ChatMessage) : message)));
  }

  const frame = variant === "embedded" ? "h-96" : "h-[calc(100dvh-8.5rem)] min-h-80";

  return (
    <section className={`flex ${frame} flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white`}>
      <header className="flex items-center justify-between gap-3 border-b border-stone-200 px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {href ? <Link href={href} className="text-xs text-amber-900">View page</Link> : null}
        </div>
        {variant === "embedded" ? (
          <Link href={`/messages/${roomId}`} className="shrink-0 text-xs font-medium text-amber-900">Open</Link>
        ) : (
          <Link href="/messages" className="shrink-0 text-xs font-medium text-stone-500">All chats</Link>
        )}
      </header>
      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current;
          if (!el) return;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 space-y-3 overflow-y-auto px-3 py-3"
      >
        {hasMore ? (
          <button type="button" onClick={() => void loadEarlier()} className="mx-auto block min-h-11 rounded-full px-3 text-xs font-medium text-stone-500">
            Earlier messages
          </button>
        ) : null}
        {messages.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">No messages yet. Say hello.</p> : null}
        {messages.map((message) => {
          const mine = message.sender_id === me.id;
          const author = message.sender_id ? authors[message.sender_id] : undefined;
          const deleted = !!message.deleted_at;
          return (
            <article key={message.id} className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
              <Avatar url={mine ? me.avatar_url : author?.avatar_url} name={mine ? personName(me) : personName(author)} />
              <div className={`max-w-[80%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                <p className="px-1 text-[11px] text-stone-500">
                  {mine ? "You" : personName(author)}
                  {" · "}
                  <time dateTime={message.created_at} title={fullDate(message.created_at)}>{timeAgo(message.created_at)}</time>
                  {message.edited_at && !deleted ? " · edited" : ""}
                </p>
                {editingId === message.id ? (
                  <form
                    className="mt-1 space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveEdit(message.id);
                    }}
                  >
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={MESSAGE_MAX} rows={2} className="w-full rounded-xl border border-stone-300 px-3 py-2" />
                    <div className="flex gap-2">
                      <button type="submit" className="min-h-11 rounded-full bg-amber-900 px-3 text-xs font-medium text-white">Save</button>
                      <button type="button" onClick={() => setEditingId(null)} className="min-h-11 px-2 text-xs text-stone-500">Cancel</button>
                    </div>
                  </form>
                ) : (
                  <div className={`mt-0.5 rounded-2xl px-3 py-2 text-sm ${deleted ? "bg-stone-100 text-stone-500 italic" : mine ? "bg-amber-900 text-amber-50" : "bg-stone-100 text-stone-900"}`}>
                    {deleted ? "Message deleted" : message.body}
                  </div>
                )}
                {!deleted && editingId !== message.id && (mine || canModerate) ? (
                  <div className="mt-0.5 flex gap-2 px-1">
                    {mine ? (
                      <button
                        type="button"
                        className="min-h-11 text-xs text-stone-500"
                        onClick={() => {
                          setEditingId(message.id);
                          setDraft(message.body);
                        }}
                      >
                        Edit
                      </button>
                    ) : null}
                    {confirmId === message.id ? (
                      <button type="button" className="min-h-11 text-xs font-medium text-red-700" onClick={() => void remove(message.id)}>
                        Confirm delete
                      </button>
                    ) : (
                      <button type="button" className="min-h-11 text-xs text-stone-500" onClick={() => setConfirmId(message.id)}>
                        Delete
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      {blocked ? (
        <p className="border-t border-stone-200 px-3 py-3 text-sm text-stone-600">Messages are turned off in this conversation.</p>
      ) : (
        <form onSubmit={(e) => void send(e)} className="flex items-end gap-2 border-t border-stone-200 p-2">
          <label className="sr-only" htmlFor={`chat-${roomId}`}>Message</label>
          <textarea
            id={`chat-${roomId}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            maxLength={MESSAGE_MAX}
            rows={1}
            placeholder="Message"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-stone-300 px-3 py-2"
          />
          <button type="submit" disabled={sending || !text.trim()} className="min-h-11 rounded-full bg-amber-900 px-4 text-sm font-medium text-white disabled:opacity-50">
            Send
          </button>
        </form>
      )}
      {error ? <p className="px-3 pb-2 text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
