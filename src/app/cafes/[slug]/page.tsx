/* eslint-disable @next/next/no-img-element */
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import { socialUrl } from "@/lib/format";
import type { Cafe, Community } from "@/lib/types";
import PostList from "@/components/PostList";
import NewPostForm from "@/components/NewPostForm";
import Link from "next/link";

export default async function CafePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("cafes").select("*").eq("slug", slug).maybeSingle();
  if (!data) notFound();
  const cafe = data as Cafe;
  const { data: comm } = await supabase.from("communities").select("*").eq("cafe_id", cafe.id).single();
  const community = comm as Community;
  const me = await getSessionProfile();

  const links = [
    cafe.website && { label: "Website", href: cafe.website },
    cafe.menu_url && { label: "Menu", href: cafe.menu_url },
    cafe.instagram && { label: "Instagram", href: socialUrl("instagram", cafe.instagram) },
    cafe.tiktok && { label: "TikTok", href: socialUrl("tiktok", cafe.tiktok) },
  ].filter(Boolean) as { label: string; href: string }[];

  return (
    <div className="space-y-5">
      {cafe.photos.length > 0 && (
        <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4">
          {cafe.photos.map((u) => <img key={u} src={u} alt="" className="h-48 w-72 shrink-0 snap-center rounded-xl object-cover" />)}
        </div>
      )}
      <div>
        <h1 className="text-2xl font-bold">{cafe.name}</h1>
        <p className="text-sm text-stone-500">
          {cafe.address ? (
            <a className="underline" href={`https://maps.google.com/?q=${encodeURIComponent(`${cafe.name} ${cafe.address} ${cafe.city} ${cafe.state}`)}`}>{cafe.address}, {cafe.city}, {cafe.state}</a>
          ) : `${cafe.city}, ${cafe.state}`}
        </p>
        {cafe.description && <p className="mt-2 text-sm">{cafe.description}</p>}
        {links.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {links.map((l) => <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="rounded-full border border-stone-300 px-3 py-1 text-sm">{l.label} ↗</a>)}
          </div>
        )}
        {me?.is_admin && <Link href={`/admin/cafes/${cafe.id}`} className="mt-3 inline-block text-xs text-stone-500 underline">Edit cafe</Link>}
      </div>
      <section className="space-y-3">
        <h2 className="font-semibold">Discussion</h2>
        <NewPostForm communityId={community.id} signedIn={!!me} next={`/cafes/${cafe.slug}`} />
        <PostList communityId={community.id} />
      </section>
    </div>
  );
}
