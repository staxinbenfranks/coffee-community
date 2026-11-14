import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import type { Community } from "@/lib/types";
import PostList from "@/components/PostList";
import NewPostForm from "@/components/NewPostForm";
import JoinBar from "@/components/JoinBar";
import CafeChat from "@/components/CafeChat";

export default async function CommunityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("communities").select("*").eq("slug", slug).maybeSingle();
  if (!data) notFound();
  const c = data as Community;
  const me = await getSessionProfile();
  const next = `/c/${c.slug}`;
  let joined = false;
  let count = 0;
  if (c.cafe_id) {
    const counted = await supabase.from("cafe_memberships").select("*", { count: "exact", head: true }).eq("cafe_id", c.cafe_id);
    count = counted.count ?? 0;
    if (me) {
      const mine = await supabase.from("cafe_memberships").select("user_id").eq("cafe_id", c.cafe_id).eq("user_id", me.id).maybeSingle();
      joined = !!mine.data;
    }
  } else {
    const counted = await supabase.rpc("community_member_count", { p_community_id: c.id });
    count = Number(counted.data ?? 0);
    if (me) {
      const room = await supabase.schema("chat").from("rooms").select("id").eq("context_type", "community").eq("context_id", c.id).maybeSingle();
      joined = !!room.data;
    }
  }
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold">{c.name}</h1>
          <p className="text-sm text-stone-500">
            {c.cafe_id ? "Cafe community. Join to enter the chat." : "Open discussion for everyone in LA coffee. Join to enter the chat."}
          </p>
        </div>
        {c.cafe_id ? (
          <JoinBar mode="cafe" cafeId={c.cafe_id} joined={joined} count={count} userId={me?.id ?? null} next={next} />
        ) : (
          <JoinBar mode="community" communityId={c.id} joined={joined} count={count} userId={me?.id ?? null} next={next} />
        )}
      </div>
      <CafeChat communityId={c.id} me={me} />
      <NewPostForm communityId={c.id} userId={me?.id ?? null} next={`/c/${c.slug}`} />
      <PostList communityId={c.id} />
    </div>
  );
}
