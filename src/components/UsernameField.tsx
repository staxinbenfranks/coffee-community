"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { USERNAME_RE, isPlaceholderUsername } from "@/lib/username";

const input = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2";

type Status = "same" | "idle" | "checking" | "ok" | "taken" | "invalid" | "placeholder";
type Remote = { name: string; status: "ok" | "taken" | "idle" };

function immediateStatus(name: string, current: string): Status | null {
  if (isPlaceholderUsername(name)) return "placeholder";
  if (name === current.trim().toLowerCase()) return "same";
  if (!USERNAME_RE.test(name)) return "invalid";
  return null;
}

export default function UsernameField({ current, onBlocked }: { current: string; onBlocked: (blocked: boolean) => void }) {
  const [value, setValue] = useState(current.toLowerCase());
  const [remote, setRemote] = useState<Remote | null>(null);
  const name = value.trim().toLowerCase();
  const known = immediateStatus(name, current);
  const status: Status = known ?? (remote?.name === name ? remote.status : "checking");

  useEffect(() => {
    if (known) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const { data, error } = await createClient().rpc("username_available", { candidate: name });
        if (cancelled) return;
        const next = error ? "idle" : data === true ? "ok" : "taken";
        setRemote({ name, status: next });
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [known, name]);

  const blocked = status === "placeholder" || status === "invalid" || status === "checking" || status === "taken";
  useEffect(() => {
    onBlocked(blocked);
  }, [blocked, onBlocked]);

  const ownPlaceholder = status === "placeholder" && name === current.trim().toLowerCase();
  const message = ownPlaceholder
    ? "Pick a username of your own to replace this temporary one."
    : status === "placeholder"
      ? "That looks like a temporary username. Pick one of your own."
      : status === "invalid"
        ? "Use 3–20 letters, numbers, or underscores."
        : status === "checking"
          ? "Checking…"
          : status === "ok"
            ? "Available"
            : status === "taken"
              ? "That username is taken."
              : "";
  const bad = status === "placeholder" || status === "invalid" || status === "taken";

  return (
    <label className="block text-sm">Username
      <input
        name="username"
        required
        value={value}
        onChange={(e) => setValue(e.target.value.toLowerCase())}
        maxLength={20}
        pattern="[a-z0-9_]{3,20}"
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="username"
        spellCheck={false}
        aria-invalid={bad}
        aria-describedby={message ? "username-status" : undefined}
        className={input}
      />
      <span className="mt-1 block text-xs text-stone-500">3–20 letters, numbers, or underscores.</span>
      {message ? (
        <span id="username-status" className={`mt-1 block text-sm ${bad ? "text-red-600" : "text-stone-500"}`}>{message}</span>
      ) : null}
    </label>
  );
}
