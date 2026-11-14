"use client";
import { useActionState, useState } from "react";
import { updateProfile } from "@/app/actions";
import { uploadPublic } from "@/lib/upload";
import { isPlaceholderUsername } from "@/lib/username";
import type { Profile } from "@/lib/types";
import Avatar from "./Avatar";
import UsernameField from "./UsernameField";

const input = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2";

export default function ProfileForm({ profile, next }: { profile: Profile; next?: string }) {
  const [state, action, pending] = useActionState(updateProfile, undefined);
  const [avatar, setAvatar] = useState(profile.avatar_url ?? "");
  const [upErr, setUpErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const [usernameBlocked, setUsernameBlocked] = useState(() => isPlaceholderUsername(profile.username));

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true); setUpErr("");
    try { setAvatar(await uploadPublic("avatars", profile.id, f)); }
    catch (err) { setUpErr(err instanceof Error ? err.message : "Upload failed"); }
    setUploading(false);
  }

  return (
    <form action={action} onSubmit={(e) => { if (uploading || usernameBlocked) e.preventDefault(); }} className="space-y-4">
      <input type="hidden" name="avatar_url" value={avatar} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="flex items-center gap-4">
        <Avatar url={avatar} name={profile.display_name ?? profile.username} size={64} />
        <label className="text-sm font-medium text-amber-900">
          {uploading ? "Uploading…" : "Change photo"}
          <input type="file" accept="image/*" onChange={onFile} className="hidden" />
        </label>
      </div>
      {upErr && <p className="text-sm text-red-600">{upErr}</p>}
      <label className="block text-sm">Display name
        <input name="display_name" required defaultValue={profile.display_name ?? ""} className={input} /></label>
      <UsernameField current={profile.username} onBlocked={setUsernameBlocked} />
      <label className="block text-sm">I am a…
        <select name="role" defaultValue={profile.role ?? ""} className={input}>
          <option value="">Choose one</option>
          <option value="barista">Barista</option>
          <option value="owner">Cafe owner</option>
          <option value="coffee_lover">Coffee lover</option>
        </select></label>
      <label className="block text-sm">City
        <input name="city" defaultValue={profile.city ?? "Los Angeles"} className={input} /></label>
      <label className="block text-sm">Short bio
        <textarea name="bio" rows={3} maxLength={300} defaultValue={profile.bio ?? ""} className={input} /></label>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending || uploading || usernameBlocked} className="w-full rounded-full bg-amber-900 py-3 font-medium text-white disabled:opacity-50">{pending ? "Saving…" : "Save profile"}</button>
    </form>
  );
}
