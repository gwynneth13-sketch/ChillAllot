-- Additive: existing Android FCM and browser Web Push registrations stay intact.
begin;
create table public.ios_push_devices (
 id uuid primary key default gen_random_uuid(),
 installation_id uuid not null unique,
 user_id uuid not null references auth.users(id) on delete cascade,
 token text not null check(length(token) between 32 and 512 and token ~ '^[a-f0-9]+$'),
 environment text not null check(environment in ('sandbox','production')),
 app_id text not null default 'com.gwynneth13.chillallot'
   check(app_id='com.gwynneth13.chillallot'),
 updated_at timestamptz not null default now(),
 unique(token,environment)
);
create index ios_push_devices_user_id_idx on public.ios_push_devices(user_id);
alter table public.ios_push_devices enable row level security;
revoke all on public.ios_push_devices from public,anon,authenticated;
grant select on public.ios_push_devices to authenticated;
grant all on public.ios_push_devices to service_role;
create policy ios_push_devices_read_own on public.ios_push_devices for select
 to authenticated using ((select auth.uid())=user_id);

-- A restricted registration API is needed because clients may not directly
-- insert/update device ownership. The caller cannot supply a user ID or app ID.
create or replace function public.register_ios_push_device(
 device_installation uuid,device_token text,device_environment text
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();result uuid;
begin
 if actor is null then raise exception 'Sign in to enable notifications';end if;
 if device_installation is null or device_token is null
   or length(device_token) not between 32 and 512 or device_token !~ '^[a-f0-9]+$'
   or device_environment is null or device_environment not in ('sandbox','production')
 then raise exception 'Invalid iPhone registration';end if;
 -- Take both locks in the same order for duplicate tokens/installations.
 if device_installation::text < device_token||device_environment then
  perform pg_advisory_xact_lock(hashtextextended(device_installation::text,0));
  perform pg_advisory_xact_lock(hashtextextended(device_token||device_environment,0));
 else
  perform pg_advisory_xact_lock(hashtextextended(device_token||device_environment,0));
  perform pg_advisory_xact_lock(hashtextextended(device_installation::text,0));
 end if;
 if exists(select 1 from public.ios_push_devices
   where (installation_id=device_installation or (token=device_token and environment=device_environment))
   and user_id<>actor) then raise exception 'Sign out of the previous account on this device first';end if;
 select id into result from public.ios_push_devices where token=device_token and environment=device_environment and user_id=actor;
 if result is not null then
  delete from public.ios_push_devices where installation_id=device_installation and user_id=actor and id<>result;
  update public.ios_push_devices set installation_id=device_installation,updated_at=now() where id=result;
  return result;
 end if;
 insert into public.ios_push_devices(installation_id,user_id,token,environment)
 values(device_installation,actor,device_token,device_environment)
 on conflict(installation_id) do update set token=excluded.token,environment=excluded.environment,updated_at=now()
 where public.ios_push_devices.user_id=actor returning id into result;
 if result is null then raise exception 'Device registration was not saved';end if;
 return result;
end $$;

create or replace function public.remove_ios_push_device(device_installation uuid)
 returns void language sql security definer set search_path='' as $$
 delete from public.ios_push_devices where installation_id=device_installation and user_id=auth.uid()
$$;
revoke all on function public.register_ios_push_device(uuid,text,text) from public,anon;
revoke all on function public.remove_ios_push_device(uuid) from public,anon;
grant execute on function public.register_ios_push_device(uuid,text,text),public.remove_ios_push_device(uuid) to authenticated;
commit;
