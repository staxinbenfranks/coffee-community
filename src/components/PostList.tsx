import { createClient } from "@/lib/supabase/server";
import type { PostRow } from "@/lib/types";
import PostCard from "./PostCard";

export const POST_SELECT =
  "id, community_id, title, body, created_at, author:profiles(username, display_name, avatar_url, role), comments(count)";

export default async function PostList({ communityId }: { communityId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("posts")
    .select(POST_SELECT)
    .eq("community_id", communityId)
    .order("created_at", { ascending: false })
    .limit(50);
  const posts = (data ?? []) as unknown as PostRow[];
  if (!posts.length) return <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">No posts yet. Start the conversation!</p>;
  return <div className="space-y-3">{posts.map((p) => <PostCard key={p.id} post={p} />)}</div>;
}
