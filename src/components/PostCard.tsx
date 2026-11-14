/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { PostRow } from "@/lib/types";
import { sortPhotos } from "@/lib/photos";
import { fullDate, timeAgo } from "@/lib/format";
import Avatar from "./Avatar";

export default function PostCard({ post }: { post: PostRow }) {
  const n = post.comments?.[0]?.count ?? 0;
  const name = post.author?.display_name ?? post.author?.username ?? "someone";
  const deleted = Boolean(post.deleted_at);
  const photos = deleted ? [] : sortPhotos(post.photos);
  return (
    <Link href={`/post/${post.id}`} className="block rounded-xl border border-stone-200 bg-white p-4 active:bg-stone-50">
      <h3 className={deleted ? "font-semibold italic text-stone-400" : "font-semibold leading-snug"}>{deleted ? "[deleted]" : post.title}</h3>
      {!deleted && post.body ? <p className="mt-1 line-clamp-2 text-sm text-stone-600">{post.body}</p> : null}
      {photos.length === 1 ? (
        <img src={photos[0].url} alt="" className="mt-2 h-40 w-full rounded-lg object-cover" />
      ) : photos.length > 0 ? (
        <div className="mt-2 flex gap-1.5 overflow-x-auto">
          {photos.map((photo) => (
            <img key={photo.id} src={photo.url} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex items-center gap-2 text-xs text-stone-500">
        <Avatar url={post.author?.avatar_url} name={name} size={20} />
        <span>{name}</span>·<time title={fullDate(post.created_at)}>{timeAgo(post.created_at)}</time>·
        <span>{n} {n === 1 ? "reply" : "replies"}</span>
      </div>
    </Link>
  );
}
