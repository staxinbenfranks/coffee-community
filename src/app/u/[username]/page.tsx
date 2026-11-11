import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import { ROLE_LABEL, type Profile } from "@/lib/types";
import Avatar from "@/components/Avatar";

export default async function UserPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("username", username).maybeSingle();
  if (!data) notFound();
  const p = data as Profile;
  const me = await getSessionProfile();
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
      {me?.id === p.id && <Link href="/profile" className="inline-block rounded-full border border-stone-300 px-4 py-1.5 text-sm font-medium">Edit profile</Link>}
    </div>
  );
}
