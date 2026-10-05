begin;
create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;
create table if not exists private.shopping_workspaces(household_id uuid primary key references public.households(id) on delete cascade,payload jsonb not null,revision bigint not null default 1);
alter table private.shopping_workspaces enable row level security;
revoke all on private.shopping_workspaces from public,anon,authenticated;
-- Preserve old documents; old lists without a creator are managed by the household owner.
insert into private.shopping_workspaces(household_id,payload)
select h.id,jsonb_build_object('tabs',coalesce((select payload->'tabs' from public.household_data where household_id=h.id and data_key='shopping_lists'),case when exists(select 1 from public.household_data d where d.household_id=h.id and d.data_key in ('shopping','quick_adds','shopping_suggestions') and d.payload not in ('[]'::jsonb,'{}'::jsonb,'{"items":{},"pairs":{}}'::jsonb)) then '[{"id":"main","name":"My list"}]'::jsonb else '[]'::jsonb end),'data',coalesce((select payload->'data' from public.household_data where household_id=h.id and data_key='shopping_lists'),'{}'::jsonb)||jsonb_build_object('main',jsonb_build_object('items',coalesce((select payload from public.household_data where household_id=h.id and data_key='shopping'),'[]'::jsonb),'quickAdds',coalesce((select payload from public.household_data where household_id=h.id and data_key='quick_adds'),'[]'::jsonb),'suggestions',coalesce((select payload from public.household_data where household_id=h.id and data_key='shopping_suggestions'),'{"items":{},"pairs":{}}'::jsonb)))) from public.households h on conflict do nothing;
update private.shopping_workspaces w set payload=jsonb_set(payload,'{tabs}',coalesce((select jsonb_agg(t||jsonb_build_object('creatorId',coalesce((select m.user_id::text from public.household_members m where m.household_id=w.household_id and m.user_id::text=t->>'creatorId'),(select m.user_id::text from public.household_members m where m.household_id=w.household_id and m.role='owner' order by m.user_id limit 1)),'memberIds',coalesce(t->'memberIds',(select jsonb_agg(m.user_id::text) from public.household_members m where m.household_id=w.household_id)))) from jsonb_array_elements(payload->'tabs') t),'[]'::jsonb));
drop policy if exists shopping_use_private_storage on public.household_data;
create policy shopping_use_private_storage on public.household_data as restrictive for all to authenticated using(data_key not in ('shopping','quick_adds','shopping_suggestions','shopping_lists')) with check(data_key not in ('shopping','quick_adds','shopping_suggestions','shopping_lists'));
create or replace function public.shopping_workspace(target_household uuid,operation text default 'list',input_values jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();w private.shopping_workspaces%rowtype;v jsonb:=input_values;t jsonb;old jsonb;tabs jsonb;data jsonb;result_tabs jsonb:='[]';result_data jsonb:='{}';ids text[]:=array[]::text[];id text;can_see boolean;
begin
 if actor is null or not exists(select 1 from public.household_members where household_id=target_household and user_id=actor) then raise exception 'Household access is required';end if;
 select * into w from private.shopping_workspaces where household_id=target_household for update;
 if not found then insert into private.shopping_workspaces values(target_household,'{"tabs":[],"data":{}}',1) returning * into w;end if;
 if operation='save' then
  if (v->>'revision')::bigint is distinct from w.revision then raise exception 'Shopping lists changed. Reload and try again';end if;
  if jsonb_typeof(v->'tabs') is distinct from 'array' or jsonb_typeof(v->'data') is distinct from 'object' then raise exception 'Invalid shopping lists';end if;
  tabs:=w.payload->'tabs';data:=w.payload->'data';
  for t in select value from jsonb_array_elements(v->'tabs') loop
   id:=t->>'id';if nullif(id,'') is null or id=any(ids) or nullif(btrim(t->>'name'),'') is null or length(t->>'name')>60 then raise exception 'Invalid list name or id';end if;ids:=array_append(ids,id);
   select value into old from jsonb_array_elements(w.payload->'tabs') where value->>'id'=id;
   if old is null then
    if t->>'creatorId' is distinct from actor::text then raise exception 'The creator must be the current user';end if;
   else
    can_see:=old->>'creatorId'=actor::text or coalesce(old->'memberIds','[]') ? actor::text;
    if not can_see then raise exception 'List access is required';end if;
    if old->>'creatorId' is distinct from t->>'creatorId' then raise exception 'List creator cannot be changed';end if;
    if old->>'creatorId'<>actor::text and (old->>'name' is distinct from t->>'name' or old->'memberIds' is distinct from t->'memberIds') then raise exception 'Only the creator can manage this list';end if;
   end if;
   if jsonb_typeof(t->'memberIds') is distinct from 'array' or not (t->'memberIds' ? (t->>'creatorId')) or exists(select 1 from jsonb_array_elements_text(t->'memberIds') r where not exists(select 1 from public.household_members m where m.household_id=target_household and m.user_id::text=r)) then raise exception 'Select current household members';end if;
   if jsonb_typeof(v->'data'->id) is distinct from 'object' then raise exception 'Invalid list contents';end if;
   tabs:=coalesce((select jsonb_agg(x) from jsonb_array_elements(tabs) x where x->>'id'<>id),'[]')||jsonb_build_array(t);
   data:=jsonb_set(data,array[id],v->'data'->id,true);
  end loop;
  for old in select value from jsonb_array_elements(w.payload->'tabs') loop
   id:=old->>'id';can_see:=old->>'creatorId'=actor::text or coalesce(old->'memberIds','[]') ? actor::text;
   if can_see and not(id=any(ids)) then
    if old->>'creatorId'<>actor::text then raise exception 'Only the creator can delete this list';end if;
    tabs:=coalesce((select jsonb_agg(x) from jsonb_array_elements(tabs) x where x->>'id'<>id),'[]');data:=data-id;
   end if;
  end loop;
  update private.shopping_workspaces set payload=jsonb_build_object('tabs',tabs,'data',data),revision=revision+1 where household_id=target_household returning * into w;
 elsif operation<>'list' then raise exception 'Unknown shopping action';end if;
 for t in select value from jsonb_array_elements(w.payload->'tabs') loop
  if t->>'creatorId'=actor::text or coalesce(t->'memberIds','[]') ? actor::text then result_tabs:=result_tabs||jsonb_build_array(t);result_data:=jsonb_set(result_data,array[t->>'id'],coalesce(w.payload->'data'->(t->>'id'),'{}'),true);end if;
 end loop;
 return jsonb_build_object('tabs',result_tabs,'data',result_data,'revision',w.revision);
end $$;
revoke all on function public.shopping_workspace(uuid,text,jsonb) from public,anon;
grant execute on function public.shopping_workspace(uuid,text,jsonb) to authenticated;
-- Called only by the trusted leave-household transaction.
create or replace function private.shopping_departure(h uuid,actor uuid,successor uuid,personal_home uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare w private.shopping_workspaces%rowtype;t jsonb;private_tabs jsonb:='[]';kept_tabs jsonb:='[]';private_data jsonb:='{}';kept_data jsonb:='{}';recipients jsonb;home_name text;
begin
 select * into w from private.shopping_workspaces where household_id=h for update;
 if not found then return personal_home;end if;
 for t in select value from jsonb_array_elements(w.payload->'tabs') loop
  if t->>'creatorId'=actor::text and not exists(select 1 from jsonb_array_elements_text(t->'memberIds') r join public.household_members m on m.user_id::text=r and m.household_id=h where r<>actor::text) then
   private_tabs:=private_tabs||jsonb_build_array(t||jsonb_build_object('memberIds',jsonb_build_array(actor::text)));
   private_data:=jsonb_set(private_data,array[t->>'id'],coalesce(w.payload->'data'->(t->>'id'),'{}'),true);
  else
   recipients:=coalesce(t->'memberIds','[]')-actor::text;
   if t->>'creatorId'=actor::text then t:=t||jsonb_build_object('creatorId',successor::text,'originalCreatorId',coalesce(t->>'originalCreatorId',actor::text));if not(recipients ? successor::text) then recipients:=recipients||jsonb_build_array(successor::text);end if;end if;
   t:=t||jsonb_build_object('memberIds',recipients);kept_tabs:=kept_tabs||jsonb_build_array(t);kept_data:=jsonb_set(kept_data,array[t->>'id'],coalesce(w.payload->'data'->(t->>'id'),'{}'),true);
  end if;
 end loop;
 if jsonb_array_length(private_tabs)>0 then
  if personal_home is null then select coalesce(nullif(display_name,''),'My')||' · Personal' into home_name from public.profiles where id=actor;insert into public.households(name,created_by) values(left(coalesce(home_name,'My · Personal'),80),actor) returning id into personal_home;insert into public.household_members(household_id,user_id,role) values(personal_home,actor,'owner');end if;
  insert into private.shopping_workspaces(household_id,payload) values(personal_home,jsonb_build_object('tabs',private_tabs,'data',private_data)) on conflict(household_id) do update set payload=jsonb_build_object('tabs',private.shopping_workspaces.payload->'tabs'||excluded.payload->'tabs','data',private.shopping_workspaces.payload->'data'||excluded.payload->'data'),revision=private.shopping_workspaces.revision+1;
 end if;
 update private.shopping_workspaces set payload=jsonb_build_object('tabs',kept_tabs,'data',kept_data),revision=revision+1 where household_id=h;
 return personal_home;
end $$;
revoke all on function private.shopping_departure(uuid,uuid,uuid,uuid) from public,anon,authenticated;

commit;
