"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FormState } from "@/app/actions";

export default function ConfirmDelete({
  label, question, confirmLabel = "Delete", onConfirm,
}: {
  label: string;
  question: string;
  confirmLabel?: string;
  onConfirm: () => Promise<FormState>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  if (!open) {
    return (
      <button type="button" onClick={() => { setError(""); setOpen(true); }} className="text-xs font-medium text-stone-500">
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-sm text-stone-600">{question}</span>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError("");
          const res = await onConfirm();
          setPending(false);
          if (res?.error) setError(res.error);
          else {
            setOpen(false);
            router.refresh();
          }
        }}
        className="min-h-11 rounded-full bg-red-700 px-4 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Deleting…" : confirmLabel}
      </button>
      <button type="button" disabled={pending} onClick={() => setOpen(false)} className="min-h-11 px-2 text-sm text-stone-500">Cancel</button>
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </span>
  );
}
