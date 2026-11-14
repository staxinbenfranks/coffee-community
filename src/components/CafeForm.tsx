/* eslint-disable @next/next/no-img-element */
"use client";
import { useActionState, useState } from "react";
import { saveCafe } from "@/app/actions";
import { uploadPublic } from "@/lib/upload";
import type { Cafe } from "@/lib/types";
import MoveButtons from "./MoveButtons";

const input = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2";

export default function CafeForm({ cafe }: { cafe?: Cafe }) {
  const [state, action, pending] = useActionState(saveCafe, undefined);
  const [photos, setPhotos] = useState((cafe?.photos ?? []).join("\n"));
  const [upErr, setUpErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const [confirm, setConfirm] = useState<number | null>(null);
  const list = photos.split("\n").map((line) => line.trim()).filter(Boolean);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const inputEl = e.currentTarget;
    const files = Array.from(inputEl.files ?? []);
    inputEl.value = "";
    if (!files.length) return;
    setUploading(true); setUpErr("");
    try {
      const urls: string[] = [];
      for (const f of files) urls.push(await uploadPublic("cafe-photos", cafe?.slug ?? "new", f));
      setPhotos((p) => [p.trim(), ...urls].filter(Boolean).join("\n"));
    } catch (err) { setUpErr(err instanceof Error ? err.message : "Upload failed"); }
    setUploading(false);
  }

  function move(index: number, dir: -1 | 1) {
    const next = list.slice();
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPhotos(next.join("\n"));
    setConfirm(null);
  }

  function removeAt(index: number) {
    setPhotos(list.filter((_, i) => i !== index).join("\n"));
    setConfirm(null);
  }

  const f = (name: string, label: string, def?: string | null, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block text-sm">{label}<input name={name} defaultValue={def ?? ""} className={input} {...extra} /></label>
  );

  return (
    <form action={action} onSubmit={(e) => { if (uploading) e.preventDefault(); }} className="space-y-4">
      {cafe && <input type="hidden" name="id" value={cafe.id} />}
      {f("name", "Name", cafe?.name, { required: true })}
      {f("slug", "URL slug (optional, auto from name)", cafe?.slug, { autoCapitalize: "none" })}
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">{f("city", "City", cafe?.city ?? "Los Angeles", { required: true })}</div>
        {f("state", "State", cafe?.state ?? "CA", { required: true, maxLength: 2 })}
      </div>
      {f("address", "Address", cafe?.address)}
      <label className="block text-sm">Description
        <textarea name="description" rows={3} defaultValue={cafe?.description ?? ""} className={input} /></label>
      {f("menu_url", "Menu link", cafe?.menu_url, { type: "url", placeholder: "https://" })}
      {f("website", "Website", cafe?.website, { type: "url", placeholder: "https://" })}
      {f("instagram", "Instagram (handle or URL)", cafe?.instagram)}
      {f("tiktok", "TikTok (handle or URL)", cafe?.tiktok)}
      <div>
        <p className="text-sm">Photos</p>
        {list.length > 0 ? <p className="text-xs text-stone-500">First photo is the cover. Use the arrows to reorder.</p> : null}
        {list.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {list.map((url, i) => (
              <li key={`${url}:${i}`} className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 p-2">
                <img src={url} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                <MoveButtons index={i} total={list.length} disabled={pending || uploading} onMove={(dir) => move(i, dir)} />
                {confirm === i ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-stone-600">Remove this photo?</span>
                    <button type="button" onClick={() => removeAt(i)} className="min-h-11 rounded-full bg-red-700 px-4 text-sm font-medium text-white">Remove</button>
                    <button type="button" onClick={() => setConfirm(null)} className="min-h-11 px-2 text-sm text-stone-500">Cancel</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirm(i)} className="min-h-11 px-3 text-sm font-medium text-red-700">Delete</button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <label className="mt-2 block text-sm">Photo URLs (one per line)
          <textarea name="photos" rows={4} value={photos} onChange={(e) => { setPhotos(e.target.value); setConfirm(null); }} className={input} /></label>
        <label className="mt-1 inline-block text-sm font-medium text-amber-900">
          {uploading ? "Uploading…" : "＋ Upload photos"}
          <input type="file" accept="image/*" multiple onChange={onFiles} className="hidden" />
        </label>
        {upErr && <p className="text-sm text-red-600">{upErr}</p>}
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending || uploading} className="w-full rounded-full bg-amber-900 py-3 font-medium text-white disabled:opacity-50">{pending ? "Saving…" : "Save cafe"}</button>
    </form>
  );
}
