"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { chatError } from "@/lib/chat";
import type { ChatPerson } from "@/lib/types";

export default function BlockedList({ people }: { people: ChatPerson[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(people);
  const [error, setError] = useState("");

  if (rows.length === 0) return null;

  async function unblock(username: string) {
    setError("");
    const { error: unblockError } = await createClient().schema("chat").rpc("unblock_user", { p_username: username });
    if (unblockError) {
      setError(chatError(unblockError.message));
      return;
    }
    setRows((prev) => prev.filter((person) => person.username !== username));
    router.refresh();
  }

  return (
    <section className="space-y-2">
      <h2 className="font-semibold">Blocked</h2>
      <ul className="space-y-2">
        {rows.map((person) => (
          <li key={person.id} className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2">
            <Link href={`/u/${person.username}`} className="min-w-0 truncate text-sm font-medium">@{person.username}</Link>
            <button type="button" onClick={() => void unblock(person.username)} className="min-h-11 shrink-0 text-sm text-amber-900">Unblock</button>
          </li>
        ))}
      </ul>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </section>
  );
}
