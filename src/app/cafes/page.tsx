import { createClient } from "@/lib/supabase/server";
import CafeCard from "@/components/CafeCard";
import type { Cafe } from "@/lib/types";

export default async function Cafes({ searchParams }: { searchParams: Promise<{ q?: string; city?: string; state?: string }> }) {
  const { q = "", city = "", state = "" } = await searchParams;
  const supabase = await createClient();
  // strip characters that would break the PostgREST filter syntax
  const clean = (s: string) => s.replace(/[%,()*]/g, " ").trim();
  let query = supabase.from("cafes").select("*").order("name").limit(100);
  if (clean(q)) query = query.ilike("name", `%${clean(q)}%`);
  if (clean(city)) query = query.ilike("city", `%${clean(city)}%`);
  if (clean(state)) query = query.ilike("state", clean(state));
  const { data } = await query;
  const cafes = (data ?? []) as Cafe[];
  const input = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2";
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Cafes</h1>
      <form className="grid grid-cols-3 gap-2">
        <input name="q" defaultValue={q} placeholder="Cafe name" className={`${input} col-span-3`} />
        <input name="city" defaultValue={city} placeholder="City" className={`${input} col-span-2`} />
        <input name="state" defaultValue={state} placeholder="State" maxLength={2} className={input} />
        <button className="col-span-3 rounded-full bg-amber-900 py-2 font-medium text-white">Search</button>
      </form>
      <p className="text-sm text-stone-500">{cafes.length} {cafes.length === 1 ? "cafe" : "cafes"}</p>
      <div className="space-y-3">{cafes.map((c) => <CafeCard key={c.id} cafe={c} />)}</div>
    </div>
  );
}
