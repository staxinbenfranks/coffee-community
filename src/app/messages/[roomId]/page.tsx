import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadRoom } from "@/lib/chat";
import ChatRoom from "@/components/ChatRoom";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MessageThread({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  if (!UUID_RE.test(roomId)) notFound();
  const me = await requireProfile(`/messages/${roomId}`);
  const supabase = await createClient();
  const loaded = await loadRoom(supabase, roomId, me.id, me.is_admin);
  if (loaded.error) {
    return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{loaded.error}</p>;
  }
  if (!loaded.bundle) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">Conversation unavailable</h1>
        <p className="text-sm text-stone-600">Join the cafe to enter its chat, or start a message from someone&apos;s profile.</p>
        <Link href="/messages" className="inline-block text-sm font-medium text-amber-900">Back to messages</Link>
      </div>
    );
  }
  const bundle = loaded.bundle;
  let href: string | null = null;
  if (bundle.context_type === "community" && bundle.context_id) {
    const { data } = await supabase.from("communities").select("slug, cafe_id").eq("id", bundle.context_id).maybeSingle();
    const community = data as { slug: string; cafe_id: string | null } | null;
    if (community?.cafe_id) {
      const { data: cafe } = await supabase.from("cafes").select("slug").eq("id", community.cafe_id).maybeSingle();
      const slug = (cafe as { slug: string } | null)?.slug;
      href = slug ? `/cafes/${slug}` : `/c/${community.slug}`;
    } else if (community) {
      href = `/c/${community.slug}`;
    }
  }

  return (
    <ChatRoom
      roomId={bundle.id}
      me={me}
      title={bundle.title}
      initialMessages={bundle.messages}
      initialAuthors={bundle.authors}
      canModerate={bundle.canModerate}
      initiallyBlocked={bundle.blocked}
      hasMore={bundle.hasMore}
      variant="page"
      href={href}
    />
  );
}
