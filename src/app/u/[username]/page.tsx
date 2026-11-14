import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import { ROLE_LABEL, type Profile } from "@/lib/types";
import Avatar from "@/components/Avatar";
import MyCafes from "@/components/MyCafes";
import PersonActions from "@/components/PersonActions";

export default async function UserPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("username", username).maybeSingle();
  if (!data) notFound();
  const p = data as Profile;
  const me = await getSessionProfile();
  let buddy = false;
  let blocked = false;
  if (me && me.id !== p.id) {
    const chat = supabase.schema("chat");
    const [buddyRes, blockRes] = await Promise.all([
      chat.from("buddies").select("buddy_id").eq("owner_id", me.id).eq("buddy_id", p.id).maybeSingle(),
      chat.from("blocks").select("blocked_id").eq("blocker_id", me.id).eq("blocked_id", p.id).maybeSingle(),
    ]);
    buddy = !!buddyRes.data;
    blocked = !!blockRes.data;
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Avatar url={p.avatar_url} name={p.display_name ?? p.username} size={72} />
        <div>
          <h1 className="text-xl font-bold">{p.display_name ?? p.username}</h1>
          <p className="text-sm text-stone-500">@{p.username}</p>
          <p className="text-sm text-stone-600">{[p.role && ROLE_LABEL[p.role], p.city].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      {p.bio && <p className="whitespace-pre-wrap text-sm">{p.bio}</p>}
      {me?.id === p.id ? (
        <Link href="/profile" className="inline-flex min-h-11 items-center rounded-full border border-stone-300 px-4 text-sm font-medium">Edit profile</Link>
      ) : me ? (
        <PersonActions username={p.username} initialBuddy={buddy} initialBlocked={blocked} />
      ) : (
        <Link href={`/login?next=${encodeURIComponent(`/u/${p.username}`)}`} className="inline-flex min-h-11 items-center rounded-full bg-amber-900 px-4 text-sm font-medium text-white">Sign in to message</Link>
      )}
      <MyCafes userId={p.id} heading={me?.id === p.id ? "My cafes" : "Cafes"} />
    </div>
  );
}
