"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { chatError } from "@/lib/chat";

export default function JoinBar(
  props: {
    joined: boolean;
    count: number;
    userId: string | null;
    next: string;
    noun?: string;
  } & ({ mode: "cafe"; cafeId: string } | { mode: "community"; communityId: string }),
) {
  const router = useRouter();
  const [on, setOn] = useState(props.joined);
  const [count, setCount] = useState(props.count);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const noun = props.noun ?? "member";
  const [fromServer, setFromServer] = useState({ joined: props.joined, count: props.count });
  if (fromServer.joined !== props.joined || fromServer.count !== props.count) {
    setFromServer({ joined: props.joined, count: props.count });
    setOn(props.joined);
    setCount(props.count);
  }

  const cafeId = props.mode === "cafe" ? props.cafeId : null;

  useEffect(() => {
    if (!cafeId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`cafe-members-${cafeId}`, { config: { private: true } })
      .on("postgres_changes", { event: "*", schema: "public", table: "cafe_memberships", filter: `cafe_id=eq.${cafeId}` }, async () => {
        const { count: next } = await supabase.from("cafe_memberships").select("*", { count: "exact", head: true }).eq("cafe_id", cafeId);
        if (typeof next === "number") setCount(next);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [cafeId]);

  async function toggle() {
    if (!props.userId) {
      router.push(`/login?next=${encodeURIComponent(props.next)}`);
      return;
    }
    setBusy(true);
    setError("");
    const supabase = createClient();
    const leaving = on;
    const result = props.mode === "cafe"
      ? leaving
        ? await supabase.from("cafe_memberships").delete().eq("cafe_id", props.cafeId).eq("user_id", props.userId)
        : await supabase.from("cafe_memberships").insert({ cafe_id: props.cafeId, user_id: props.userId })
      : leaving
        ? await supabase.rpc("leave_community_chat", { p_community_id: props.communityId })
        : await supabase.rpc("join_community_chat", { p_community_id: props.communityId });
    setBusy(false);
    if (result.error) {
      setError(chatError(result.error.message));
      return;
    }
    setOn(!leaving);
    setCount((value) => Math.max(0, value + (leaving ? -1 : 1)));
    router.refresh();
  }

  const label = count === 1 ? noun : `${noun}s`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-stone-500">{count} {label}</p>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={on}
        className={`min-h-11 rounded-full px-4 text-sm font-medium disabled:opacity-50 ${on ? "border border-stone-300 bg-white" : "bg-amber-900 text-white"}`}
      >
        {busy ? "Saving…" : on ? "Leave" : "Join"}
      </button>
      {error ? <p className="w-full text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
