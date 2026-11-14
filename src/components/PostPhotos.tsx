/* eslint-disable @next/next/no-img-element */
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addPostPhoto, deletePostPhoto, reorderPostPhotos } from "@/app/actions";
import { sortPhotos, type PhotoRef } from "@/lib/photos";
import { removePublic, uploadPublicObject } from "@/lib/upload";
import MoveButtons from "./MoveButtons";

const MAX_PHOTOS = 6;

export default function PostPhotos({
  postId, photos: incoming, userId, canAdd, canReorder, canDelete,
}: {
  postId: string;
  photos: PhotoRef[];
  userId: string | null;
  canAdd: boolean;
  canReorder: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const signature = incoming.map((photo) => `${photo.id}:${photo.position}:${photo.url}`).join("|");
  const [seen, setSeen] = useState(signature);
  const [photos, setPhotos] = useState(() => sortPhotos(incoming));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const lock = useRef(false);

  if (seen !== signature) {
    setSeen(signature);
    setPhotos(sortPhotos(incoming));
    setConfirmId(null);
  }

  if (!photos.length && !canAdd) return null;

  const locked = busy || uploading;
  const manage = canAdd || canReorder || canDelete;

  async function move(index: number, dir: -1 | 1) {
    if (lock.current || !canReorder) return;
    const next = photos.slice();
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    const previous = photos;
    [next[index], next[target]] = [next[target], next[index]];
    lock.current = true;
    setPhotos(next);
    setBusy(true);
    setError("");
    try {
      const res = await reorderPostPhotos(postId, next.map((photo) => photo.id));
      if (res?.error) {
        setPhotos(previous);
        setError(res.error);
        return;
      }
      router.refresh();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function remove(photoId: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await deletePostPhoto(postId, photoId);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setPhotos((current) => current.filter((photo) => photo.id !== photoId));
      setConfirmId(null);
      router.refresh();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (lock.current || !userId || !canAdd || !files.length) return;
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setError("A post can have at most 6 photos.");
      return;
    }
    lock.current = true;
    const batch = files.slice(0, room);
    setUploading(true);
    setError("");
    try {
      for (const file of batch) {
        const uploaded = await uploadPublicObject("post-photos", userId, file);
        const res = await addPostPhoto(postId, uploaded.path);
        if (res?.error) {
          await removePublic("post-photos", [uploaded.path]).catch(() => undefined);
          throw new Error(res.error);
        }
      }
      if (files.length > room) setError("A post can have at most 6 photos. Extra files were skipped.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      router.refresh();
    } finally {
      lock.current = false;
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      {manage ? <p className="text-sm text-stone-500">{photos.length} of {MAX_PHOTOS} photos</p> : null}
      {manage ? (
        <ul className="space-y-2">
          {photos.map((photo, index) => (
            <li key={photo.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white p-2">
              <img src={photo.url} alt={`Photo ${index + 1}`} className="h-20 w-20 shrink-0 rounded-lg object-cover" />
              {canReorder ? <MoveButtons index={index} total={photos.length} disabled={locked} onMove={(dir) => void move(index, dir)} /> : null}
              {canDelete && confirmId === photo.id ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-stone-600">Delete this photo?</span>
                  <button type="button" disabled={locked} onClick={() => void remove(photo.id)} className="min-h-11 rounded-full bg-red-700 px-4 text-sm font-medium text-white disabled:opacity-50">Delete</button>
                  <button type="button" disabled={locked} onClick={() => setConfirmId(null)} className="min-h-11 px-2 text-sm text-stone-500">Cancel</button>
                </span>
              ) : null}
              {canDelete && confirmId !== photo.id ? (
                <button type="button" disabled={locked} onClick={() => setConfirmId(photo.id)} className="min-h-11 px-3 text-sm font-medium text-red-700 disabled:opacity-50">Delete</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4">
          {photos.map((photo, index) => (
            <img key={photo.id} src={photo.url} alt={`Photo ${index + 1}`} className="h-48 w-72 shrink-0 snap-center rounded-xl object-cover" />
          ))}
        </div>
      )}
      {canAdd && photos.length < MAX_PHOTOS ? (
        <label className="inline-block text-sm font-medium text-amber-900">
          {uploading ? "Uploading…" : "＋ Add photos"}
          <input type="file" accept="image/*" multiple disabled={locked} onChange={(e) => void onFiles(e)} className="hidden" />
        </label>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
