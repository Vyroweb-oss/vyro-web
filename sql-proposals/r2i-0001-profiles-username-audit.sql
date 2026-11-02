-- ============================================================================
-- Vyro Web — R2-I PROPOSAL: profiles + auto username + admin audit log
-- STATUS: PROPOSAL ONLY. NOT EXECUTED ANYWHERE. Owner review pending.
-- May be run ONLY on the STAGING project (xsatlrisuseyhrwryazt), ONLY after
-- explicit owner approval. Running it on the production project
-- (xwvofahsyrdwydlizyht — SHARED with Vyro Android) needs its own separate
-- approval and re-verification.
--
-- Product decisions encoded here (owner, 2026-11-02 ~16:44 +0430):
--  * Instant registration: email + password, real Supabase Auth account at
--    sign-up, NO admin approval, NO request queue.
--  * username is auto-generated: 'user_' + 8 random [a-z0-9] characters,
--    unique, and IMMUTABLE in v1 (no client write path exists at all).
--  * Premium lives ONLY in Auth app_metadata (premium / premium_until) —
--    the single source of truth read by src/lib/entitlement.ts. This file
--    deliberately creates NO premium column anywhere.
--  * Passwords are never stored outside Supabase Auth. profiles holds no
--    password, no email, no premium data.
--  * Admin role lives ONLY in app_metadata.role = 'admin'. Nothing in this
--    file grants it; see the design document for the one-time, out-of-band
--    initial-admin procedure.
--
-- The file is re-runnable: IF NOT EXISTS / DROP ... IF EXISTS guards make a
-- second run a safe no-shape-change pass.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) profiles — one row per Auth user, created by the trigger in section 3.
--    id IS the auth.users id (same identity, no second account system).
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- v1 format lock: exactly 'user_' + 8 lowercase letters/digits. If chosen
  -- usernames are ever allowed, this CHECK must be relaxed in a new,
  -- separately approved migration — it is what makes "auto-generated and
  -- fixed" a database guarantee instead of a UI promise.
  constraint profiles_username_format check (username ~ '^user_[a-z0-9]{8}$')
);

-- The hard uniqueness guarantee. Generation retries are only a courtesy;
-- THIS index is what makes duplicates impossible, including under
-- concurrent sign-ups.
create unique index if not exists profiles_username_unique
  on public.profiles (username);

-- ----------------------------------------------------------------------------
-- 2) generate_username() — random candidate that is not currently taken.
--    36^8 ≈ 2.8 trillion combinations; collisions are practically impossible
--    at any realistic user count, and the unique index + the retry loop in
--    handle_new_user() absorb the theoretical race anyway.
-- ----------------------------------------------------------------------------
create or replace function public.generate_username()
returns text
language plpgsql
volatile
as $$
declare
  alphabet  constant text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  candidate text;
  suffix    text;
  i         integer;
  tries     integer := 0;
begin
  loop
    suffix := '';
    for i in 1..8 loop
      suffix := suffix || substr(alphabet, 1 + floor(random() * 36)::integer, 1);
    end loop;
    candidate := 'user_' || suffix;
    exit when not exists (select 1 from public.profiles p where p.username = candidate);
    tries := tries + 1;
    if tries > 25 then
      raise exception 'generate_username: no free username after 25 attempts';
    end if;
  end loop;
  return candidate;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) handle_new_user() + trigger on auth.users.
--    AFTER INSERT: EVERY new Auth account gets a profile + username in the
--    same transaction — web sign-up, Android sign-up, Admin-API creation and
--    dashboard creation alike. Existing accounts are NOT touched (the
--    trigger fires only for new rows; see the optional backfill, section 6).
--    Failure semantics (deliberate, fail-closed): if username allocation
--    somehow exhausts its retries, the exception rolls back the auth.users
--    insert and that single sign-up fails loudly instead of leaving an
--    account without a profile. Bounded retries (generator re-draw + 5
--    insert retries) make this unreachable in practice; the concurrency
--    test in the design document is the gate that proves it.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tries integer := 0;
begin
  loop
    begin
      insert into public.profiles (id, username)
      values (new.id, public.generate_username());
      return new;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise; end if;
    end;
  end loop;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 4) admin_audit_log — append-only record of admin mutations.
--    Written ONLY by the admin Edge Functions (service role). No client
--    policies exist: anon and authenticated are fully denied.
--    actor_id / target_user_id deliberately carry NO foreign key: an audit
--    row must survive deletion of the accounts it describes.
-- ----------------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id             bigint generated always as identity primary key,
  actor_id       uuid not null,        -- the admin who acted
  target_user_id uuid not null,        -- the user whose Premium changed
  action         text not null
    constraint admin_audit_log_action_check
    check (action in ('premium_activate', 'premium_extend', 'premium_deactivate')),
  before_state   jsonb,                -- {premium, premium_until} before
  after_state    jsonb,                -- {premium, premium_until} after
  created_at     timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;
revoke all on table public.admin_audit_log from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5) profiles RLS — a signed-in user can read ONLY their own row (that is
--    all the web app needs to show "your username" in the profile).
--    Deliberately NO insert/update/delete policies for authenticated:
--    rows are created only by the security-definer trigger above, and a v1
--    username can never be changed by any client path.
--    The admin Edge Functions use the service role (bypasses RLS) only
--    AFTER verifying the caller's admin role server-side.
-- ----------------------------------------------------------------------------
alter table public.profiles enable row level security;
revoke all on table public.profiles from anon;
grant select on table public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- ----------------------------------------------------------------------------
-- 6) current_user_is_admin() — convenience helper for UI hints / future RLS.
--    Reads the role from the caller's verified JWT claims. The admin Edge
--    Functions do NOT rely on this alone: they re-fetch the user from the
--    Auth server (auth.getUser) and read app_metadata there.
-- ----------------------------------------------------------------------------
create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

-- ============================================================================
-- 7) OPTIONAL BACKFILL — *** COMMENTED OUT — DO NOT RUN ***
--    Separate owner approval required. Creates profiles + usernames for
--    accounts that already exist (web + Android). Read-only toward
--    auth.users: it never modifies an existing account, password, metadata
--    or entitlement. Idempotent: rows that already have a profile are
--    skipped, so a re-run changes nothing. Per-row retry mirrors the
--    trigger's race protection.
-- ----------------------------------------------------------------------------
-- do $$
-- declare
--   r record;
--   tries integer;
-- begin
--   for r in
--     select u.id
--     from auth.users u
--     where not exists (select 1 from public.profiles p where p.id = u.id)
--   loop
--     tries := 0;
--     loop
--       begin
--         insert into public.profiles (id, username)
--         values (r.id, public.generate_username());
--         exit;
--       exception when unique_violation then
--         tries := tries + 1;
--         if tries > 5 then raise; end if;
--       end;
--     end loop;
--   end loop;
-- end $$;
-- ============================================================================
