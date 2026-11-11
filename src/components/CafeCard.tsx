/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { Cafe } from "@/lib/types";

export default function CafeCard({ cafe }: { cafe: Cafe }) {
  return (
    <Link href={`/cafes/${cafe.slug}`} className="flex gap-3 rounded-xl border border-stone-200 bg-white p-3 active:bg-stone-50">
      {cafe.photos[0] ? (
        <img src={cafe.photos[0]} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-2xl">☕</div>
      )}
      <div className="min-w-0">
        <h3 className="truncate font-semibold">{cafe.name}</h3>
        <p className="text-sm text-stone-500">{cafe.city}, {cafe.state}</p>
        {cafe.description && <p className="mt-0.5 line-clamp-1 text-sm text-stone-600">{cafe.description}</p>}
      </div>
    </Link>
  );
}
