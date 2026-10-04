-- Sender-specific invitations; non-owner invitations wait for the original creator.
begin;
create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;
create table if not exists private.household_invitations (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 invited_by uuid not null references public.profiles(id),
 token text not null unique default replace(gen_random_uuid()::text,'-',''),
 expires_at timestamptz not null default now()+interval '30 days'
);
create table if not exists private.household_join_requests (
 id uuid primary key default gen_random_uuid(),
 household_id uuid not null references public.households(id) on delete cascade,
 user_id uuid not null references public.profiles(id),
 invited_by uuid references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','approved','declined','cancelled')),
 created_at timestamptz not null default now(),
 decided_at timestamptz,
 unique(household_id,user_id)
);
alter table private.household_invitations enable row level security;
alter table private.household_join_requests enable row level security;
revoke all on private.household_invitations,private.household_join_requests from public,anon,authenticated;

-- Prevent direct REST writes from changing the original creator or invitation code.
revoke update on public.households from authenticated,anon;
revoke update(id,name,invite_code,created_by,created_at) on public.households from authenticated,anon;

create or replace function private.household_invitation(operation text,input_values jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); home public.households%rowtype; invitation private.household_invitations%rowtype;
 request private.household_join_requests%rowtype; code text; request_id uuid; result jsonb;
begin
 if actor is null then raise exception 'Sign in to continue.'; end if;
 if operation='issue' then
  select * into home from public.households where id=(input_values->>'householdId')::uuid;
  if not found or not exists(select 1 from public.household_members where household_id=home.id and user_id=actor) then raise exception 'Only household members can invite someone.'; end if;
  select * into invitation from private.household_invitations where household_id=home.id and invited_by=actor and expires_at>now()+interval '1 day' order by expires_at desc limit 1;
  if not found then insert into private.household_invitations(household_id,invited_by) values(home.id,actor) returning * into invitation; end if;
  return jsonb_build_object('code',invitation.token,'requiresApproval',actor<>home.created_by);
 elsif operation='join' then
  code:=trim(input_values->>'code');
  select * into invitation from private.household_invitations where lower(token)=lower(code) and expires_at>now();
  if found then
   select * into home from public.households where id=invitation.household_id;
   if not exists(select 1 from public.household_members where household_id=home.id and user_id=invitation.invited_by) then raise exception 'This invitation is no longer available.'; end if;
  else
   -- Existing shared codes cannot identify the sender, so require owner approval.
   select * into home from public.households where invite_code=upper(code);
   if not found then raise exception 'Invitation not found or expired.'; end if;
  end if;
  if exists(select 1 from public.household_members where household_id=home.id and user_id=actor) then
   return jsonb_build_object('status','joined','householdId',home.id,'householdName',home.name);
  end if;
  if invitation.invited_by=home.created_by then
   insert into public.household_members(household_id,user_id,role) values(home.id,actor,'member') on conflict do nothing;
   update private.household_join_requests set status='approved',decided_at=now() where household_id=home.id and user_id=actor;
   return jsonb_build_object('status','joined','householdId',home.id,'householdName',home.name);
  end if;
  insert into private.household_join_requests(household_id,user_id,invited_by) values(home.id,actor,invitation.invited_by)
  on conflict(household_id,user_id) do update set invited_by=excluded.invited_by,status='pending',created_at=now(),decided_at=null
  returning id into request_id;
  return jsonb_build_object('status','pending','requestId',request_id,'householdId',home.id,'householdName',home.name);
 elsif operation='list' then
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'householdId',r.household_id,'householdName',h.name,'personName',p.display_name,'inviterName',i.display_name,'mine',r.user_id=actor,'status',r.status) order by r.created_at),'[]') into result
  from private.household_join_requests r join public.households h on h.id=r.household_id
  join public.profiles p on p.id=r.user_id left join public.profiles i on i.id=r.invited_by
  where (r.status='pending' and (r.user_id=actor or h.created_by=actor)) or (r.status='declined' and r.user_id=actor);
  return result;
 elsif operation in ('approve','decline','cancel') then
  select * into request from private.household_join_requests where id=(input_values->>'requestId')::uuid for update;
  if not found then raise exception 'Request not found.'; end if;
  select * into home from public.households where id=request.household_id;
  if operation='cancel' then
   if request.user_id<>actor then raise exception 'You can only cancel your own request.'; end if;
  elsif home.created_by<>actor then raise exception 'Only the household owner can approve or decline a request.';
  end if;
  if request.status<>'pending' and not(operation='cancel' and request.status='declined') then raise exception 'This request has already been handled.'; end if;
  if operation='approve' then
   insert into public.household_members(household_id,user_id,role) values(home.id,request.user_id,'member') on conflict do nothing;
  end if;
  update private.household_join_requests set status=case operation when 'approve' then 'approved' when 'decline' then 'declined' else 'cancelled' end,decided_at=now() where id=request.id;
  return jsonb_build_object('status',operation);
 end if;
 raise exception 'Unknown invitation action.';
end;
$$;
revoke all on function private.household_invitation(text,jsonb) from public,anon;
grant execute on function private.household_invitation(text,jsonb) to authenticated;
create or replace function public.household_invitation(operation text,input_values jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$select private.household_invitation(operation,input_values)$$;
revoke all on function public.household_invitation(text,jsonb) from public,anon;
grant execute on function public.household_invitation(text,jsonb) to authenticated;

-- Older clients cannot bypass approval using the former join endpoint.
create or replace function public.join_household(invite_code_input text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 result:=private.household_invitation('join',jsonb_build_object('code',invite_code_input));
 if result->>'status'='pending' then raise exception 'Please update ChillAllot to request the household owner’s approval.'; end if;
 return (result->>'householdId')::uuid;
end;$$;
revoke all on function public.join_household(text) from public,anon;
grant execute on function public.join_household(text) to authenticated;
commit;
