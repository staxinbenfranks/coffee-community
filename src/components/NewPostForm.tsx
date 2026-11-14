/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { createPost } from "@/app/actions";
import { removePublic, uploadPublicObject } from "@/lib/upload";
import MoveButtons from "./MoveButtons";

const MAX_PHOTOS = 6;

type DraftPhoto = { path: string; url: string };

export default function NewPostForm({ communityId, userId, next }: { communityId: string; userId: string | null; next: string }) {
  if (!userId) {
    return (
      <Link href={`/login?next=${encodeURIComponent(next)}`} className="block rounded-xl border border-dashed border-amber-400 bg-amber-50 p-4 text-center text-sm font-medium text-amber-900">
        Sign in to start a thread
      </Link>
    );
  }
  return <Composer communityId={communityId} userId={userId} />;
}

function Composer({ communityId, userId }: { communityId: string; userId: string }) {
  const [state, action, pending] = useActionState(createPost, undefined);
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [upErr, setUpErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const [confirm, setConfirm] = useState<number | null>(null);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (!files.length) return;
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setUpErr("A post can have at most 6 photos.");
      return;
    }
    const batch = files.slice(0, room);
    setUploading(true);
    setUpErr("");
    const uploaded: DraftPhoto[] = [];
    try {
      for (const file of batch) uploaded.push(await uploadPublicObject("post-photos", userId, file));
      setPhotos((current) => [...current, ...uploaded].slice(0, MAX_PHOTOS));
      if (files.length > room) setUpErr("A post can have at most 6 photos. Extra files were skipped.");
    } catch (err) {
      if (uploaded.length) setPhotos((current) => [...current, ...uploaded].slice(0, MAX_PHOTOS));
      setUpErr(err instanceof Error ? err.message : "Upload failed");
    }
    setUploading(false);
  }

  function move(index: number, dir: -1 | 1) {
    setPhotos((current) => {
      const next = current.slice();
      const target = index + dir;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setConfirm(null);
  }

  async function removeAt(index: number) {
    const photo = photos[index];
    if (!photo) return;
    setUploading(true);
    setUpErr("");
    try {
      await removePublic("post-photos", [photo.path]);
      setPhotos((current) => current.filter((_, i) => i !== index));
      setConfirm(null);
    } catch (err) {
      setUpErr(err instanceof Error ? err.message : "Could not remove that photo.");
    }
    setUploading(false);
  }

  return (
    <details className="rounded-xl border border-stone-200 bg-white">
      <summary className="cursor-pointer list-none p-4 text-sm font-medium text-amber-900">＋ Start a thread</summary>
      <form action={action} onSubmit={(e) => { if (uploading) e.preventDefault(); }} className="space-y-3 border-t border-stone-100 p-4">
        <input type="hidden" name="community_id" value={communityId} />
        {photos.map((photo) => <input key={photo.path} type="hidden" name="photo_path" value={photo.path} />)}
        <input name="title" required maxLength={200} placeholder="Title" className="w-full rounded-lg border border-stone-300 px-3 py-2" />
        <textarea name="body" rows={4} placeholder="What's on your mind? (optional)" className="w-full rounded-lg border border-stone-300 px-3 py-2" />
        {photos.length > 0 ? (
          <ul className="space-y-2">
            {photos.map((photo, index) => (
              <li key={photo.path} className="flex flex-wrap items-center gap-2">
                <img src={photo.url} alt={`Photo ${index + 1}`} className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                <MoveButtons index={index} total={photos.length} disabled={uploading || pending} onMove={(dir) => move(index, dir)} />
                {confirm === index ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-stone-600">Remove this photo?</span>
                    <button type="button" disabled={uploading} onClick={() => void removeAt(index)} className="min-h-11 rounded-full bg-red-700 px-4 text-sm font-medium text-white disabled:opacity-50">Remove</button>
                    <button type="button" disabled={uploading} onClick={() => setConfirm(null)} className="min-h-11 px-2 text-sm text-stone-500">Cancel</button>
                  </span>
                ) : (
                  <button type="button" disabled={uploading || pending} onClick={() => setConfirm(index)} className="min-h-11 px-3 text-sm font-medium text-red-700 disabled:opacity-50">Delete</button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {photos.length < MAX_PHOTOS ? (
          <label className="inline-block text-sm font-medium text-amber-900">
            {uploading ? "Uploading…" : "＋ Add photos"}
            <input type="file" accept="image/*" multiple disabled={uploading || pending} onChange={(e) => void onFiles(e)} className="hidden" />
          </label>
        ) : (
          <p className="text-sm text-stone-500">6 of 6 photos</p>
        )}
        {upErr ? <p className="text-sm text-red-600">{upErr}</p> : null}
        {state?.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
        <button disabled={pending || uploading} className="rounded-full bg-amber-900 px-5 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "Posting…" : "Post"}</button>
      </form>
    </details>
  );
}
