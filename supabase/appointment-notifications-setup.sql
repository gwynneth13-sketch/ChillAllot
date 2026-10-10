-- Apply after appointment-access, notification-inbox and push-delivery setup.
-- Deploy the corresponding appointment workspace function and push worker together.
begin;
create or replace function private.appointment_recipient_access(h uuid,appointment_id text,recipient uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from private.appointments a join public.household_members m
 on m.household_id=a.household_id and m.user_id=recipient
 where a.household_id=h and a.id=appointment_id
 and not coalesce((a.preferences->recipient::text->>'removed')::boolean,false))
$$;

create or replace function private.notify_appointment_members(h uuid,appointment_id text,recipients jsonb,edited boolean default false)
returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();a private.appointments%rowtype;written integer;
begin
 select * into a from private.appointments where household_id=h and id=appointment_id;
 if actor is null or a.creator_id is distinct from actor
 or not private.appointment_recipient_access(h,appointment_id,actor)
 then raise exception 'Only the creator can notify appointment members';end if;
 if jsonb_typeof(recipients) is distinct from 'array' then raise exception 'Choose household members to notify';end if;
 if jsonb_array_length(recipients)>100 then raise exception 'Choose at most 100 members to notify';end if;
 if exists(select 1 from jsonb_array_elements_text(recipients) r(id)
 where not exists(select 1 from public.household_members m where m.household_id=h and m.user_id::text=r.id)
 ) then raise exception 'Only household members can be notified';end if;
 insert into public.notification_inbox(recipient_id,household_id,section,item_id,event_key,title,detail)
 select m.user_id,h,'Appointments',appointment_id,
 case when edited then 'appointment-updated:' else 'appointment-added:' end||h::text||':'||appointment_id||case when edited then ':'||a.revision::text else '' end,
 case when edited then 'Appointment updated: ' else 'New appointment: ' end||(a.record->>'name'),
 case when edited then 'Open the appointment to review the changes. Your reminder is still your own.' else 'Open the appointment to set your own reminder.' end
 from public.household_members m where m.household_id=h and m.user_id<>actor
 and recipients ? m.user_id::text and private.appointment_recipient_access(h,appointment_id,m.user_id)
 on conflict(recipient_id,event_key) do nothing;
 get diagnostics written=row_count;return written;
end $$;

create or replace function private.appointment_notice_current(notice_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.notification_inbox n join private.appointments a
 on a.household_id=n.household_id and a.id=n.item_id
 where n.id=notice_id and n.section='Appointments' and n.read_at is null
 and private.appointment_recipient_access(n.household_id,n.item_id,n.recipient_id)
 and n.event_key in ('appointment-added:'||a.household_id::text||':'||a.id,
 'appointment-updated:'||a.household_id::text||':'||a.id||':'||a.revision::text))
$$;
create or replace function public.push_appointment_notice_current(notice_id uuid)
returns boolean language sql security definer set search_path='' as $$select private.appointment_notice_current(notice_id)$$;
revoke all on function private.appointment_recipient_access(uuid,text,uuid),
 private.notify_appointment_members(uuid,text,jsonb,boolean),private.appointment_notice_current(uuid),
 public.push_appointment_notice_current(uuid) from public,anon,authenticated;
grant execute on function public.push_appointment_notice_current(uuid) to service_role;
commit;
