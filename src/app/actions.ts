"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { slugify, safeNext } from "@/lib/format";
import { isOwnPhotoPath, isSafeStoragePath, publicObjectUrl } from "@/lib/photos";
import { normalizeUsername } from "@/lib/username";

export type FormState = { error?: string; ok?: boolean } | undefined;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_POST_PHOTOS = 6;

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

function takenOr(error: { code?: string; message: string }): string {
  if (error.code === "23505" || /duplicate key|unique/i.test(error.message)) return "That username is taken.";
  return error.message;
}

function deleteError(error: { code?: string; message: string }, fallback: string): string {
  const msg = error.message ?? "";
  if (error.code === "42501" || error.code === "23514" || /row-level security|permission denied|check constraint/i.test(msg)) return fallback;
  return msg || fallback;
}

function photoPathsFromForm(fd: FormData, userId: string): { paths: string[] } | { error: string } {
  const paths = fd.getAll("photo_path").map((value) => String(value).trim()).filter(Boolean);
  if (paths.length > MAX_POST_PHOTOS) return { error: "A post can have at most 6 photos." };
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path) || !isOwnPhotoPath(path, userId)) return { error: "One of the photos could not be saved." };
    seen.add(path);
  }
  return { paths };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.schema("chat").rpc("touch_status", { p_status: "offline" });
  await supabase.auth.signOut();
  redirect("/");
}

export async function createPost(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Please sign in first." };
  const title = String(fd.get("title") ?? "").trim();
  const body = String(fd.get("body") ?? "").trim();
  if (!title) return { error: "Add a title." };
  const parsed = photoPathsFromForm(fd, user.id);
  if ("error" in parsed) return parsed;
  const paths = parsed.paths;

  const { data, error } = await supabase
    .from("posts")
    .insert({ community_id: String(fd.get("community_id")), author_id: user.id, title, body: body || null })
    .select("id")
    .single();
  if (error) {
    if (paths.length) await supabase.storage.from("post-photos").remove(paths);
    return { error: error.message };
  }

  if (paths.length) {
    const { error: photoError } = await supabase.from("post_photos").insert(
      paths.map((path, position) => ({
        post_id: data.id,
        author_id: user.id,
        path,
        url: publicObjectUrl("post-photos", path),
        position,
      })),
    );
    if (photoError) {
      await supabase.from("posts").delete().eq("id", data.id);
      await supabase.storage.from("post-photos").remove(paths);
      return { error: /at most 6/i.test(photoError.message) ? "A post can have at most 6 photos." : photoError.message };
    }
  }

  revalidatePath("/", "layout");
  redirect(`/post/${data.id}`);
}

