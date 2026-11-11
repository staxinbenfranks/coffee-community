import Link from "next/link";
import type { PostRow } from "@/lib/types";
import { fullDate, timeAgo } from "@/lib/format";
import Avatar from "./Avatar";

export default function PostCard({ post }: { post: PostRow }) {
  const n = post.comments?.[0]?.count ?? 0;
  const name = post.author?.display_name ?? post.author?.username ?? "someone";
  return (
    <Link href={`/post/${post.id}`} className="block rounded-xl border border-stone-200 bg-white p-4 active:bg-stone-50">
      <h3 className="font-semibold leading-snug">{post.title}</h3>
      {post.body && <p className="mt-1 line-clamp-2 text-sm text-stone-600">{post.body}</p>}
      <div className="mt-3 flex items-center gap-2 text-xs text-stone-500">
        <Avatar url={post.author?.avatar_url} name={name} size={20} />
        <span>{name}</span>·<time title={fullDate(post.created_at)}>{timeAgo(post.created_at)}</time>·
        <span>{n} {n === 1 ? "reply" : "replies"}</span>
      </div>
    </Link>
  );
}
