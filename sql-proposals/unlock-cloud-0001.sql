-- unlock-cloud-0001 — owner decision 2026-11-03: cloud documents are FREE
-- for every signed-in user (all Premium gates in Vyro Web were removed).
-- cloud_premium_active() now answers "is there an authenticated user?"
-- instead of reading the Premium claims from app_metadata.
-- Everything else is unchanged: the RLS policies still require
-- owner_id = auth.uid(), so a user can only ever read/write their OWN
-- documents; the guard triggers are untouched.
-- Rollback: unlock-cloud-rollback.sql (restores the stage1 definition).
create or replace function public.cloud_premium_active()
returns boolean
language plpgsql
stable
as $$
begin
  return auth.uid() is not null;
end;
$$;
