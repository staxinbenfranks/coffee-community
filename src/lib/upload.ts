import { createClient } from "@/lib/supabase/client";

export type Bucket = "avatars" | "cafe-photos" | "post-photos";
export type UploadedObject = { url: string; path: string };

const MAX_EDGE = 1600;
const TARGET_BYTES = 1_200_000;
const HARD_BYTES = 20 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function normalizedType(file: File): string {
  if (file.type === "image/jpg") return "image/jpeg";
  if (ALLOWED.has(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "";
}

function blobFromCanvas(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Shrink large phone photos before they leave the browser. GIFs are left intact when small. */
export async function prepareImage(file: File): Promise<File> {
  const type = normalizedType(file);
  if (!type) throw new Error("Use a JPG, PNG, WEBP, or GIF.");
  if (file.size > HARD_BYTES) throw new Error("That image is too large. Try one under 20 MB.");
  if (type === "image/gif") {
    if (file.size > 4 * 1024 * 1024) throw new Error("That GIF is too large. Try a smaller one.");
    return file;
  }
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    if (file.size > TARGET_BYTES) throw new Error("That image is too large. Try a smaller photo.");
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (file.size <= TARGET_BYTES) return file;
    throw new Error("Could not process that image. Try a JPG or PNG.");
  }

  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
    if (scale === 1 && file.size <= TARGET_BYTES) return file;

    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      if (file.size <= TARGET_BYTES) return file;
      throw new Error("Could not process that image. Try a JPG or PNG.");
    }
    ctx.drawImage(bitmap, 0, 0, width, height);

    const preferred = type === "image/png" || type === "image/webp" ? type : "image/jpeg";
    let blob = await blobFromCanvas(canvas, preferred, 0.82);
    if (blob && blob.size > 4_500_000 && preferred !== "image/jpeg") {
      blob = await blobFromCanvas(canvas, "image/jpeg", 0.82);
    }
    if (!blob || (blob.size >= file.size && scale === 1)) return file;

    const ext = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg";
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.${ext}`, { type: blob.type || "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

function extensionFor(file: File): string {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "jpg";
}

export async function uploadPublicObject(bucket: Bucket, folder: string, file: File): Promise<UploadedObject> {
  const prepared = await prepareImage(file);
  const supabase = createClient();
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensionFor(prepared)}`;
  const { error } = await supabase.storage.from(bucket).upload(path, prepared, {
    contentType: prepared.type || "image/jpeg",
  });
  if (error) throw error;
  return { path, url: supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl };
}

export async function uploadPublic(bucket: Bucket, folder: string, file: File): Promise<string> {
  const { url } = await uploadPublicObject(bucket, folder, file);
  return url;
}

export async function removePublic(bucket: Bucket, paths: string[]): Promise<void> {
  if (!paths.length) return;
  const supabase = createClient();
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) throw error;
}
