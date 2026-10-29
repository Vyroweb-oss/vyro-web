# Vyro Web — Staging Environment Plan (files only — nothing here has been executed)

**Rule zero:** staging is a **separate** Supabase project. The production project
(`xwvofahsyrdwydlizyht`, used by the Vyro Android app and its real users) must never be
used for web testing, and no staging step may read, write or migrate production data.

## 1. Create the staging project (owner, in the Supabase dashboard)
1. supabase.com → New project. Name: `vyro-web-staging`. Region: any. Note the project ref —
   it must be **different** from the production ref.
2. No SQL is required: Vyro has no custom tables. Do **not** copy production users or data.

## 2. Mirror the production Auth settings
Dashboard → Authentication:
- Providers → Email: **ON**.
- Sign In / Up → **Confirm email: OFF** (mirrors production — signup returns a session immediately).
- Password policy: leave defaults.
No other settings change. (The production project's settings are not touched by this plan.)

## 3. Create test users
Create via Dashboard → Authentication → Users → Add user (staging project only):
| User | Purpose | app_metadata |
|---|---|---|
| `free@staging.test` | Free tier | `{}` (no premium flag) |
| `premium@staging.test` | Premium, active | `{"premium": true, "premium_until": "<tomorrow + 1 month, ISO-8601 UTC>"}` |
| `expired@staging.test` | Premium, expired | `{"premium": true, "premium_until": "2020-01-01T00:00:00Z"}` |
| `stringflag@staging.test` | Flag-type attack case | `{"premium": "true"}` (string, not boolean) |

Set `app_metadata` by editing the user in the dashboard ("User metadata" / raw JSON edit where
offered), or with the **staging** Admin API from a local shell:
`PUT /auth/v1/admin/users/<id>` with header `apikey: <STAGING service_role key>` and
`Authorization: Bearer <STAGING service_role key>`, body `{"app_metadata": {...}}`.
The staging service_role key is used **only** in that shell call / dashboard — it is never put
in web code, `.env.*` files for the browser, git, or chat documents. (Vyro Web reads entitlement
client-side only from a fresh `supabase.auth.getUser()` response, exactly like Android Model A.)

## 4. Entitlement test matrix (run against staging)
| # | Sign in as | Expected in web |
|---|---|---|
| 1 | signed out | Free editing; DOCX export / Print / custom templates show Premium modal |
| 2 | `free@staging.test` | Free; gated actions locked |
| 3 | `premium@staging.test` | Premium active; gated actions open; dashboard shows status `active` + until date |
| 4 | `expired@staging.test` | Status "Premium expired — Free"; documents open and edit normally; gated actions locked again |
| 5 | `stringflag@staging.test` | Free (string `"true"` must be rejected — Android rule; also unit-tested in `src/lib/entitlement.test.ts`) |
| 6 | premium user, then manually set a `vyro-web-*` premium-looking key in localStorage | No effect — the app never reads a browser-supplied premium flag |
| 7 | premium user goes offline after sign-in and reloads | Treated per fresh `getUser()` result only; no stored flag opens Premium |
| 8 | any user | Documents stay in browser localStorage only — nothing is uploaded to staging storage/DB |

## 5. Run the web app against staging
```bash
cp .env.staging.example .env.staging.local   # then fill in the STAGING url + publishable key
# Vite does not auto-load .env.staging.local for `npm run dev`; use one of:
#   a) copy those two values into .env.local instead (also gitignored), or
#   b) run:  npx vite --mode staging   (loads .env.staging + .env.staging.local)
npm run dev
```
Verify `.env.staging.local` is ignored: `.gitignore` contains `.env.*.local`, which covers it —
double-check with `git check-ignore .env.staging.local` once the project is under git.

## 6. Promotion rule
Only after the matrix above passes on staging may the owner decide — explicitly — to point a
preview deployment at production values. That decision, and any production change, is out of
scope for staging work and needs its own approval.
