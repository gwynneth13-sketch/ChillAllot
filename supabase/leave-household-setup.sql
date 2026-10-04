-- Apply after bill, appointment, and invitation approval setup.
begin;
create table if not exists private.household_departures (
 id uuid primary key default gen_random_uuid(),household_id uuid not null,
 user_id uuid not null,successor_id uuid not null,left_at timestamptz not null default now(),summary jsonb not null
);
alter table private.household_departures enable row level security;
revoke all on private.household_departures from public,anon,authenticated;
create or replace function private.leave_household(h uuid,successor uuid,confirm_leave boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); home public.households%rowtype; person text; next_person text;
 personal_home uuid; private_count integer; shared_count integer; appointment_count integer; unpaid_count integer; result jsonb;
begin
 if actor is null then raise exception 'Sign in to continue.';end if;
 select * into home from public.households where id=h for update;
 if not found or not exists(select 1 from public.household_members where household_id=h and user_id=actor) then raise exception 'Household membership is required.';end if;
 if successor is null or successor=actor or not exists(select 1 from public.household_members where household_id=h and user_id=successor) then raise exception 'Choose another household member to take over shared entries.';end if;
 select display_name into person from public.profiles where id=actor;
 select display_name into next_person from public.profiles where id=successor;
 -- Lock financial and appointment records before deciding what will move.
 perform 1 from private.bills where household_id=h for update;
 perform 1 from private.appointments where household_id=h for update;
 select count(*) into private_count from private.bills where household_id=h and creator_id=actor and record->>'visibility'='private';
 select count(*) into shared_count from private.bills where household_id=h and creator_id=actor and record->>'visibility' is distinct from 'private';
 select count(*) into appointment_count from private.appointments where household_id=h and creator_id=actor;
 select count(*) into unpaid_count from private.bills b where household_id=h and record->>'visibility'<>'private'
 and not coalesce((record->>'deleted')::boolean,false) and record->'payerIds' @> jsonb_build_array(actor::text)
 and not exists(select 1 from jsonb_array_elements(b.cycles) c where c->>'due'=b.record->>'due' and c->'paidIds' @> jsonb_build_array(actor::text));
 result:=jsonb_build_object('privateBills',private_count,'sharedBills',shared_count,'appointments',appointment_count,'unpaidShares',unpaid_count,'transfersOwnership',home.created_by=actor,'successorName',next_person);
 if not confirm_leave then return result;end if;
 if private_count>0 then
  insert into public.households(name,created_by) values(left(coalesce(nullif(person,''),'My')||' · Personal',80),actor) returning id into personal_home;
  insert into public.household_members(household_id,user_id,role) values(personal_home,actor,'owner');
  update private.bills set household_id=personal_home,preferences=jsonb_build_object(actor::text,coalesce(preferences->actor::text,'{}')),revision=revision+1
  where household_id=h and creator_id=actor and record->>'visibility'='private';
 end if;
 -- Keep all payments, payer allocations, and amounts exactly as recorded.
 update private.bills b set record=b.record||jsonb_build_object('departureReview',jsonb_build_object('userId',actor::text,'name',person)),revision=revision+1
 where household_id=h and record->>'visibility'<>'private' and not coalesce((record->>'deleted')::boolean,false)
 and record->'payerIds' @> jsonb_build_array(actor::text);
 update private.bills set creator_id=successor,record=record||jsonb_build_object('originalCreatorId',coalesce(record->>'originalCreatorId',actor::text),'viewerIds',case when record->>'visibility'='selected' and not record->'viewerIds' @> jsonb_build_array(successor::text) then coalesce(record->'viewerIds','[]')||jsonb_build_array(successor::text) else coalesce(record->'viewerIds','[]') end),revision=revision+1
 where household_id=h and creator_id=actor;
 -- Preserve personal preferences for history; membership no longer permits access.
 update private.appointments set creator_id=successor,record=record||jsonb_build_object('originalCreatorId',coalesce(record->>'originalCreatorId',actor::text)),revision=revision+1 where household_id=h and creator_id=actor;
 update public.household_data d set payload=coalesce((select jsonb_agg(
  c||jsonb_build_object('owner',case when c->>'owner'=person then next_person else c->>'owner' end,'next',case when c->>'next'=person then next_person else c->>'next' end,
  'creatorId',case when c->>'creatorId'=actor::text then successor::text else c->>'creatorId' end)
  ||case when c ? 'rotationIds' then jsonb_build_object('rotationIds',(c->'rotationIds')-actor::text) else '{}'::jsonb end
  ||case when c ? 'assignedIds' then jsonb_build_object('assignedIds',(c->'assignedIds')-actor::text) else '{}'::jsonb end
 ) from jsonb_array_elements(d.payload) c),'[]'),updated_at=now(),updated_by=actor
 where d.household_id=h and d.data_key='chores' and jsonb_typeof(d.payload)='array';
 if home.created_by=actor then
  update public.households set created_by=successor where id=h;
  update public.household_members set role='owner' where household_id=h and user_id=successor;
 end if;
 delete from private.household_invitations where household_id=h and invited_by=actor;
 update private.household_join_requests set status='cancelled',decided_at=now() where household_id=h and user_id=actor and status='pending';
 insert into private.household_departures(household_id,user_id,successor_id,summary) values(h,actor,successor,result);
 delete from public.household_members where household_id=h and user_id=actor;
 return result||jsonb_build_object('personalHouseholdId',personal_home);
end;$$;
revoke all on function private.leave_household(uuid,uuid,boolean) from public,anon;
grant execute on function private.leave_household(uuid,uuid,boolean) to authenticated;
create or replace function public.leave_household(target_household uuid,successor_id uuid,confirm_leave boolean default false)
returns jsonb language sql security invoker set search_path='' as $$select private.leave_household(target_household,successor_id,confirm_leave)$$;
revoke all on function public.leave_household(uuid,uuid,boolean) from public,anon;
grant execute on function public.leave_household(uuid,uuid,boolean) to authenticated;
alter table private.household_departures add column if not exists dismissed_by uuid[] not null default '{}';
create or replace function private.household_departure_notice(h uuid,operation text,notice_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
 if actor is null or not exists(select 1 from public.households home join public.household_members m on m.household_id=home.id and m.user_id=actor where home.id=h and home.created_by=actor) then raise exception 'Only the household owner can view departure notices.';end if;
 if operation='dismiss' then
  update private.household_departures set dismissed_by=array_append(dismissed_by,actor) where id=notice_id and household_id=h and not actor=any(dismissed_by);
 elsif operation<>'list' then raise exception 'Unknown notice action.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',coalesce(nullif(p.display_name,''),'A household member'),'leftAt',d.left_at,'successorName',d.summary->>'successorName','unpaidShares',d.summary->'unpaidShares','sharedBills',d.summary->'sharedBills','appointments',d.summary->'appointments','transferredOwnership',d.summary->'transfersOwnership') order by d.left_at desc),'[]') into result
 from private.household_departures d left join public.profiles p on p.id=d.user_id where d.household_id=h and not actor=any(d.dismissed_by);
 return result;
end;$$;
revoke all on function private.household_departure_notice(uuid,text,uuid) from public,anon;
grant execute on function private.household_departure_notice(uuid,text,uuid) to authenticated;
create or replace function public.household_departure_notice(target_household uuid,operation text default 'list',notice_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$select private.household_departure_notice(target_household,operation,notice_id)$$;
revoke all on function public.household_departure_notice(uuid,text,uuid) from public,anon;
grant execute on function public.household_departure_notice(uuid,text,uuid) to authenticated;

commit;
