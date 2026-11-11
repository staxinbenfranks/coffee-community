"use client";
import Link from "next/link";
import { useActionState } from "react";
import { createPost } from "@/app/actions";

export default function NewPostForm({ communityId, signedIn, next }: { communityId: string; signedIn: boolean; next: string }) {
  const [state, action, pending] = useActionState(createPost, undefined);
  if (!signedIn)
    return (
      <Link href={`/login?next=${encodeURIComponent(next)}`} className="block rounded-xl border border-dashed border-amber-400 bg-amber-50 p-4 text-center text-sm font-medium text-amber-900">
        Sign in to start a thread
      </Link>
    );
  return (
    <details className="rounded-xl border border-stone-200 bg-white">
      <summary className="cursor-pointer list-none p-4 text-sm font-medium text-amber-900">＋ Start a thread</summary>
      <form action={action} className="space-y-3 border-t border-stone-100 p-4">
        <input type="hidden" name="community_id" value={communityId} />
        <input name="title" required maxLength={200} placeholder="Title" className="w-full rounded-lg border border-stone-300 px-3 py-2" />
        <textarea name="body" rows={4} placeholder="What's on your mind? (optional)" className="w-full rounded-lg border border-stone-300 px-3 py-2" />
        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
        <button disabled={pending} className="rounded-full bg-amber-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "Posting…" : "Post"}</button>
      </form>
    </details>
  );
}
