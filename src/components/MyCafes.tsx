import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function MyCafes({ userId, heading }: { userId: string; heading: string }) {
  const supabase = await createClient();
  const { data: memberships, error } = await supabase.from("cafe_memberships").select("cafe_id").eq("user_id", userId);
  if (error) return <p className="text-sm text-red-600">{error.message}</p>;
  const ids = ((memberships ?? []) as { cafe_id: string }[]).map((row) => row.cafe_id);
  const { data: cafes } = ids.length
    ? await supabase.from("cafes").select("id, name, slug, city, state").in("id", ids)
    : { data: [] as { id: string; name: string; slug: string; city: string; state: string }[] };
  const list = ((cafes ?? []) as { id: string; name: string; slug: string; city: string; state: string }[])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{heading}</h2>
      {list.length === 0 ? (
        <p className="text-sm text-stone-500">{heading === "My cafes" ? "You haven't joined a cafe yet." : "No cafes yet."}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((cafe) => (
            <li key={cafe.id}>
              <Link href={`/cafes/${cafe.slug}`} className="block rounded-xl border border-stone-200 bg-white px-3 py-2 active:bg-stone-50">
                <span className="font-medium">{cafe.name}</span>
                <span className="mt-0.5 block text-sm text-stone-500">{cafe.city}, {cafe.state}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
