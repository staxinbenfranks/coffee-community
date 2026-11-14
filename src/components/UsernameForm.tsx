"use client";

import { useActionState, useState } from "react";
import { claimUsername } from "@/app/actions";
import UsernameField from "./UsernameField";

export default function UsernameForm({ current, next }: { current: string; next: string }) {
  const [state, action, pending] = useActionState(claimUsername, undefined);
  const [blocked, setBlocked] = useState(true);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <UsernameField current={current} onBlocked={setBlocked} />
      {state?.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      <button disabled={pending || blocked} className="w-full rounded-full bg-amber-900 py-3 font-medium text-white disabled:opacity-50">
        {pending ? "Saving…" : "Save username"}
      </button>
    </form>
  );
}
