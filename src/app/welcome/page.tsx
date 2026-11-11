import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { safeNext } from "@/lib/format";

// Landing spot after sign-in: new users finish their profile first.
export default async function Welcome({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const me = await getSessionProfile();
  if (!me) redirect("/login");
  if (!me.display_name) redirect(`/profile?welcome=1&next=${encodeURIComponent(safeNext(next))}`);
  redirect(safeNext(next));
}
