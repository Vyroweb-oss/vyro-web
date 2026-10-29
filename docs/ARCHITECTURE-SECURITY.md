# Vyro Web — Architecture & Security Plan

## Inspected current state (read-only, from Android project — no production changes made)
- Supabase project `https://xwvofahsyrdwydlizyht.supabase.co`; Android client ships **only the publishable (anon) key** (public by design). service_role is never in any client.
- **No custom tables:** no `profiles`, no `subscriptions`. Entitlement lives in Supabase Auth `app_metadata`: `premium` (strict JSON boolean `true` only — string `"true"` does **not** count) and `premium_until` (ISO-8601 UTC). Active iff `premium===true` AND (`premium_until` missing/unparseable → active-no-date; future → active; past → EXPIRED).
- `app_metadata` is writable only with service_role, so clients cannot self-grant Premium. `user_metadata` (user-writable): `display_name`, `avatar_url`, `last_seen_at`.
- Auth: GoTrue email+password; email provider ON, Confirm email OFF (verified 2026-10-28 — signup returns a token immediately). Endpoints: `/auth/v1/signup`, `/token?grant_type=password`, `/token?grant_type=refresh_token`, `GET /auth/v1/user`, `/auth/v1/logout`.
- Android tier rule (Model A): tier only from a server-verified user fetched **this session**; a stored flag never opens Premium offline. Web mirrors this exactly.
- Plans: Free; Monthly 80 AFN/1 mo; Quarterly 199 AFN/3 mo (~17% saving). Manual HesabPay to +93 779 528 228, receipt + account email via WhatsApp, owner flips `app_metadata` server-side.
- Storage: only bucket `avatars` (public read, owner-only write under `<uid>/`). Documents are never uploaded in Android — local only. Latest Android 1.14.0, 37 Premium features (`Premium.kt`).

## Web architecture (v1)
- Vite + React + TypeScript, component split: `App.tsx` (dashboard, auth, premium modal), `components/Editor.tsx` (ribbon + A4 canvas), pure logic in `src/lib/` (`entitlement.ts`, `store.ts`, `templates.ts`, `dir.ts`, `docx.ts`, `supabase.ts`) — pure modules are unit-tested without React.
- Documents: browser `localStorage` (`vyro-web-docs-v1`), TipTap JSON as source of truth. Autosave debounced 500 ms. No document leaves the browser except via explicit user export/download or explicit import file pick.
- Routing: single-page state (dashboard ↔ editor). No backend of its own.

## Editor choice rationale
Evaluated against: formatting breadth, RTL, pagination, DOCX.
- **TipTap 3 (chosen):** ProseMirror-based, strong marks/nodes, TextStyle/FontSize/Color, tables, real RTL via `dir` attribute on the document (Arabic-script shaping is done by the browser text engine — correct for Dari), active maintenance, React integration. Pagination: **not true paginated editing** — v1 uses a continuous A4-width page (210 mm, min-height 297 mm) + an explicit page-break node + print CSS `@page A4`; honest limitation, listed in FEATURE-REPORT.
- Quill: simpler but weaker tables/custom nodes and DOCX structure. Slate: fully custom (more build risk for tables/RTL). CKEditor/TinyMCE: licensing/telemetry considerations for a commercial family product.
- DOCX: mammoth (import, HTML conversion — basic formatting) + `docx` package (export from TipTap JSON — headings/bold/italic/alignment/lists at basic level). Neither gives Word-perfect fidelity; labelled "basic" in UI.

## Security plan
- Client holds **only** `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` (`.env.example` lists placeholders only; no real `.env` committed, no service_role anywhere — grep-verifiable).
- Entitlement: `computeEntitlement(user, now)` in `src/lib/entitlement.ts` implements the exact Android rule; called **only** with a user object freshly fetched via `supabase.auth.getUser()` on load and on sign-in/auth-change. No localStorage Premium flag is ever read or trusted. Premium gates only DOCX export, Print/PDF, and custom templates in web v1.
- **Expired ≠ locked:** free editing always remains available; expiry only re-locks the three gated exports.
- RLS: no user tables exist today, so **no RLS policies are needed or created yet**. The `avatars` bucket policies already exist in Android's setup SQL and are not modified.
- Secrets: never log keys, never put them in URLs beyond the Supabase client's normal use, `.env*` (except `.env.example`) gitignored.
- Future server operations: before any future paid **server** operation, verify entitlement server-side in a Supabase Edge Function (re-fetch user with the caller's JWT, re-apply the same `app_metadata` rule) — do not trust a client-computed flag for server resources.

## Future cloud sync (design only — NOT built, NOT enabled)
Requires explicit user approval + per-user consent toggle before any upload:
```sql
-- SKETCH ONLY — do not run without approval
create table public.documents (
  id uuid primary key, owner uuid not null references auth.users(id),
  title text not null, content jsonb not null, folder text default '',
  favorite boolean default false, dir text default 'ltr',
  created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table public.documents enable row level security;
create policy "owner only" on public.documents
  for all using (auth.uid() = owner) with check (auth.uid() = owner);
```
Sync would be opt-in, off by default, with a clear "documents stay on this device unless you turn on sync" notice.

## Deployment
Preview only. No production publish, DNS change, data migration, or subscription change is authorised by this build. Suggested preview: `npm run build` + any static preview host (e.g. Vercel/Netlify preview) with the two env vars set in that host's preview environment only.
