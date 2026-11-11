import Link from "next/link";
import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Cafe } from "@/lib/types";

export default async function Admin() {
  const me = await requireProfile("/admin");
  if (!me.is_admin) redirect("/");
  const supabase = await createClient();
  const { data } = await supabase.from("cafes").select("*").order("name");
  const cafes = (data ?? []) as Cafe[];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin · Cafes</h1>
        <Link href="/admin/cafes/new" className="rounded-full bg-amber-900 px-4 py-2 text-sm font-medium text-white">＋ Add cafe</Link>
      </div>
      <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
        {cafes.map((c) => (
          <li key={c.id}>
            <Link href={`/admin/cafes/${c.id}`} className="flex items-center justify-between p-3">
              <span><span className="font-medium">{c.name}</span><span className="block text-xs text-stone-500">{c.city}, {c.state}{!c.address && " · no address"}</span></span>
              <span className="text-sm text-amber-900">Edit</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
