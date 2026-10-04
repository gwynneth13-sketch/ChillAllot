-- Appointment personal reminders and personal list removal. Run with the corresponding app release.
-- Original household documents are retained as a protected backup.
begin;
create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;
create table if not exists private.appointments (
 household_id uuid not null references public.households(id) on delete cascade,
 id text not null,record jsonb not null,preferences jsonb not null default '{}',revision bigint not null default 1,
 primary key(household_id,id)
);
alter table private.appointments add column if not exists creator_id uuid references public.profiles(id);
alter table private.appointments enable row level security;
revoke all on private.appointments from public,anon,authenticated;
insert into private.appointments(household_id,id,record,preferences)
select d.household_id,coalesce(nullif(a.item->>'id',''),'legacy-'||a.ordinality),
 a.item-'reminder'-'reminderTime'-'memberReminders'-'notified',
 coalesce((select jsonb_object_agg(m.user_id::text,jsonb_build_object('reminder',coalesce((select r->>'reminder' from jsonb_array_elements(coalesce(a.item->'memberReminders','[]')) r where r->>'member'=p.display_name limit 1),a.item->>'reminder',''),'reminderTime',coalesce((select r->>'time' from jsonb_array_elements(coalesce(a.item->'memberReminders','[]')) r where r->>'member'=p.display_name limit 1),a.item->>'reminderTime',''),'removed',false)) from public.household_members m join public.profiles p on p.id=m.user_id where m.household_id=d.household_id),'{}')
