import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import type { Community } from "@/lib/types";
import PostList from "@/components/PostList";
import NewPostForm from "@/components/NewPostForm";

export default async function CommunityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("communities").select("*").eq("slug", slug).maybeSingle();
  if (!data) notFound();
  const c = data as Community;
  const me = await getSessionProfile();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{c.name}</h1>
        <p className="text-sm text-stone-500">Open discussion for everyone in LA coffee.</p>
      </div>
      <NewPostForm communityId={c.id} userId={me?.id ?? null} next={`/c/${c.slug}`} />
      <PostList communityId={c.id} />
    </div>
  );
}
