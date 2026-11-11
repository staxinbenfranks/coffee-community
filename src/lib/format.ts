export function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const steps: [number, string][] = [[60, "s"], [60, "m"], [24, "h"], [7, "d"], [4.345, "w"], [12, "mo"]];
  let n = s;
  for (const [div, unit] of steps) {
    if (n < div) return `${Math.floor(n)}${unit} ago`;
    n /= div;
  }
  return `${Math.floor(n)}y ago`;
}

export function fullDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
}

export function socialUrl(kind: "instagram" | "tiktok", v: string): string {
  if (/^https?:\/\//.test(v)) return v;
  const h = v.replace(/^@/, "");
  return kind === "instagram" ? `https://instagram.com/${h}` : `https://tiktok.com/@${h}`;
}

/** Only allow same-site relative redirects. */
export function safeNext(n: string | string[] | undefined): string {
  const v = Array.isArray(n) ? n[0] : n;
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/";
}
