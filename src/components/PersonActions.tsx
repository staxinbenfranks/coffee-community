"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { chatError } from "@/lib/chat";

export default function PersonActions({
  username,
  initialBuddy,
  initialBlocked,
}: {
  username: string;
  initialBuddy: boolean;
  initialBlocked: boolean;
}) {
  const router = useRouter();
  const [buddy, setBuddy] = useState(initialBuddy);
  const [blocked, setBlocked] = useState(initialBlocked);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function message() {
    setBusy("message");
    setError("");
    const { data, error: dmError } = await createClient().schema("chat").rpc("start_dm", { p_username: username });
    setBusy("");
    if (dmError || !data) {
      setError(chatError(dmError?.message ?? "Could not open a conversation."));
      return;
    }
    router.push(`/messages/${data}`);
  }

  async function toggleBuddy() {
    setBusy("buddy");
    setError("");
    const supabase = createClient().schema("chat");
    const { error: buddyError } = buddy
      ? await supabase.rpc("remove_buddy", { p_username: username })
      : await supabase.rpc("add_buddy", { p_username: username });
    setBusy("");
    if (buddyError) {
      setError(chatError(buddyError.message));
      return;
    }
    setBuddy(!buddy);
    router.refresh();
  }

  async function toggleBlock() {
    setBusy("block");
    setError("");
    const supabase = createClient().schema("chat");
    const { error: blockError } = blocked
      ? await supabase.rpc("unblock_user", { p_username: username })
      : await supabase.rpc("block_user", { p_username: username });
    setBusy("");
    if (blockError) {
      setError(chatError(blockError.message));
      return;
    }
    setBlocked(!blocked);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void message()} disabled={busy !== ""} className="min-h-11 rounded-full bg-amber-900 px-4 text-sm font-medium text-white disabled:opacity-50">
          {busy === "message" ? "Opening…" : "Message"}
        </button>
        <button type="button" onClick={() => void toggleBuddy()} disabled={busy !== ""} className="min-h-11 rounded-full border border-stone-300 px-4 text-sm font-medium disabled:opacity-50">
          {busy === "buddy" ? "Saving…" : buddy ? "Remove buddy" : "Add buddy"}
        </button>
        <button type="button" onClick={() => void toggleBlock()} disabled={busy !== ""} className="min-h-11 rounded-full border border-stone-300 px-4 text-sm font-medium disabled:opacity-50">
          {busy === "block" ? "Saving…" : blocked ? "Unblock" : "Block"}
        </button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
