import { notFound, redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import CafeForm from "@/components/CafeForm";
import type { Cafe } from "@/lib/types";

export default async function EditCafe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireProfile(`/admin/cafes/${id}`);
  if (!me.is_admin) redirect("/");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("cafes").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  return (<div className="space-y-4"><h1 className="text-2xl font-bold">Edit cafe</h1><CafeForm cafe={data as Cafe} /></div>);
}
