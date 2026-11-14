# LA Coffee Community (proof of concept)

Next.js 16 (App Router, TS, Tailwind) + Supabase (magic-link auth, Postgres, storage). Deploys to Vercel.

## What's built
Profiles · cafe pages · threaded posts with nested replies and timestamps · "LA Coffee" general space ·
cafe search (name / city / state) · admin pages to add/edit cafes · RLS (anyone reads, signed-in users write as themselves, admin-only cafes).
Upvotes were left out (optional in the brief).

## Setup (≈15 min)

1. **Supabase project**: create one at supabase.com.
2. **SQL Editor** → paste and run `supabase/schema.sql`, then `supabase/seed.sql`.
   Then **Integrations → Data API → Exposed schemas** and add `chat` (keep `public`). That is not the API Keys page. Chat, DMs, and the buddy list need this. See `docs/chat-backend.md`.
   An existing project must not re-run `schema.sql`. Run `supabase/migrations/003_chat.sql` instead, then expose `chat`, before deploying the app.
3. **Auth → URL Configuration**: set Site URL to your Vercel URL and add `http://localhost:3000/**` and `https://YOUR-APP.vercel.app/**` to Redirect URLs.
4. **Auth → Email Templates → Magic Link**: add the code so phone users who open the email in a different browser can still sign in:
   `<p>Or enter this code: <b>{{ .Token }}</b></p>` (the app has a code box for this).
   Supabase's built-in email sender is rate-limited (a few per hour) — for 10–20 friends signing up, configure custom SMTP (Resend, Postmark…) under Auth → SMTP.
5. `cp .env.local.example .env.local` and fill in the project URL and anon key (Project Settings → API).
6. `npm install && npm run dev`, open http://localhost:3000, sign in once.
7. **Make yourself admin** (SQL Editor):
   ```sql
   update public.profiles set is_admin = true
     where id = (select id from auth.users where email = 'YOUR_EMAIL');
   ```
   An **Admin** link appears in the header.

## Deploy to Vercel
Push to GitHub → import in Vercel → add the two `NEXT_PUBLIC_SUPABASE_*` env vars → deploy. Then put the Vercel URL in Supabase's Site URL (step 3).

## Notes
- **Seed data is placeholder.** The 20 cafes are real LA names, but addresses were filled in only where confident and all links/photos are empty. Verify and complete them in `/admin`.
- Each cafe automatically gets its own discussion community (database trigger); renaming a cafe renames it too.
- Moderation: admins (and authors) can delete posts/comments via RLS, but there's no UI yet — use the Supabase table editor.
- Next 16 renamed middleware to `proxy.ts` (`src/proxy.ts` refreshes the session).
