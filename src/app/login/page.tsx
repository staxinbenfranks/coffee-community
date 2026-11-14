import LoginForm from "@/components/LoginForm";
import { safeNext } from "@/lib/format";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <div className="mx-auto max-w-sm space-y-4 pt-6">
      <h1 className="text-2xl font-bold">Sign in or join</h1>
      <p className="text-sm text-stone-600">No password. We&apos;ll email you a link — new here? That creates your account.</p>
      {error === "link" && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          That sign-in link didn&apos;t work (it may have expired or been opened in a different browser). Request a new one below.
        </p>
      )}
      <LoginForm next={safeNext(next)} />
    </div>
  );
}
