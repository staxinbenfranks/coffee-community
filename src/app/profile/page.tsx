import { requireProfile } from "@/lib/auth";
import { safeNext } from "@/lib/format";
import { isPlaceholderUsername } from "@/lib/username";
import ProfileForm from "@/components/ProfileForm";

export default async function EditProfile({ searchParams }: { searchParams: Promise<{ welcome?: string; next?: string }> }) {
  const { welcome, next } = await searchParams;
  const query = new URLSearchParams();
  if (welcome) query.set("welcome", "1");
  if (next) query.set("next", next);
  const me = await requireProfile(query.size ? `/profile?${query}` : "/profile");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{welcome ? "Welcome! Set up your profile" : "Edit profile"}</h1>
      {isPlaceholderUsername(me.username) ? (
        <p className="text-sm text-stone-600">Choose a username to replace the temporary one. It's how people find you.</p>
      ) : null}
      <ProfileForm profile={me} next={welcome && next ? safeNext(next) : undefined} />
    </div>
  );
}
