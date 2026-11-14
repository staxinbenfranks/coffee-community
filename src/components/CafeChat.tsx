import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadRoom } from "@/lib/chat";
import type { Profile } from "@/lib/types";
import ChatRoom from "./ChatRoom";

export default async function CafeChat({
  communityId,
  me,
  heading = "Chat",
}: {
  communityId: string;
  me: Profile | null;
  heading?: string;
}) {
  if (!me) {
    return (
      <section className="space-y-2">
        <h2 className="font-semibold">{heading}</h2>
        <p className="rounded-xl border border-dashed border-stone-300 p-4 text-sm text-stone-600">Sign in and join to read and send messages.</p>
      </section>
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("chat")
    .from("rooms")
    .select("id")
    .eq("context_type", "community")
    .eq("context_id", communityId)
    .maybeSingle();
  if (error) {
    return <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error.message}</p>;
  }
  const roomId = (data as { id: string } | null)?.id;
  if (!roomId) {
    return (
      <section className="space-y-2">
        <h2 className="font-semibold">{heading}</h2>
        <p className="rounded-xl border border-dashed border-stone-300 p-4 text-sm text-stone-600">Join to read and send messages. Only members can see this chat.</p>
      </section>
    );
  }

  const loaded = await loadRoom(supabase, roomId, me.id, me.is_admin);
  if (loaded.error || !loaded.bundle) {
    return <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{loaded.error ?? "Chat is unavailable."}</p>;
  }
  const bundle = loaded.bundle;
  let href: string | null = null;
  if (bundle.context_type === "community" && bundle.context_id) {
    const { data: community } = await supabase.from("communities").select("slug, cafe_id").eq("id", bundle.context_id).maybeSingle();
    const row = community as { slug: string; cafe_id: string | null } | null;
    if (row?.cafe_id) {
      const { data: cafe } = await supabase.from("cafes").select("slug").eq("id", row.cafe_id).maybeSingle();
      const cafeSlug = (cafe as { slug: string } | null)?.slug;
      href = cafeSlug ? `/cafes/${cafeSlug}` : `/c/${row.slug}`;
    } else if (row) {
      href = `/c/${row.slug}`;
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">{heading}</h2>
        <Link href={`/messages/${bundle.id}`} className="text-sm font-medium text-amber-900">Full screen</Link>
      </div>
      <ChatRoom
        roomId={bundle.id}
        me={me}
        title={bundle.title}
        initialMessages={bundle.messages}
        initialAuthors={bundle.authors}
        canModerate={bundle.canModerate}
        initiallyBlocked={bundle.blocked}
        hasMore={bundle.hasMore}
        variant="embedded"
        href={href}
      />
    </section>
  );
}