export async function addPostPhoto(postId: string, path: string): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Please sign in first." };
  if (!UUID_RE.test(postId) || !isOwnPhotoPath(path, user.id)) return { error: "That photo could not be saved." };

  const { data: post } = await supabase.from("posts").select("author_id, deleted_at").eq("id", postId).maybeSingle();
  if (!post || post.author_id !== user.id) return { error: "Only the author can add photos." };
  if (post.deleted_at) return { error: "This post was deleted." };

  const { count } = await supabase.from("post_photos").select("id", { count: "exact", head: true }).eq("post_id", postId);
  if ((count ?? 0) >= MAX_POST_PHOTOS) return { error: "A post can have at most 6 photos." };

  const { error } = await supabase.from("post_photos").insert({
    post_id: postId,
    author_id: user.id,
    path,
    url: publicObjectUrl("post-photos", path),
    position: count ?? 0,
  });
  if (error) return { error: /at most 6/i.test(error.message) ? "A post can have at most 6 photos." : error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deletePostPhoto(postId: string, photoId: string): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Please sign in first." };
  if (!UUID_RE.test(postId) || !UUID_RE.test(photoId)) return { error: "Photo not found." };

  const { data: photo } = await supabase
    .from("post_photos")
    .select("id, path, author_id")
    .eq("id", photoId)
    .eq("post_id", postId)
    .maybeSingle();
  if (!photo || !isSafeStoragePath(photo.path)) return { error: "Photo not found." };

  const { data: me } = await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (photo.author_id !== user.id && !me?.is_admin) return { error: "You can't delete that photo." };

  const { error: storageError } = await supabase.storage.from("post-photos").remove([photo.path]);
  if (storageError) return { error: storageError.message };

  const { error } = await supabase.from("post_photos").delete().eq("id", photo.id);
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function reorderPostPhotos(postId: string, ids: string[]): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Please sign in first." };
  if (!UUID_RE.test(postId) || ids.some((id) => !UUID_RE.test(id))) return { error: "Those photos could not be reordered." };

  const { error } = await supabase.rpc("reorder_post_photos", { p_post_id: postId, p_ids: ids });
  if (error) {
    if (/only the author/i.test(error.message)) return { error: "Only the author can reorder photos." };
    if (/not signed in/i.test(error.message)) return { error: "Please sign in first." };
    if (/does not match/i.test(error.message)) return { error: "Those photos could not be reordered. Refresh and try again." };
    return { error: "Could not reorder photos." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deletePost(postId: string): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Please sign in first." };
  if (!UUID_RE.test(postId)) return { error: "Post not found." };

  const deletedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("posts")
    .update({ title: "[deleted]", body: null, deleted_at: deletedAt })
    .eq("id", postId)
    .is("deleted_at", null)
    .select("id");
  if (error) return { error: deleteError(error, "You can't delete that post.") };
  if (!data?.length) return { error: "You can't delete that post." };

  const { data: photos } = await supabase.from("post_photos").select("path").eq("post_id", postId);
  const paths = (photos ?? []).map((photo) => photo.path).filter((path) => isSafeStoragePath(path));
  if (paths.length) await supabase.storage.from("post-photos").remove(paths);
  await supabase.from("post_photos").delete().eq("post_id", postId);

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteComment(commentId: string, postId: string): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Please sign in first." };
  if (!UUID_RE.test(commentId) || !UUID_RE.test(postId)) return { error: "Reply not found." };

  const { data, error } = await supabase
    .from("comments")
    .update({ body: "", deleted_at: new Date().toISOString() })
    .eq("id", commentId)
    .eq("post_id", postId)
    .is("deleted_at", null)
    .select("id");
  if (error) return { error: deleteError(error, "You can't delete that reply.") };
  if (!data?.length) return { error: "You can't delete that reply." };
  revalidatePath(`/post/${postId}`);
  return { ok: true };
}

export async function createComment(_: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in first." };
  const body = String(fd.get("body") ?? "").trim();
  if (!body) return { error: "Write something first." };
  const postId = String(fd.get("post_id"));
  const parent = String(fd.get("parent_comment_id") ?? "");
  const { error } = await supabase
    .from("comments")
    .insert({ post_id: postId, parent_comment_id: parent || null, author_id: user.id, body });
  if (error) return { error: error.message };
  revalidatePath(`/post/${postId}`);
  return { ok: true };
}

export async function claimUsername(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Please sign in first." };
  const parsed = normalizeUsername(String(fd.get("username") ?? ""));
  if ("error" in parsed) return parsed;
  const { error } = await supabase.from("profiles").update({ username: parsed.username }).eq("id", user.id);
  if (error) return { error: takenOr(error) };
  const next = safeNext(String(fd.get("next") ?? ""));
  revalidatePath("/", "layout");
  redirect(`/welcome?next=${encodeURIComponent(next)}`);
}

export async function updateProfile(_: FormState, fd: FormData): Promise<FormState> {
  const { supabase, user } = await requireUser();
  if (!user) return { error: "Please sign in first." };
  const parsed = normalizeUsername(String(fd.get("username") ?? ""));
  if ("error" in parsed) return parsed;
  const display_name = String(fd.get("display_name") ?? "").trim();
  if (!display_name) return { error: "Add a display name." };
  const role = String(fd.get("role") ?? "");
  const { error } = await supabase
    .from("profiles")
    .update({
      username: parsed.username,
      display_name,
      bio: String(fd.get("bio") ?? "").trim() || null,
      city: String(fd.get("city") ?? "").trim() || null,
      avatar_url: String(fd.get("avatar_url") ?? "") || null,
      role: ["barista", "owner", "coffee_lover"].includes(role) ? role : null,
    })
    .eq("id", user.id);
  if (error) return { error: takenOr(error) };
  revalidatePath("/", "layout");
  const nextRaw = String(fd.get("next") ?? "");
  redirect(nextRaw ? safeNext(nextRaw) : `/u/${parsed.username}`);
}

export async function saveCafe(_: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in first." };
  const { data: me } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!me?.is_admin) return { error: "Admins only." };

  const s = (k: string) => String(fd.get(k) ?? "").trim() || null;
  const name = s("name");
  const city = s("city");
  const state = s("state");
  if (!name || !city || !state) return { error: "Name, city and state are required." };
  const id = String(fd.get("id") ?? "");
  const row = {
    name,
    slug: s("slug") ? slugify(s("slug")!) : slugify(name),
    city,
    state: state.toUpperCase(),
    address: s("address"),
    description: s("description"),
    menu_url: s("menu_url"),
    instagram: s("instagram"),
    tiktok: s("tiktok"),
    website: s("website"),
    photos: String(fd.get("photos") ?? "").split("\n").map((x) => x.trim()).filter(Boolean),
  };
  const { error } = id
    ? await supabase.from("cafes").update(row).eq("id", id)
    : await supabase.from("cafes").insert(row);
  if (error) return { error: error.code === "23505" ? "That URL slug is already used." : error.message };
  revalidatePath("/cafes");
  redirect(`/cafes/${row.slug}`);
}
