import { requireProfile } from "@/lib/auth";
import { safeNext } from "@/lib/format";
import { isPlaceholderUsername } from "@/lib/username";
import { createClient } from "@/lib/supabase/server";
import ProfileForm from "@/components/ProfileForm";
import MyCafes from "@/components/MyCafes";
import BlockedList from "@/components/BlockedList";
import type { ChatPerson } from "@/lib/types";

export default async function EditProfile({ searchParams }: { searchParams: Promise<{ welcome?: string; next?: string }> }) {
  const { welcome, next } = await searchParams;
  const query = new URLSearchParams();
  if (welcome) query.set("welcome", "1");
  if (next) query.set("next", next);
  const me = await requireProfile(query.size ? `/profile?${query}` : "/profile");
  const supabase = await createClient();
  const { data: blocks } = await supabase.schema("chat").from("blocks").select("blocked_id").eq("blocker_id", me.id);
  const blockedIds = ((blocks ?? []) as { blocked_id: string }[]).map((row) => row.blocked_id);
  const { data: blockedProfiles } = blockedIds.length
    ? await supabase.from("profiles").select("id, username, display_name, avatar_url").in("id", blockedIds)
    : { data: [] as ChatPerson[] };
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{welcome ? "Welcome! Set up your profile" : "Edit profile"}</h1>
        {isPlaceholderUsername(me.username) ? (
          <p className="text-sm text-stone-600">Choose a username to replace the temporary one. It is how people find you.</p>
        ) : null}
        <ProfileForm profile={me} next={welcome && next ? safeNext(next) : undefined} />
      </div>
      <MyCafes userId={me.id} heading="My cafes" />
      <BlockedList people={(blockedProfiles ?? []) as ChatPerson[]} />
    </div>
  );
}
