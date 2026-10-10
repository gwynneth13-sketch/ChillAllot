-- Apply after bill-access, notification-inbox and push-delivery setup.
-- Installs the producer; scheduling is a separate, reviewed deployment step.
begin;
alter table public.notification_inbox add column if not exists item_due date;

create table if not exists private.bill_reminder_events (
 household_id uuid not null references public.households(id) on delete cascade,
 bill_id text not null,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 occurrence date not null,
 remind_at timestamptz not null,
 notification_id uuid unique references public.notification_inbox(id) on delete set null,
 consumed_at timestamptz,
 primary key(household_id,bill_id,recipient_id,occurrence)
);
alter table private.bill_reminder_events enable row level security;
revoke all on private.bill_reminder_events from public,anon,authenticated,service_role;
create index if not exists bill_reminder_events_recipient_idx on private.bill_reminder_events(recipient_id);

-- A member may receive bill events only while both membership and payer access hold.
create or replace function private.bill_recipient_access(h uuid,bill_id text,recipient uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from private.bills b join public.household_members m
 on m.household_id=b.household_id and m.user_id=recipient
 where b.household_id=h and b.id=bill_id and b.creator_id is not null
 and not coalesce((b.record->>'deleted')::boolean,false)
 and b.record->'payerIds' ? recipient::text
 and (b.creator_id=recipient or b.record->>'visibility'='household'
 or (b.record->>'visibility'='selected' and b.record->'viewerIds' ? recipient::text)))
$$;

create or replace function private.bill_reminder_plan(h uuid,bill_id text,recipient uuid)
returns table(occurrence date,remind_at timestamptz,expires_at timestamptz,bill_name text)
language plpgsql stable security invoker set search_path='' as $$
declare b private.bills%rowtype; pref jsonb; zone text; m text[]; n integer;
 unit text; clock time; paid boolean; local_day date;
begin
 if not private.bill_recipient_access(h,bill_id,recipient) then return;end if;
 select * into b from private.bills where household_id=h and id=bill_id;
 -- Never inherit the creator's reminder or notify before a personal opt-in.
 pref:=b.preferences->recipient::text;
 m:=regexp_match(pref->>'reminder','^Every ([0-9]+) (days?|weeks?|months?|hours?|minutes?) before$');
 if m is null or length(m[1])>5 then return;end if;
 n:=m[1]::integer;if n>10000 then return;end if;unit:=rtrim(m[2],'s');
 select p.timezone into zone from public.push_preferences p where p.user_id=recipient and p.household_id=h;
 if zone is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then return;end if;
 occurrence:=(b.record->>'due')::date;
 select coalesce(bool_or(c->'paidIds' ? recipient::text),false) into paid
 from jsonb_array_elements(b.cycles) c where c->>'due'=occurrence::text;
 if paid then
  if b.record->>'cadence'='One-time' then return;end if;
  -- Match the next occurrence shown to a payer who has already paid their share.
  occurrence:=private.next_bill_date(occurrence,b.record->>'cadence');
 end if;
 if unit in ('hour','minute') then
  -- Legacy date-only bill intervals use local midnight as the due-time anchor.
  remind_at:=(occurrence::timestamp at time zone zone)-make_interval(mins=>case when unit='hour' then n*60 else n end);
 else
  if coalesce(pref->>'reminderTime','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then return;end if;
  clock:=(pref->>'reminderTime')::time;
  local_day:=(occurrence-make_interval(days=>case when unit='day' then n when unit='week' then n*7 else 0 end,months=>case when unit='month' then n else 0 end))::date;
  remind_at:=(local_day+clock) at time zone zone;
 end if;
 -- A delayed push may survive quiet hours, but never beyond the due day or 24 hours.
 expires_at:=least(remind_at+interval '24 hours',((occurrence+1)::timestamp at time zone zone));
 bill_name:=b.record->>'name';return next;
exception when invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
 -- A malformed legacy record must not stop reminders for other households.
 return;
end $$;

create or replace function private.notify_bill_added(h uuid,bill_id text)
returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); b private.bills%rowtype; written integer;
begin
 select * into b from private.bills where household_id=h and id=bill_id;
 if actor is null or b.creator_id is distinct from actor
 or not exists(select 1 from public.household_members where household_id=h and user_id=actor)
 then raise exception 'Only the creator can notify bill payers';end if;
 insert into public.notification_inbox(recipient_id,household_id,section,item_id,item_due,event_key,title,detail)
 select m.user_id,h,'Bills',bill_id,null,
 'bill-added:'||h::text||':'||bill_id,'New bill: '||(b.record->>'name'),'Open the bill to set your own reminder.'
 from public.household_members m where m.household_id=h and m.user_id<>actor
 and private.bill_recipient_access(h,bill_id,m.user_id)
 on conflict(recipient_id,event_key) do nothing;
 get diagnostics written=row_count;return written;
