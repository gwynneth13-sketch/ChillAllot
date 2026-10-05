begin;
create table if not exists public.notification_inbox (
 id uuid primary key default gen_random_uuid(),
 recipient_id uuid not null references auth.users(id) on delete cascade,
 household_id uuid not null,
 section text not null check (section in ('Bills','Shopping','Appointments','Chores','Settings')),
 item_id text,
 event_key text not null,
 title text not null,
 detail text not null default '',
 created_at timestamptz not null default now(),
 read_at timestamptz,
 unique (recipient_id,event_key)
);
create index if not exists notification_inbox_recipient_created_idx on public.notification_inbox(recipient_id,created_at desc);
alter table public.notification_inbox enable row level security;
revoke all on public.notification_inbox from public,anon,authenticated;
grant select on public.notification_inbox to authenticated;
grant update(read_at) on public.notification_inbox to authenticated;
grant all on public.notification_inbox to service_role;
drop policy if exists notification_inbox_read_own on public.notification_inbox;
create policy notification_inbox_read_own on public.notification_inbox for select to authenticated using ((select auth.uid())=recipient_id);
drop policy if exists notification_inbox_mark_own on public.notification_inbox;
create policy notification_inbox_mark_own on public.notification_inbox for update to authenticated using ((select auth.uid())=recipient_id) with check ((select auth.uid())=recipient_id);
commit;
