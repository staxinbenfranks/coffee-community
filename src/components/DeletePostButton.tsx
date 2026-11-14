"use client";

import { deletePost } from "@/app/actions";
import ConfirmDelete from "./ConfirmDelete";

export default function DeletePostButton({ postId }: { postId: string }) {
  return (
    <ConfirmDelete
      label="Delete"
      question="Delete this post? Replies stay, and the post will show as deleted."
      onConfirm={() => deletePost(postId)}
    />
  );
}
