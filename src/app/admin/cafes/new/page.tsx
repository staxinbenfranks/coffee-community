import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import CafeForm from "@/components/CafeForm";

export default async function NewCafe() {
  const me = await requireProfile("/admin/cafes/new");
  if (!me.is_admin) redirect("/");
  return (<div className="space-y-4"><h1 className="text-2xl font-bold">Add cafe</h1><CafeForm /></div>);
}
