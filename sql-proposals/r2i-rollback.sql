-- ============================================================================
-- Vyro Web — R2-I ROLLBACK for r2i-0001-profiles-username-audit.sql
-- STATUS: PROPOSAL ONLY. NOT EXECUTED ANYWHERE.
--
-- What this does, in dependency order:
--   1. Removes the auth.users trigger FIRST, so new sign-ups immediately
--      return to their pre-R2-I behaviour (account created, no profile).
--   2. Drops the helper functions.
--   3. Drops admin_audit_log and profiles.
-- auth.users itself is NEVER touched by this rollback: no account, password,
-- metadata or entitlement is created, changed or deleted here.
--
-- ⚠️ DATA LOSS WARNING: dropping profiles destroys the id→username mapping,
-- and dropping admin_audit_log destroys the admin action history
-- irreversibly. On STAGING (test fixtures only) that is acceptable. On
-- PRODUCTION this rollback is safe only BEFORE real users register; after
-- that, first export both tables, and note that a later re-install +
-- backfill would assign DIFFERENT usernames than the ones users had.
-- ============================================================================

drop trigger if exists on_auth_user_created on auth.users;

drop function if exists public.handle_new_user();
drop function if exists public.generate_username();
drop function if exists public.current_user_is_admin();

drop table if exists public.admin_audit_log;
drop table if exists public.profiles;
