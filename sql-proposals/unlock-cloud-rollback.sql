-- unlock-cloud-rollback — restores the stage1 definition of
-- public.cloud_premium_active() (strict Premium-claims check), undoing
-- unlock-cloud-0001.sql.
create or replace function public.cloud_premium_active()
returns boolean
language plpgsql
stable
as $$
declare
  raw text;
  ts  timestamptz;
begin
  if (auth.jwt() -> 'app_metadata' -> 'premium') is distinct from 'true'::jsonb then
    return false;
  end if;
  raw := auth.jwt() -> 'app_metadata' ->> 'premium_until';
  if raw is null or raw = '' then
    return true;                       -- active, no expiry date
  end if;
  begin
    ts := raw::timestamptz;
  exception when others then
    return true;                       -- unparseable = active-no-date
  end;
  return ts > now();                   -- future = active, past = expired
end;
$$;
