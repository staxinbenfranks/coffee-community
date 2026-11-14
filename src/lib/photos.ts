export type PhotoRef = {
  id: string;
  url: string;
  position: number;
  created_at?: string | null;
};

const SAFE_PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i;

export function isSafeStoragePath(path: string): boolean {
  return SAFE_PATH.test(path) && !path.includes("..");
}

export function isOwnPhotoPath(path: string, userId: string): boolean {
  return isSafeStoragePath(path) && path.startsWith(`${userId}/`);
}

export function publicObjectUrl(bucket: string, path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const encoded = path.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `${base}/storage/v1/object/public/${bucket}/${encoded}`;
}

export function sortPhotos<T extends PhotoRef>(photos: readonly T[] | null | undefined): T[] {
  return [...(photos ?? [])].sort(
    (a, b) => a.position - b.position || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
  );
}
