import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/format";

// Handles both magic-link styles:
// - token_hash links (work in any browser or email app, recommended email template)
// - PKCE ?code= links (only work in the same browser that requested the link)
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = safeNext(searchParams.get("next") ?? undefined);
  const tokenHash = searchParams.get("token_hash");
  const type = (searchParams.get("type") ?? "email") as EmailOtpType;
  const code = searchParams.get("code");
  const supabase = await createClient();

  if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(`${origin}/welcome?next=${encodeURIComponent(next)}`);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/welcome?next=${encodeURIComponent(next)}`);
  }
  return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent(next)}&error=link`);
}
