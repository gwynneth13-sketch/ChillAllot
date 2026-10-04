-- Run once in the SQL editor before publishing the bill workspace.
-- Original bill documents are retained as an administrator-only backup.
begin;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create table if not exists private.bills (
  household_id uuid not null references public.households(id) on delete cascade,
  id text not null,
  creator_id uuid references public.profiles(id),
  record jsonb not null,
  preferences jsonb not null default '{}',
  cycles jsonb not null default '[]',
  revision bigint not null default 1,
  primary key(household_id,id)
);
alter table private.bills enable row level security;
revoke all on private.bills from public,anon,authenticated;

insert into private.bills(household_id,id,record)
select d.household_id, coalesce(nullif(b.item->>'id',''),'legacy-'||b.ordinality::text), b.item
from public.household_data d cross join lateral jsonb_array_elements(case when jsonb_typeof(d.payload)='array' then d.payload else '[]'::jsonb end) with ordinality b(item,ordinality)
where d.data_key='bills' on conflict do nothing;

-- Restrictive policies combine with the existing membership policies.
drop policy if exists bills_use_private_storage on public.household_data;
create policy bills_use_private_storage on public.household_data as restrictive
for all to authenticated using(data_key<>'bills') with check(data_key<>'bills');

create or replace function private.next_bill_date(d date, cadence text)
returns date language plpgsql immutable set search_path='' as $$
declare m text[]; n integer; unit text;
begin
  m:=regexp_match(cadence,'^Every ([0-9]+) (days?|weeks?|months?|years?)$','i');
  if m is not null then n:=m[1]::integer;unit:=rtrim(lower(m[2]),'s');
  elsif cadence like '%Monthly%' then n:=1;unit:='month';
  elsif cadence='Annually' then n:=1;unit:='year';
  elsif cadence='Weekly' then n:=1;unit:='week';
  else return d;end if;
  if n<1 or n>10000 then raise exception 'Choose a valid repeat interval';end if;
  return (d+make_interval(days=>case when unit='day' then n when unit='week' then n*7 else 0 end,months=>case when unit='month' then n when unit='year' then n*12 else 0 end))::date;
end $$;

