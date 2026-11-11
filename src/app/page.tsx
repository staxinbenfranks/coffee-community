import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import PostCard from "@/components/PostCard";
import { POST_SELECT } from "@/components/PostList";
import type { PostRow } from "@/lib/types";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.from("posts").select(`${POST_SELECT}, community:communities(name, slug)`)
    .order("created_at", { ascending: false }).limit(20);
  const posts = (data ?? []) as unknown as (PostRow & { community: { name: string; slug: string } | null })[];
  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-amber-900 p-5 text-amber-50">
        <h1 className="text-2xl font-bold">Where LA coffee people talk shop</h1>
        <p className="mt-1 text-sm text-amber-100">Baristas, owners and coffee lovers — find a cafe and join the thread.</p>
        <form action="/cafes" className="mt-4 flex gap-2">
          <input name="q" placeholder="Search cafes…" className="min-w-0 flex-1 rounded-full px-4 py-2 text-stone-900" />
          <button className="rounded-full bg-amber-400 px-4 py-2 font-medium text-amber-950">Search</button>
        </form>
      </section>
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Latest threads</h2>
          <Link href="/c/la-coffee" className="text-sm font-medium text-amber-900">LA Coffee →</Link>
        </div>
        {posts.length ? posts.map((p) => (
          <div key={p.id}>
            {p.community && <Link href={p.community.slug.startsWith("cafe-") ? `/cafes/${p.community.slug.slice(5)}` : `/c/${p.community.slug}`} className="mb-1 ml-1 inline-block text-xs font-medium text-amber-900">{p.community.name}</Link>}
            <PostCard post={p} />
          </div>
        )) : <p className="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">No threads yet — be the first to post.</p>}
      </section>
    </div>
  );
}
