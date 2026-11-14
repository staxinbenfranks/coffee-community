import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth";
import { fullDate, timeAgo } from "@/lib/format";
import { sortPhotos } from "@/lib/photos";
import type { CommentRow, PostPhoto } from "@/lib/types";
import Avatar from "@/components/Avatar";
import CommentThread from "@/components/CommentThread";
import DeletePostButton from "@/components/DeletePostButton";
import PostPhotos from "@/components/PostPhotos";
import ReplyForm from "@/components/ReplyForm";

const AUTHOR = "author:profiles(username, display_name, avatar_url, role)";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const postQuery = supabase
    .from("posts")
    .select(`id, author_id, title, body, created_at, deleted_at, ${AUTHOR}, community:communities(name, slug), photos:post_photos(id, url, position, created_at)`)
    .eq("id", id)
    .maybeSingle();
  const commentQuery = supabase
    .from("comments")
    .select(`id, post_id, parent_comment_id, author_id, body, created_at, deleted_at, ${AUTHOR}`)
    .eq("post_id", id)
    .order("created_at");
  const [{ data: post }, { data: comments }, me] = await Promise.all([postQuery, commentQuery, getSessionProfile()]);
  if (!post) notFound();

  const p = post as unknown as {
    author_id: string;
    title: string;
    body: string | null;
    created_at: string;
    deleted_at: string | null;
    photos: PostPhoto[] | null;
    author: { username: string; display_name: string | null; avatar_url: string | null } | null;
    community: { name: string; slug: string } | null;
  };
  const back = p.community ? (p.community.slug.startsWith("cafe-") ? `/cafes/${p.community.slug.slice(5)}` : `/c/${p.community.slug}`) : "/";
  const name = p.author?.display_name ?? p.author?.username ?? "someone";
  const rows = (comments ?? []) as unknown as CommentRow[];
  const deleted = Boolean(p.deleted_at);
  const isAuthor = me?.id === p.author_id;
  const photos = deleted ? [] : sortPhotos(p.photos);

  return (
    <div className="space-y-5">
      <Link href={back} className="text-sm text-amber-900">← {p.community?.name ?? "Back"}</Link>
      <article className="space-y-2">
        <h1 className={deleted ? "text-xl font-bold italic leading-snug text-stone-400" : "text-xl font-bold leading-snug"}>{deleted ? "[deleted]" : p.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
          <Avatar url={p.author?.avatar_url} name={name} size={20} />
          {p.author ? <Link href={`/u/${p.author.username}`} className="font-medium text-stone-800">{name}</Link> : name}
          ·<time title={fullDate(p.created_at)}>{timeAgo(p.created_at)}</time>
          {!deleted && me && (isAuthor || me.is_admin) ? <DeletePostButton postId={id} /> : null}
        </div>
        <PostPhotos
          postId={id}
          photos={photos}
          userId={me?.id ?? null}
          canAdd={Boolean(isAuthor && !deleted)}
          canReorder={Boolean(isAuthor && !deleted)}
          canDelete={Boolean(me && (isAuthor || me.is_admin) && !deleted)}
        />
        {!deleted && p.body ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{p.body}</p> : null}
      </article>
      <section className="rounded-xl border border-stone-200 bg-white p-4">
        <ReplyForm postId={id} signedIn={!!me} next={`/post/${id}`} label="Add a reply" open />
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">{rows.length} {rows.length === 1 ? "reply" : "replies"}</h2>
        <CommentThread comments={rows} signedIn={!!me} next={`/post/${id}`} currentUserId={me?.id ?? null} isAdmin={!!me?.is_admin} />
      </section>
    </div>
  );
}
