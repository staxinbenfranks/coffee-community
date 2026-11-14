import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchInbox } from "@/lib/chat";

export default async function MessagesPage() {
  const me = await requireProfile("/messages");
  const supabase = await createClient();
  const inbox = await fetchInbox(supabase, me.id);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Messages</h1>
      {inbox.error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{inbox.error}</p> : null}
      {inbox.rooms.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">
          No chats yet. Join a cafe, or open someone&apos;s profile and tap Message.
        </p>
      ) : (
        <ul className="space-y-2">
          {inbox.rooms.map((room) => (
            <li key={room.id}>
              <Link href={`/messages/${room.id}`} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2 active:bg-stone-50">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{room.title}</span>
                  <span className="block text-xs text-stone-500">{room.kind === "dm" ? "Direct message" : "Cafe chat"}</span>
                </span>
                {room.unread > 0 ? <span className="rounded-full bg-amber-900 px-2 py-0.5 text-xs font-medium text-white">{room.unread}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