create or replace function private.bill_settings(v jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb; key text; value text;
begin
  result:=jsonb_build_object('note',coalesce(v->>'note',''),'reminder',coalesce(v->>'reminder',''),'reminderTime',coalesce(v->>'reminderTime',''),'paymentLink',coalesce(v->>'paymentLink',''),'bankLink',coalesce(v->>'bankLink',''));
  if length(result->>'note')>4000 then raise exception 'The note is too long';end if;
  foreach key in array array['paymentLink','bankLink'] loop
    value:=result->>key;
    if length(value)>2000 or (value<>'' and value!~*'^https?://[^[:space:]]+$') then raise exception 'Use an http or https link';end if;
  end loop;
  if result->>'reminder'<>'' then
    if result->>'reminder'!~'^Every [0-9]+ (days?|weeks?|hours?|minutes?|months?) before$' then raise exception 'Choose a valid reminder';end if;
    if result->>'reminder'!~' (hours?|minutes?) before$' and result->>'reminderTime'!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Choose a reminder time';end if;
  end if;
  return result;
end $$;

create or replace function private.validate_bill(h uuid, creator uuid, v jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare visibility text:=v->>'visibility'; viewers jsonb; payers jsonb; allocations jsonb; member_ids jsonb; due date; amount numeric; result jsonb; total numeric;
begin
  if not exists(select 1 from public.household_members where household_id=h and user_id=creator) then raise exception 'Choose a household member as creator';end if;
  if visibility not in ('private','selected','household') or visibility is null then raise exception 'Choose who can see the bill';end if;
  if coalesce(length(trim(v->>'name')),0) not between 1 and 120 then raise exception 'Enter a bill name';end if;
  amount:=(v->>'amount')::numeric;
  if (amount is null and coalesce(v->>'amountType','fixed')<>'variable') or amount<0 or amount>999999999.99 or amount<>round(amount,2) then raise exception 'Enter a valid amount';end if;
  due:=(v->>'due')::date;
  if due is null then raise exception 'Choose a due date';end if;
  if v->>'cadence' not in ('One-time','Weekly','Monthly','Monthly · Variable','Variable Monthly','Annually') and coalesce(v->>'cadence','')!~'^Every [1-9][0-9]* (days?|weeks?|months?|years?)$' then raise exception 'Choose a valid repeat interval';end if;
  perform private.next_bill_date(due,v->>'cadence');
  viewers:=coalesce(v->'viewerIds','[]');payers:=coalesce(v->'payerIds','[]');allocations:=coalesce(v->'allocations','[]');
  if jsonb_typeof(viewers)<>'array' or jsonb_typeof(payers)<>'array' or jsonb_typeof(allocations)<>'array' then raise exception 'Invalid member selection';end if;
  select coalesce(jsonb_agg(user_id::text),'[]') into member_ids from public.household_members where household_id=h;
  if not member_ids @> viewers or not member_ids @> payers or jsonb_array_length(payers)=0 then raise exception 'Choose household members';end if;
  if visibility='private' and payers<>jsonb_build_array(creator::text) then raise exception 'A private bill can only have its creator as payer';end if;
  if visibility='selected' and not (viewers||jsonb_build_array(creator::text)) @> payers then raise exception 'Share the bill with each payer';end if;
  if jsonb_array_length(allocations)>0 then
    select sum((s->>'percent')::numeric) into total from jsonb_array_elements(allocations) s;
    if total<>100 or exists(select 1 from jsonb_array_elements(allocations) s where (s->>'percent') is null or (s->>'percent')::numeric<=0 or (s->>'percent')::numeric>100 or not payers @> jsonb_build_array(s->>'userId')) then raise exception 'Payer shares must total 100 percent';end if;
    if (select count(distinct s->>'userId') from jsonb_array_elements(allocations) s)<>jsonb_array_length(allocations) or jsonb_array_length(allocations)<>jsonb_array_length(payers) then raise exception 'Choose each payer once';end if;
  elsif payers<>jsonb_build_array(creator::text) then raise exception 'Choose a split for multiple payers';end if;
  select coalesce(jsonb_agg(jsonb_build_object('userId',s->>'userId','percent',(s->>'percent')::numeric)),'[]') into allocations from jsonb_array_elements(allocations) s;
  result:=jsonb_build_object('name',trim(v->>'name'),'amount',amount,'amountType',case when v->>'amountType'='variable' then 'variable' else 'fixed' end,'due',due::text,'cadence',v->>'cadence','kind',case when v->>'kind'='Auto' then 'Auto' else 'Manual' end,'visibility',visibility,'viewerIds',case when visibility='selected' then viewers else '[]'::jsonb end,'payerIds',payers,'allocations',allocations);
  return result||private.bill_settings(v);
end $$;

create or replace function private.bill_workspace(h uuid, op text, bill_id text, v jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); owner boolean; b private.bills%rowtype; creator uuid; item jsonb; cycle jsonb; new_cycles jsonb; matching integer; paid jsonb; visible boolean; old_due text; next_due text; result jsonb; s jsonb; historical jsonb;
begin
  if actor is null or not exists(select 1 from public.household_members where household_id=h and user_id=actor) then raise exception 'Household access is required';end if;
  select role='owner' into owner from public.household_members where household_id=h and user_id=actor;
  if op='create' then
    if length(coalesce(bill_id,'')) not between 1 and 120 then raise exception 'Invalid bill identifier';end if;
    item:=private.validate_bill(h,actor,v);
    insert into private.bills(household_id,id,creator_id,record) values(h,bill_id,actor,item);
  elsif op<>'list' then
    select * into b from private.bills where household_id=h and id=bill_id for update;
    if not found or coalesce((b.record->>'deleted')::boolean,false) then raise exception 'Bill not found';end if;
    visible:=b.creator_id=actor or (b.creator_id is not null and (b.record->>'visibility'='household' or (b.record->>'visibility'='selected' and b.record->'viewerIds' @> jsonb_build_array(actor::text))));
    if op='assign' then
      if not owner or b.creator_id is not null then raise exception 'Only a household owner can assign an unassigned bill';end if;
      creator:=(v->>'creatorId')::uuid;
      item:=private.validate_bill(h,creator,v);
      -- Preserve old payments only when a display name identifies one member.
      new_cycles:='[]';
      for cycle in select x from jsonb_array_elements(coalesce(b.record->'paymentHistory','[]')||jsonb_build_array(jsonb_build_object('due',b.record->>'due','payers',coalesce(b.record->'paid','[]'),'amount',b.record->'amount'))) x loop
        select coalesce(jsonb_agg(m.user_id::text),'[]') into paid from public.household_members m join public.profiles p on p.id=m.user_id
        where m.household_id=h and cycle->'payers' @> jsonb_build_array(p.display_name)
          and (select count(*) from public.household_members hm join public.profiles pr on pr.id=hm.user_id where hm.household_id=h and pr.display_name=p.display_name)=1;
        if jsonb_array_length(paid)>0 then new_cycles:=new_cycles||jsonb_build_array(jsonb_build_object('due',cycle->>'due','paidIds',paid,'payerIds',item->'payerIds','snapshot',item||jsonb_build_object('due',cycle->>'due','amount',coalesce(cycle->'amount',item->'amount'))));end if;
      end loop;
      update private.bills set creator_id=creator,record=item,cycles=new_cycles,revision=revision+1 where household_id=h and id=bill_id;
    elsif not coalesce(visible,false) then raise exception 'Bill access is required';
    elsif op='delete' then
      if b.creator_id<>actor then raise exception 'Only the creator can delete this bill';end if;
      if (v->>'expectedRevision')::bigint is distinct from b.revision then raise exception 'This bill changed in another window. Reopen it before deleting';end if;
      update private.bills set record=jsonb_set(record,'{deleted}','true'),revision=revision+1 where household_id=h and id=bill_id;
    elsif op='edit' then
      if b.creator_id<>actor then raise exception 'Only the creator can edit the shared bill';end if;
      if (v->>'expectedRevision')::bigint is distinct from b.revision then raise exception 'This bill changed in another window. Reopen it before saving';end if;
      item:=private.validate_bill(h,actor,v);
      if exists(select 1 from jsonb_array_elements(b.cycles) c where c->>'due'=b.record->>'due' and jsonb_array_length(c->'paidIds')>0) and (item->>'due'<>b.record->>'due' or item->'payerIds'<>b.record->'payerIds' or item->'allocations'<>b.record->'allocations' or item->'amount'<>b.record->'amount') then raise exception 'Undo recorded payments before changing the due date, amount, or payers';end if;
      update private.bills set record=item,revision=revision+1 where household_id=h and id=bill_id;
    elsif op='amount' then
      if b.record->>'amountType'<>'variable' or b.record->>'amount' is not null then raise exception 'This bill already has an amount. Refresh to see it';end if;
      if v->>'due' is distinct from b.record->>'due' or (v->>'expectedRevision')::bigint is distinct from b.revision then raise exception 'This bill changed. Reopen Enter amount before saving';end if;
      if v->>'amount' is null then raise exception 'Enter an amount';end if;
      item:=private.validate_bill(h,b.creator_id,b.record||jsonb_build_object('amount',v->'amount'));
      update private.bills set record=item,revision=revision+1 where household_id=h and id=bill_id;
    elsif op='clearAmount' then
      if b.record->>'amountType'<>'variable' then raise exception 'Only a variable bill amount can be cleared';end if;
      if v->>'due' is distinct from b.record->>'due' or (v->>'expectedRevision')::bigint is distinct from b.revision then raise exception 'This bill changed. Refresh before clearing its amount';end if;
      if exists(select 1 from jsonb_array_elements(b.cycles) c where c->>'due'=b.record->>'due' and jsonb_array_length(c->'paidIds')>0) then raise exception 'This amount cannot be cleared after a payment has been recorded';end if;
      update private.bills set record=jsonb_set(record,'{amount}','null'::jsonb),revision=revision+1 where household_id=h and id=bill_id;
    elsif op in ('settings','resetSettings') then
      s:=case when op='settings' then jsonb_set(b.preferences,array[actor::text],private.bill_settings(v),true) else b.preferences-actor::text end;
      update private.bills set preferences=s where household_id=h and id=bill_id;
    elsif op='pay' then
      if b.record->>'amount' is null then raise exception 'Enter the amount before marking paid';end if;
      if not b.record->'payerIds' @> jsonb_build_array(actor::text) then raise exception 'Only a payer can mark their own payment';end if;
      if v->>'due'<>b.record->>'due' or v->>'due' is null then raise exception 'This bill changed. Refresh before marking paid';end if;
      cycle:=null;select c into cycle from jsonb_array_elements(b.cycles) c where c->>'due'=v->>'due';
      if cycle is null then cycle:=jsonb_build_object('due',v->>'due','paidIds','[]'::jsonb,'payerIds',b.record->'payerIds','snapshot',b.record);end if;
      if not cycle->'paidIds' @> jsonb_build_array(actor::text) then cycle:=jsonb_set(cycle,'{paidIds}',(cycle->'paidIds')||jsonb_build_array(actor::text));end if;
      select coalesce(jsonb_agg(c),'[]') into new_cycles from jsonb_array_elements(b.cycles) c where c->>'due'<>v->>'due';new_cycles:=new_cycles||jsonb_build_array(cycle);
      item:=b.record;
      if (cycle->'paidIds') @> (cycle->'payerIds') then item:=jsonb_set(item,'{due}',to_jsonb(private.next_bill_date((item->>'due')::date,item->>'cadence')::text));end if;
      if item->>'due'<>b.record->>'due' and item->>'amountType'='variable' then item:=jsonb_set(item,'{amount}','null'::jsonb);end if;
      update private.bills set record=item,cycles=new_cycles,revision=revision+1 where household_id=h and id=bill_id;
    elsif op='undo' then
      select c into cycle from jsonb_array_elements(b.cycles) c where c->>'due'=v->>'due';
      if cycle is null or not cycle->'paidIds' @> jsonb_build_array(actor::text) then raise exception 'You can undo only your own recorded payment';end if;
      old_due:=cycle->>'due';
      if exists(select 1 from jsonb_array_elements(b.cycles) c where c->>'due'>old_due and jsonb_array_length(c->'paidIds')>0) then raise exception 'Undo your later payments first. Earlier payments cannot change a later paid cycle';end if;
      item:=b.record;
      if old_due<>item->>'due' then
        item:=jsonb_set(item,'{due}',to_jsonb(old_due));
        if item->>'amountType'='variable' then item:=jsonb_set(item,'{amount}',cycle->'snapshot'->'amount');end if;
      end if;
      cycle:=jsonb_set(cycle,'{paidIds}',(cycle->'paidIds')-actor::text);
      select coalesce(jsonb_agg(case when c->>'due'=old_due then cycle else c end),'[]') into new_cycles from jsonb_array_elements(b.cycles) c;
      update private.bills set record=item,cycles=new_cycles,revision=revision+1 where household_id=h and id=bill_id;
    else raise exception 'Unknown bill action';end if;
  end if;
  -- Never return another member's personal settings, including in history snapshots.
  select coalesce(jsonb_agg(
    case when x.creator_id is null then x.record||jsonb_build_object('id',x.id,'creatorId',null,'cycles','[]'::jsonb)
    else x.record||coalesce(x.preferences->actor::text,'{}')||jsonb_build_object('id',x.id,'creatorId',x.creator_id::text,'revision',x.revision,'currentPaidIds',coalesce((select c->'paidIds' from jsonb_array_elements(x.cycles) c where c->>'due'=x.record->>'due'),'[]'::jsonb),'defaults',private.bill_settings(x.record),'cycles',coalesce((select jsonb_agg(c||jsonb_build_object('snapshot',(c->'snapshot')||coalesce(x.preferences->actor::text,'{}'))) from jsonb_array_elements(x.cycles) c where c->'paidIds' @> jsonb_build_array(actor::text)),'[]'::jsonb)) end
    order by x.id),'[]') into result
  from private.bills x where x.household_id=h and not coalesce((x.record->>'deleted')::boolean,false) and ((x.creator_id is null and owner) or x.creator_id=actor or (x.creator_id is not null and (x.record->>'visibility'='household' or (x.record->>'visibility'='selected' and x.record->'viewerIds' @> jsonb_build_array(actor::text)))));
  return result;
end $$;

create or replace function public.bill_workspace(target_household uuid, operation text default 'list', target_bill text default '', input_values jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$
  select private.bill_workspace(target_household,operation,target_bill,input_values);
$$;
revoke all on function private.next_bill_date(date,text),private.bill_settings(jsonb),private.validate_bill(uuid,uuid,jsonb),private.bill_workspace(uuid,text,text,jsonb),public.bill_workspace(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function private.bill_workspace(uuid,text,text,jsonb),public.bill_workspace(uuid,text,text,jsonb) to authenticated;
commit;

select count(*) as preserved_bills, count(*) filter(where creator_id is null) as bills_needing_creator from private.bills;
