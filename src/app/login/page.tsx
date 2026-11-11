import LoginForm from "@/components/LoginForm";
import { safeNext } from "@/lib/format";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto max-w-sm space-y-4 pt-6">
      <h1 className="text-2xl font-bold">Sign in or join</h1>
      <p className="text-sm text-stone-600">No password. We&apos;ll email you a link — new here? That creates your account.</p>
      <LoginForm next={safeNext(next)} />
    </div>
  );
}
