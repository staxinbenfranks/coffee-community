import type { CommentRow } from "@/lib/types";
import { fullDate, timeAgo } from "@/lib/format";
import Avatar from "./Avatar";
import DeleteCommentButton from "./DeleteCommentButton";
import ReplyForm from "./ReplyForm";

type Node = CommentRow & { children: Node[] };

function build(rows: CommentRow[]): Node[] {
  const map = new Map<string, Node>(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots: Node[] = [];
  for (const n of map.values()) {
    const parent = n.parent_comment_id ? map.get(n.parent_comment_id) : undefined;
    (parent ? parent.children : roots).push(n);
  }
  return roots;
}

function Comment({
  node, depth, signedIn, next, currentUserId, isAdmin,
}: {
  node: Node;
  depth: number;
  signedIn: boolean;
  next: string;
  currentUserId: string | null;
  isAdmin: boolean;
}) {
  const name = node.author?.display_name ?? node.author?.username ?? "someone";
  const count = (n: Node): number => n.children.reduce((a, c) => a + 1 + count(c), 0);
  const canDelete = !node.deleted_at && !!currentUserId && (node.author_id === currentUserId || isAdmin);
  return (
    <details open className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-stone-500">
        <Avatar url={node.author?.avatar_url} name={name} size={20} />
        <span className="font-medium text-stone-800">{name}</span>·
        <time title={fullDate(node.created_at)}>{timeAgo(node.created_at)}</time>
        {node.children.length > 0 && <span className="hidden group-[:not([open])]:inline">· {count(node) + 1} hidden</span>}
      </summary>
      <div className={`${depth < 5 ? "ml-2.5 border-l-2 border-stone-200 pl-3" : ""} mt-1`}>
        {node.deleted_at ? (
          <p className="text-sm italic text-stone-400">[deleted]</p>
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{node.body}</p>
        )}
        <div className="mt-1 space-y-1">
          <ReplyForm postId={node.post_id} parentId={node.id} signedIn={signedIn} next={next} />
          {canDelete ? <DeleteCommentButton commentId={node.id} postId={node.post_id} /> : null}
        </div>
        {node.children.length > 0 && (
          <div className="mt-3 space-y-4">
            {node.children.map((c) => (
              <Comment key={c.id} node={c} depth={depth + 1} signedIn={signedIn} next={next} currentUserId={currentUserId} isAdmin={isAdmin} />
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

export default function CommentThread({
  comments, signedIn, next, currentUserId = null, isAdmin = false,
}: {
  comments: CommentRow[];
  signedIn: boolean;
  next: string;
  currentUserId?: string | null;
  isAdmin?: boolean;
}) {
  const roots = build(comments);
  if (!roots.length) return <p className="text-sm text-stone-500">No replies yet. Be the first!</p>;
  return (
    <div className="space-y-5">
      {roots.map((n) => (
        <Comment key={n.id} node={n} depth={0} signedIn={signedIn} next={next} currentUserId={currentUserId} isAdmin={isAdmin} />
      ))}
    </div>
  );
}
