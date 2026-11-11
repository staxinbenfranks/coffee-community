import { requireProfile } from "@/lib/auth";
import ProfileForm from "@/components/ProfileForm";

export default async function EditProfile({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  const me = await requireProfile("/profile");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{welcome ? "Welcome! Set up your profile" : "Edit profile"}</h1>
      <ProfileForm profile={me} />
    </div>
  );
}
