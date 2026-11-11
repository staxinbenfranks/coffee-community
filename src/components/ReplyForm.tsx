"use client";
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { createComment, type FormState } from "@/app/actions";

export default function ReplyForm({
  postId, parentId, signedIn, next, label = "Reply", open: startOpen = false,
}: { postId: string; parentId?: string; signedIn: boolean; next: string; label?: string; open?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(async (prev: FormState, fd: FormData) => {
    const res = await createComment(prev, fd);
    if (res?.ok) {
      ref.current?.reset();
      if (!startOpen) setOpen(false);
    }
    return res;
  }, undefined);

  if (!signedIn)
    return <Link href={`/login?next=${encodeURIComponent(next)}`} className="text-xs font-medium text-amber-900">Sign in to {label.toLowerCase()}</Link>;
  if (!open) return <button onClick={() => setOpen(true)} className="text-xs font-medium text-amber-900">{label}</button>;
  return (
    <form ref={ref} action={action} className="mt-2 space-y-2">
      <input type="hidden" name="post_id" value={postId} />
      {parentId && <input type="hidden" name="parent_comment_id" value={parentId} />}
      <textarea name="body" required rows={3} autoFocus={!startOpen} placeholder="Write a reply…" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2" />
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex gap-3">
        <button disabled={pending} className="rounded-full bg-amber-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">{pending ? "Posting…" : "Post"}</button>
        {!startOpen && <button type="button" onClick={() => setOpen(false)} className="text-sm text-stone-500">Cancel</button>}
      </div>
    </form>
  );
}