from public.household_data d cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]' end) with ordinality a(item,ordinality)
where d.data_key='appointments' on conflict do nothing;
drop policy if exists appointments_use_private_storage on public.household_data;
create policy appointments_use_private_storage on public.household_data as restrictive for all to authenticated using(data_key<>'appointments') with check(data_key<>'appointments');
create or replace function private.appointment_workspace(target_household uuid,operation text default 'list',target_appointment text default '',input_values jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();h uuid:=target_household;op text:=operation;aid text:=target_appointment;v jsonb:=coalesce(input_values,'{}');a private.appointments%rowtype;item jsonb;pref jsonb;prefs jsonb;r jsonb;recipient uuid;result jsonb;
begin
 if actor is null or not exists(select 1 from public.household_members where household_id=h and user_id=actor) then raise exception 'Household access is required';end if;
 if op in ('create','edit','settings') then
 if op<>'settings' then
  if nullif(btrim(v->>'name'),'') is null or coalesce(v->>'date','')!~'^\d{4}-\d{2}-\d{2}$' or coalesce(v->>'time','')!~'^\d{2}:\d{2}$' then raise exception 'Enter an appointment name, date, and time';end if;
  perform (v->>'date')::date;perform (v->>'time')::time;
 end if;
  if coalesce(v->>'reminder','')<>'' and coalesce(v->>'reminder','')!~'^(Every )?[0-9]+ (minute|hour|day|week|month)s? before$' then raise exception 'Choose a valid reminder interval';end if;
  if coalesce(v->>'reminder','')<>'' and v->>'reminder'!~'(minute|hour)s? before$' then perform nullif(v->>'reminderTime','')::time;if nullif(v->>'reminderTime','') is null then raise exception 'Choose a reminder time';end if;end if;
  item:=jsonb_build_object('name',btrim(v->>'name'),'date',v->>'date','time',v->>'time','for',coalesce(v->>'for',''),'place',coalesce(v->>'place',''),'note',coalesce(v->>'note',''),'video',coalesce((v->>'video')::boolean,false),'changeNotified',coalesce(v->'changeNotified','[]'));
  pref:=jsonb_build_object('reminder',coalesce(v->>'reminder',''),'reminderTime',case when v->>'reminder'~'(minute|hour)s? before$' then '' else coalesce(v->>'reminderTime','') end,'removed',false);
 end if;
 if op='create' then
  if nullif(aid,'') is null then raise exception 'Appointment ID is required';end if;
  prefs:=jsonb_build_object(actor::text,pref);
  for r in select x from jsonb_array_elements(coalesce(v->'memberReminders','[]')) x loop
   -- Initial invitations can suggest reminders. Later edits never write another member's preference.
   select case when count(*)=1 then (array_agg(m.user_id))[1] end into recipient from public.household_members m join public.profiles p on p.id=m.user_id where m.household_id=h and (case when nullif(r->>'userId','') is not null then m.user_id::text=r->>'userId' else p.display_name=r->>'member' end);
   if recipient is not null and recipient<>actor then
    if coalesce(r->>'reminder','')!~'^(Every )?[0-9]+ (minute|hour|day|week|month)s? before$' then raise exception 'Choose a valid member reminder';end if;
    if r->>'reminder'!~'(minute|hour)s? before$' then perform nullif(r->>'time','')::time;if nullif(r->>'time','') is null then raise exception 'Choose a member reminder time';end if;end if;
    prefs:=prefs||jsonb_build_object(recipient::text,jsonb_build_object('reminder',r->>'reminder','reminderTime',case when r->>'reminder'~'(minute|hour)s? before$' then '' else coalesce(r->>'time','') end,'removed',false));
   end if;
  end loop;
  insert into private.appointments(household_id,id,creator_id,record,preferences) values(h,aid,actor,item,prefs);
 elsif op<>'list' then
  select * into a from private.appointments where household_id=h and id=aid for update;
  if not found or coalesce((a.preferences->actor::text->>'removed')::boolean,false) then raise exception 'Appointment not found';end if;
  if op='assign' then
   if a.creator_id is not null or not exists(select 1 from public.household_members where household_id=h and user_id=actor and role='owner') then raise exception 'Only a household owner can assign an unassigned appointment';end if;
   if not exists(select 1 from public.household_members where household_id=h and user_id=(v->>'creatorId')::uuid) then raise exception 'Choose a household member';end if;
   update private.appointments set creator_id=(v->>'creatorId')::uuid,revision=revision+1 where household_id=h and id=aid;
  elsif op='settings' then
   update private.appointments set preferences=jsonb_set(preferences,array[actor::text],pref) where household_id=h and id=aid;
  elsif op='edit' then
   if a.creator_id is distinct from actor then raise exception 'Only the creator can edit appointment details';end if;
   if (v->>'expectedRevision')::bigint is distinct from a.revision then raise exception 'This appointment changed in another window. Reopen it before saving';end if;
   update private.appointments set record=item,preferences=jsonb_set(preferences,array[actor::text],pref),revision=revision+1 where household_id=h and id=aid;
  elsif op='remove' then
   pref:=jsonb_build_object('removed',true,'reminder','','reminderTime','');
   update private.appointments set preferences=jsonb_set(preferences,array[actor::text],pref) where household_id=h and id=aid;
  else raise exception 'Unknown appointment action';end if;
 end if;
 select coalesce(jsonb_agg(x.record||jsonb_build_object('id',x.id,'creatorId',x.creator_id,'revision',x.revision,'reminder',coalesce(x.preferences->actor::text->>'reminder',''),'reminderTime',coalesce(x.preferences->actor::text->>'reminderTime',''),'notified','[]'::jsonb,'memberReminders','[]'::jsonb) order by x.record->>'date',x.record->>'time',x.id),'[]') into result from private.appointments x where x.household_id=h and not coalesce((x.preferences->actor::text->>'removed')::boolean,false);
 return result;
end $$;
create or replace function public.appointment_workspace(target_household uuid,operation text default 'list',target_appointment text default '',input_values jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select private.appointment_workspace(target_household,operation,target_appointment,input_values)$$;
revoke all on function private.appointment_workspace(uuid,text,text,jsonb),public.appointment_workspace(uuid,text,text,jsonb) from public,anon;
grant execute on function private.appointment_workspace(uuid,text,text,jsonb),public.appointment_workspace(uuid,text,text,jsonb) to authenticated;
commit;
select count(*) as preserved_appointments from private.appointments;
