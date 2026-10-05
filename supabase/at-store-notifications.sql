begin;
-- Privileged writer is private and callable only through the validated public wrapper.
create or replace function private.send_at_store_notice(h uuid,list_id text,recipients uuid[],request_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tab jsonb; recipient uuid; actor_name text; written integer:=0; inserted integer;
begin
 if actor is null or not exists(select 1 from public.household_members where household_id=h and user_id=actor) then raise exception 'Household access is required';end if;
 if request_id is null or coalesce(cardinality(recipients),0)=0 or cardinality(recipients)>100 then raise exception 'Select members to notify';end if;
 select t into tab from private.shopping_workspaces w cross join lateral jsonb_array_elements(w.payload->'tabs') t where w.household_id=h and t->>'id'=list_id;
 if tab is null or not (tab->>'creatorId'=actor::text or coalesce(tab->'memberIds','[]') ? actor::text) then raise exception 'List access is required';end if;
 for recipient in select distinct unnest(recipients) loop
  if recipient=actor or not exists(select 1 from public.household_members where household_id=h and user_id=recipient) or not (tab->>'creatorId'=recipient::text or coalesce(tab->'memberIds','[]') ? recipient::text) then raise exception 'Only members sharing this list can be notified';end if;
 end loop;
 select coalesce(nullif(display_name,''),'A household member') into actor_name from public.profiles where id=actor;
 for recipient in select distinct unnest(recipients) loop
  insert into public.notification_inbox(recipient_id,household_id,section,item_id,event_key,title,detail)
  values(recipient,h,'Shopping',list_id,'at-store:'||actor::text||':'||request_id::text,actor_name||' is at the store', 'Shopping from '||(tab->>'name')||'.') on conflict(recipient_id,event_key) do nothing;
  get diagnostics inserted=row_count;written:=written+inserted;
 end loop;
 return written;
end $$;
revoke all on function private.send_at_store_notice(uuid,text,uuid[],uuid) from public,anon,authenticated;
create or replace function public.notify_at_store(target_household uuid,target_list text,recipient_ids uuid[],request_id uuid)
returns integer language sql security definer set search_path='' as $$ select private.send_at_store_notice(target_household,target_list,recipient_ids,request_id) $$;
revoke all on function public.notify_at_store(uuid,text,uuid[],uuid) from public,anon;
grant execute on function public.notify_at_store(uuid,text,uuid[],uuid) to authenticated;
commit;
