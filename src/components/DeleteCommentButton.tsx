"use client";

import { deleteComment } from "@/app/actions";
import ConfirmDelete from "./ConfirmDelete";

export default function DeleteCommentButton({ commentId, postId }: { commentId: string; postId: string }) {
  return (
    <ConfirmDelete
      label="Delete"
      question="Delete this reply? Replies under it will stay."
      onConfirm={() => deleteComment(commentId, postId)}
    />
  );
}
