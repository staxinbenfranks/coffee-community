"use client";
import { useActionState, useState } from "react";
import { saveCafe } from "@/app/actions";
import { uploadPublic } from "@/lib/upload";
import type { Cafe } from "@/lib/types";

const input = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2";

export default function CafeForm({ cafe }: { cafe?: Cafe }) {
  const [state, action, pending] = useActionState(saveCafe, undefined);
  const [photos, setPhotos] = useState((cafe?.photos ?? []).join("\n"));
  const [upErr, setUpErr] = useState("");
  const [uploading, setUploading] = useState(false);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true); setUpErr("");
    try {
      const urls: string[] = [];
      for (const f of files) urls.push(await uploadPublic("cafe-photos", cafe?.slug ?? "new", f));
      setPhotos((p) => [p.trim(), ...urls].filter(Boolean).join("\n"));
    } catch (err) { setUpErr(err instanceof Error ? err.message : "Upload failed"); }
    setUploading(false);
  }

  const f = (name: string, label: string, def?: string | null, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block text-sm">{label}<input name={name} defaultValue={def ?? ""} className={input} {...extra} /></label>
  );

  return (
    <form action={action} className="space-y-4">
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
        <label className="block text-sm">Photo URLs (one per line)
          <textarea name="photos" rows={4} value={photos} onChange={(e) => setPhotos(e.target.value)} className={input} /></label>
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
