import Link from "next/link";
import { getSessionProfile } from "@/lib/auth";
import { signOut } from "@/app/actions";
import Avatar from "./Avatar";

export default async function Header() {
  const me = await getSessionProfile();
  return (
    <header className="sticky top-0 z-10 border-b border-stone-200 bg-[#faf7f2]/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 text-sm">
        <Link href="/" className="font-bold tracking-tight text-amber-900">☕ LA Coffee</Link>
        <nav className="flex flex-1 gap-3 text-stone-600">
          <Link href="/cafes" className="hover:text-stone-900">Cafes</Link>
          <Link href="/c/la-coffee" className="hover:text-stone-900">Community</Link>
          {me?.is_admin && <Link href="/admin" className="hover:text-stone-900">Admin</Link>}
        </nav>
        {me ? (
          <div className="flex items-center gap-3">
            <Link href={`/u/${me.username}`} aria-label="Your profile"><Avatar url={me.avatar_url} name={me.display_name ?? me.username} /></Link>
            <form action={signOut}><button className="text-stone-500 hover:text-stone-900">Sign out</button></form>
          </div>
        ) : (
          <Link href="/login" className="rounded-full bg-amber-900 px-4 py-1.5 font-medium text-white">Sign in</Link>
        )}
      </div>
    </header>
  );
}
