# Vyro Web

Independent desktop-first word processor in the Vyro family — separate from the Vyro Android app (`~/workspace/vyro/`, untouched by this project).

## Run
```bash
npm install
npm run dev      # local dev
npm run build    # tsc + vite build -> dist/
npm run preview  # preview the production build
npm test         # vitest (33 tests)
```

## UI language
Dashboard header has an **EN / فارسی** toggle. Persian mode makes the app chrome RTL with a Persian font stack and translates the dashboard, ribbon, status and Premium texts (`src/lib/i18n.ts`); the choice persists in `localStorage` key `vyro-web-ui-lang`. Document direction (RTL/LTR) stays a per-document setting, unchanged.

## Staging
See `docs/STAGING.md` and `.env.staging.example` for the separate staging-Supabase plan. Staging is a different project from production — never point the web app at production values for testing.

## Modes
- **Local mode (default):** no env vars → no network calls, banner "Local mode — account not connected", documents only in browser `localStorage` key `vyro-web-docs-v1`.
- **Connected mode:** copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` (publishable/anon key only — never a service_role key). Enables sign-in/up/out against the existing Vyro Supabase Auth project and server-verified Premium entitlement (see `docs/ARCHITECTURE-SECURITY.md`).

## Env vars
| Var | Required | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | No (local mode without it) | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | No (local mode without it) | Publishable/anon key only. Never service_role. |

Real values are **not** committed; no `.env` with real keys exists in this repo.

## Stack
React 19 + TypeScript + Vite 8, TipTap 3 (editor), @supabase/supabase-js, mammoth (DOCX import), docx (basic DOCX export), Vitest.

See `docs/FEATURE-REPORT.md` for completed vs incomplete features and `docs/ARCHITECTURE-SECURITY.md` for architecture & security.