end $$;

create or replace function private.enqueue_bill_reminders(as_of timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare event private.bill_reminder_events%rowtype; plan record; b record; recipient uuid;
 notice uuid; consumed boolean; written integer:=0;
begin
 if not pg_try_advisory_xact_lock(164800,1) then return 0;end if;
 -- Bill edits/payments use the same row locks; enqueue cannot race their commits.
 perform 1 from private.bills order by household_id,id for update;
 for event in select * from private.bill_reminder_events where notification_id is not null for update loop
  select * into plan from private.bill_reminder_plan(event.household_id,event.bill_id,event.recipient_id);
  if not found or plan.occurrence<>event.occurrence or plan.remind_at<>event.remind_at or as_of>=plan.expires_at then
   select exists(select 1 from public.notification_inbox where id=event.notification_id and read_at is not null)
    or exists(select 1 from public.push_delivery_receipts where notification_id=event.notification_id) into consumed;
   if consumed then
    update private.bill_reminder_events set consumed_at=coalesce(consumed_at,as_of)
    where household_id=event.household_id and bill_id=event.bill_id and recipient_id=event.recipient_id and occurrence=event.occurrence;
    update public.push_delivery_jobs set finished_at=coalesce(finished_at,as_of),claimed_at=null,last_error='Bill reminder no longer applies' where notification_id=event.notification_id;
   else
    -- Remove an unread, undelivered stale event; its ledger permits safe rescheduling.
    delete from public.notification_inbox where id=event.notification_id;
   end if;
  end if;
 end loop;
 for b in select household_id,id,record from private.bills where creator_id is not null loop
  for recipient in select user_id from public.household_members where household_id=b.household_id loop
   select * into plan from private.bill_reminder_plan(b.household_id,b.id,recipient);
   if not found or as_of<plan.remind_at or as_of>=plan.expires_at then continue;end if;
   insert into private.bill_reminder_events(household_id,bill_id,recipient_id,occurrence,remind_at)
   values(b.household_id,b.id,recipient,plan.occurrence,plan.remind_at) on conflict do nothing;
   select * into event from private.bill_reminder_events where household_id=b.household_id and bill_id=b.id and recipient_id=recipient and occurrence=plan.occurrence for update;
   if event.notification_id is not null or event.consumed_at is not null then continue;end if;
   insert into public.notification_inbox(recipient_id,household_id,section,item_id,item_due,event_key,title,detail,created_at)
   values(recipient,b.household_id,'Bills',b.id,plan.occurrence,
    'bill-reminder:'||b.household_id::text||':'||b.id||':'||plan.occurrence::text,
    'Bill reminder: '||plan.bill_name,'Due '||plan.occurrence::text||'.',as_of)
   returning id into notice;
   update private.bill_reminder_events set notification_id=notice,remind_at=plan.remind_at
   where household_id=b.household_id and bill_id=b.id and recipient_id=recipient and occurrence=plan.occurrence;
   written:=written+1;
  end loop;
 end loop;
 return written;
end $$;

create or replace function private.bill_notice_current(notice_id uuid)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare n public.notification_inbox%rowtype; event private.bill_reminder_events%rowtype; plan record;
begin
 select * into n from public.notification_inbox where id=notice_id and section='Bills';
 if not found or not private.bill_recipient_access(n.household_id,n.item_id,n.recipient_id) then return false;end if;
 select * into event from private.bill_reminder_events where notification_id=notice_id;
 if not found then return n.event_key='bill-added:'||n.household_id::text||':'||n.item_id;end if;
 select * into plan from private.bill_reminder_plan(event.household_id,event.bill_id,event.recipient_id);
 return found and event.consumed_at is null and plan.occurrence=event.occurrence
 and plan.remind_at=event.remind_at and now()>=plan.remind_at and now()<plan.expires_at;
end $$;

create or replace function private.push_bill_notice_current(notice_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select private.bill_notice_current(notice_id)
$$;
create or replace function public.push_bill_notice_current(notice_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select private.push_bill_notice_current(notice_id)
$$;
revoke all on function private.bill_recipient_access(uuid,text,uuid),private.bill_reminder_plan(uuid,text,uuid),
 private.notify_bill_added(uuid,text),private.enqueue_bill_reminders(timestamptz),private.bill_notice_current(uuid),
 private.push_bill_notice_current(uuid),public.push_bill_notice_current(uuid) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.push_bill_notice_current(uuid),public.push_bill_notice_current(uuid) to service_role;
commit;
