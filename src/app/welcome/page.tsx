import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth";
import { safeNext } from "@/lib/format";
import { isPlaceholderUsername } from "@/lib/username";
import UsernameForm from "@/components/UsernameForm";

// Landing spot after sign-in: placeholder usernames get claimed, then new users finish their profile.
export default async function Welcome({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const me = await getSessionProfile();
  if (!me) redirect("/login");
  const dest = safeNext(next);
  if (isPlaceholderUsername(me.username)) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Pick a username</h1>
        <p className="text-sm text-stone-600">This is how people find you. You can change it later from your profile.</p>
        <UsernameForm current={me.username} next={dest} />
      </div>
    );
  }
  if (!me.display_name) redirect(`/profile?welcome=1&next=${encodeURIComponent(dest)}`);
  redirect(dest);
}
