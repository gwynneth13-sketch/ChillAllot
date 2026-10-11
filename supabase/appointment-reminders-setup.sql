-- Apply after appointment-notifications and push-delivery setup.
-- Scheduling is a separate deployment step; this script does not enable Cron.
begin;
create table if not exists private.appointment_reminder_events (
 household_id uuid not null references public.households(id) on delete cascade,
 appointment_id text not null,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 occurrence timestamp without time zone not null,
 remind_at timestamptz not null,
 notification_id uuid unique references public.notification_inbox(id) on delete set null,
 consumed_at timestamptz,
 primary key(household_id,appointment_id,recipient_id,occurrence)
);
alter table private.appointment_reminder_events enable row level security;
revoke all on private.appointment_reminder_events from public,anon,authenticated,service_role;
create index if not exists appointment_reminder_events_recipient_idx on private.appointment_reminder_events(recipient_id);

create or replace function private.appointment_reminder_plan(h uuid,appointment_id text,recipient uuid)
returns table(occurrence timestamp without time zone,remind_at timestamptz,expires_at timestamptz,appointment_name text)
language plpgsql stable security invoker set search_path='' as $$
declare a private.appointments%rowtype;pref jsonb;zone text;m text[];n integer;unit text;clock time;local_day date;starts_at timestamptz;
begin
 if not private.appointment_recipient_access(h,appointment_id,recipient) then return;end if;
 select * into a from private.appointments where household_id=h and id=appointment_id;
 -- Only this member's explicit choice; no creator or shared reminder fallback.
 pref:=a.preferences->recipient::text;
 m:=regexp_match(pref->>'reminder','^(?:Every )?([0-9]+) (days?|weeks?|months?|hours?|minutes?) before$');
 if m is null or length(m[1])>5 then return;end if;
 n:=m[1]::integer;if n>10000 then return;end if;unit:=rtrim(m[2],'s');
 select p.timezone into zone from public.push_preferences p where p.user_id=recipient and p.household_id=h;
 if zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then return;end if;
 if coalesce(a.record->>'date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 or coalesce(a.record->>'time','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then return;end if;
 occurrence:=(a.record->>'date')::date+(a.record->>'time')::time;
 -- Stored appointment date/time, like calendar reminder clocks, uses the member's saved timezone.
 starts_at:=occurrence at time zone zone;
 if unit in ('hour','minute') then
  remind_at:=starts_at-make_interval(mins=>case when unit='hour' then n*60 else n end);
 else
  if coalesce(pref->>'reminderTime','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then return;end if;
  clock:=(pref->>'reminderTime')::time;
  local_day:=(occurrence::date-make_interval(days=>case when unit='day' then n when unit='week' then n*7 else 0 end,months=>case when unit='month' then n else 0 end))::date;
  remind_at:=(local_day+clock) at time zone zone;
 end if;
 -- Earlier reminders expire at the start or after 24 hours. An exact-start choice
 -- gets five minutes for the minute scheduler/worker to deliver, then expires too.
 expires_at:=least(remind_at+interval '24 hours',starts_at+case when remind_at=starts_at then interval '5 minutes' else interval '0 minutes' end);
 if remind_at>=expires_at then return;end if;
 appointment_name:=a.record->>'name';return next;
exception when invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
 -- One malformed legacy card must not stop reminders for other members/households.
 return;
end $$;

create or replace function private.enqueue_appointment_reminders(as_of timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare event private.appointment_reminder_events%rowtype;plan record;a record;recipient uuid;notice uuid;consumed boolean;written integer:=0;
begin
 if not pg_try_advisory_xact_lock(164800,2) then return 0;end if;
 -- Workspace edits/settings/removal lock these rows too.
 perform 1 from private.appointments order by household_id,id for update;
 for event in select * from private.appointment_reminder_events where notification_id is not null for update loop
  select * into plan from private.appointment_reminder_plan(event.household_id,event.appointment_id,event.recipient_id);
  if not found or plan.occurrence<>event.occurrence or plan.remind_at<>event.remind_at or as_of>=plan.expires_at then
   select exists(select 1 from public.notification_inbox where id=event.notification_id and read_at is not null)
    or exists(select 1 from public.push_delivery_receipts where notification_id=event.notification_id) into consumed;
   if consumed then
    update private.appointment_reminder_events set consumed_at=coalesce(consumed_at,as_of)
    where household_id=event.household_id and appointment_id=event.appointment_id and recipient_id=event.recipient_id and occurrence=event.occurrence;
    update public.push_delivery_jobs set finished_at=coalesce(finished_at,as_of),claimed_at=null,last_error='Appointment reminder no longer applies' where notification_id=event.notification_id;
   else
    delete from public.notification_inbox where id=event.notification_id;
   end if;
  end if;
 end loop;
 -- Iterate all memberships, independent of which household the app currently displays.
 for a in select household_id,id from private.appointments loop
  for recipient in select user_id from public.household_members where household_id=a.household_id loop
   select * into plan from private.appointment_reminder_plan(a.household_id,a.id,recipient);
   if not found or as_of<plan.remind_at or as_of>=plan.expires_at then continue;end if;
   insert into private.appointment_reminder_events(household_id,appointment_id,recipient_id,occurrence,remind_at)
   values(a.household_id,a.id,recipient,plan.occurrence,plan.remind_at) on conflict do nothing;
   select * into event from private.appointment_reminder_events where household_id=a.household_id and appointment_id=a.id and recipient_id=recipient and occurrence=plan.occurrence for update;
   if event.notification_id is not null or event.consumed_at is not null then continue;end if;
   insert into public.notification_inbox(recipient_id,household_id,section,item_id,event_key,title,detail,created_at)
   values(recipient,a.household_id,'Appointments',a.id,
    'appointment-reminder:'||a.household_id::text||':'||a.id||':'||to_char(plan.occurrence,'YYYY-MM-DD"T"HH24:MI:SS'),
    'Appointment reminder: '||plan.appointment_name,'Appointment on '||to_char(plan.occurrence,'YYYY-MM-DD')||' at '||to_char(plan.occurrence,'HH24:MI')||'.',as_of)
   returning id into notice;
   update private.appointment_reminder_events set notification_id=notice,remind_at=plan.remind_at
   where household_id=a.household_id and appointment_id=a.id and recipient_id=recipient and occurrence=plan.occurrence;
   written:=written+1;
  end loop;
 end loop;
 return written;
end $$;

-- Retain added/edit notice behavior while also validating scheduled reminders.
create or replace function private.appointment_notice_current(notice_id uuid)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare n public.notification_inbox%rowtype;a private.appointments%rowtype;event private.appointment_reminder_events%rowtype;plan record;
begin
 select * into n from public.notification_inbox where id=notice_id and section='Appointments' and read_at is null;
 if not found or not private.appointment_recipient_access(n.household_id,n.item_id,n.recipient_id) then return false;end if;
 select * into event from private.appointment_reminder_events where notification_id=notice_id;
 if found then
  select * into plan from private.appointment_reminder_plan(event.household_id,event.appointment_id,event.recipient_id);
  return found and event.consumed_at is null and plan.occurrence=event.occurrence and plan.remind_at=event.remind_at
   and now()>=plan.remind_at and now()<plan.expires_at;
 end if;
 select * into a from private.appointments where household_id=n.household_id and id=n.item_id;
 return found and n.event_key in ('appointment-added:'||a.household_id::text||':'||a.id,
  'appointment-updated:'||a.household_id::text||':'||a.id||':'||a.revision::text);
end $$;
revoke all on function private.appointment_reminder_plan(uuid,text,uuid),private.enqueue_appointment_reminders(timestamptz),
 private.appointment_notice_current(uuid) from public,anon,authenticated,service_role;
-- Existing service-only public wrapper remains the only worker entry point.
commit;
