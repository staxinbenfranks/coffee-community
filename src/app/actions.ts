"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { slugify } from "@/lib/format";

export type FormState = { error?: string; ok?: boolean } | undefined;

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

export async function createPost(_: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in first." };
  const title = String(fd.get("title") ?? "").trim();
  const body = String(fd.get("body") ?? "").trim();
  if (!title) return { error: "Add a title." };
  const { data, error } = await supabase
    .from("posts")
    .insert({ community_id: String(fd.get("community_id")), author_id: user.id, title, body: body || null })
    .select("id")
    .single();
  if (error) return { error: error.message };
  redirect(`/post/${data.id}`);
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

export async function updateProfile(_: FormState, fd: FormData): Promise<FormState> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in first." };
  const username = String(fd.get("username") ?? "").trim().toLowerCase();
  const display_name = String(fd.get("display_name") ?? "").trim();
  if (!/^[a-z0-9_]{3,20}$/.test(username)) return { error: "Username: 3–20 letters, numbers or underscores." };
  if (!display_name) return { error: "Add a display name." };
  const role = String(fd.get("role") ?? "");
  const { error } = await supabase
    .from("profiles")
    .update({
      username,
      display_name,
      bio: String(fd.get("bio") ?? "").trim() || null,
      city: String(fd.get("city") ?? "").trim() || null,
      avatar_url: String(fd.get("avatar_url") ?? "") || null,
      role: ["barista", "owner", "coffee_lover"].includes(role) ? role : null,
    })
    .eq("id", user.id);
  if (error) return { error: error.code === "23505" ? "That username is taken." : error.message };
  revalidatePath("/", "layout");
  redirect(`/u/${username}`);
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
