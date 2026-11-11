"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const supabase = createClient();

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setBusy(false);
    if (error) setError(error.message); else setSent(true);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: "email" });
    if (error) { setBusy(false); setError(error.message); return; }
    router.replace(`/welcome?next=${encodeURIComponent(next)}`);
    router.refresh();
  }

  if (!sent)
    return (
      <form onSubmit={send} className="space-y-3">
        <input type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-3" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy} className="w-full rounded-full bg-amber-900 py-3 font-medium text-white disabled:opacity-50">{busy ? "Sending…" : "Email me a sign-in link"}</button>
      </form>
    );
  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Check <b>{email}</b>. Tap the link in the email — or type the code from it below.</p>
      <form onSubmit={verify} className="space-y-3">
        <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="Code from email"
          className="w-full rounded-lg border border-stone-300 bg-white px-3 py-3 tracking-widest" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy || !code} className="w-full rounded-full bg-amber-900 py-3 font-medium text-white disabled:opacity-50">{busy ? "Checking…" : "Sign in"}</button>
      </form>
      <button onClick={() => { setSent(false); setCode(""); }} className="text-sm text-stone-500">Use a different email</button>
    </div>
  );
}
