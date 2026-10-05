begin;
create schema if not exists private;
create table if not exists public.push_devices (
 endpoint text primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 subscription jsonb not null,
 app_origin text not null,
 created_at timestamptz not null default now()
);
alter table public.push_devices enable row level security;
revoke all on public.push_devices from public,anon,authenticated;
grant select on public.push_devices to authenticated;
grant all on public.push_devices to service_role;
drop policy if exists push_devices_read_own on public.push_devices;
create policy push_devices_read_own on public.push_devices for select to authenticated using ((select auth.uid())=user_id);
create table if not exists public.push_preferences (
 user_id uuid not null references auth.users(id) on delete cascade,
 household_id uuid not null references public.households(id) on delete cascade,
 groups jsonb not null default '{}',
 quiet_hours jsonb not null default '{"enabled":false,"start":"22:00","end":"08:00"}',
 timezone text not null default 'UTC',
 primary key(user_id,household_id)
);
alter table public.push_preferences enable row level security;
revoke all on public.push_preferences from public,anon,authenticated;
grant select,insert,update on public.push_preferences to authenticated;
grant all on public.push_preferences to service_role;
drop policy if exists push_preferences_own on public.push_preferences;
create policy push_preferences_own on public.push_preferences for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id and public.is_household_member(household_id));
create table if not exists public.push_delivery_jobs (
 notification_id uuid primary key references public.notification_inbox(id) on delete cascade,
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 claimed_at timestamptz,
 finished_at timestamptz,
 last_error text
);
alter table public.push_delivery_jobs enable row level security;
revoke all on public.push_delivery_jobs from public,anon,authenticated;
grant all on public.push_delivery_jobs to service_role;
create table if not exists public.push_delivery_receipts (
 notification_id uuid not null references public.notification_inbox(id) on delete cascade,
 endpoint text not null,
 delivered_at timestamptz not null default now(),
 primary key(notification_id,endpoint)
);
alter table public.push_delivery_receipts enable row level security;
revoke all on public.push_delivery_receipts from public,anon,authenticated;
grant all on public.push_delivery_receipts to service_role;
create or replace function private.queue_push_notice() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.push_delivery_jobs(notification_id) values(new.id) on conflict do nothing;return new;
end $$;
revoke all on function private.queue_push_notice() from public,anon,authenticated;
drop trigger if exists queue_push_notice on public.notification_inbox;
create trigger queue_push_notice after insert on public.notification_inbox for each row execute function private.queue_push_notice();
create or replace function public.claim_push_jobs() returns setof public.push_delivery_jobs language sql security invoker set search_path='' as $$
 update public.push_delivery_jobs set claimed_at=now(),attempts=attempts+1 where notification_id in (
 select notification_id from public.push_delivery_jobs where finished_at is null and attempts<8 and available_at<=now() and (claimed_at is null or claimed_at<now()-interval '5 minutes') order by available_at limit 20 for update skip locked
 ) returning *
$$;
revoke all on function public.claim_push_jobs() from public,anon,authenticated;
grant execute on function public.claim_push_jobs() to service_role;
create or replace function public.push_list_access(h uuid,list_id text,recipient uuid) returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from private.shopping_workspaces w cross join lateral jsonb_array_elements(w.payload->'tabs') t where w.household_id=h and t->>'id'=list_id and (t->>'creatorId'=recipient::text or coalesce(t->'memberIds','[]') ? recipient::text))
$$;
revoke all on function public.push_list_access(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.push_list_access(uuid,text,uuid) to service_role;
create or replace function public.register_push_device(subscription jsonb,app_origin text) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();device_endpoint text:=subscription->>'endpoint';existing uuid;
begin
 if actor is null then raise exception 'Sign in to enable notifications';end if;
 if app_origin !~ '^https://[a-z0-9-]+\.vercel\.app$' or device_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com)/' or length(device_endpoint)>2048 or length(subscription::text)>8192 or nullif(subscription->'keys'->>'p256dh','') is null or nullif(subscription->'keys'->>'auth','') is null then raise exception 'Invalid notification subscription';end if;
 select user_id into existing from public.push_devices where endpoint=device_endpoint;
 if existing is not null and existing<>actor then raise exception 'Sign out of the previous account on this device first';end if;
 insert into public.push_devices(endpoint,user_id,subscription,app_origin) values(device_endpoint,actor,subscription,app_origin) on conflict(endpoint) do update set subscription=excluded.subscription,app_origin=excluded.app_origin where public.push_devices.user_id=actor;
end $$;
create or replace function public.remove_push_device(device_endpoint text) returns void language sql security definer set search_path='' as $$ delete from public.push_devices where endpoint=device_endpoint and user_id=auth.uid() $$;
revoke all on function public.register_push_device(jsonb,text) from public,anon;
revoke all on function public.remove_push_device(text) from public,anon;
grant execute on function public.register_push_device(jsonb,text),public.remove_push_device(text) to authenticated;
commit;
