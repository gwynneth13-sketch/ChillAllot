-- Personal view preference only; no household or membership changes.
begin;
create table if not exists public.household_visibility (
 household_id uuid not null references public.households(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 hidden boolean not null default false,
 primary key(household_id,user_id)
);
alter table public.household_visibility enable row level security;
revoke all on public.household_visibility from public,anon,authenticated;
grant select,insert,update on public.household_visibility to authenticated;
drop policy if exists visibility_select on public.household_visibility;
create policy visibility_select on public.household_visibility for select to authenticated
 using(user_id=(select auth.uid()));
drop policy if exists visibility_insert on public.household_visibility;
create policy visibility_insert on public.household_visibility for insert to authenticated
 with check(user_id=(select auth.uid()) and exists(select 1 from public.household_members m where m.household_id=household_visibility.household_id and m.user_id=(select auth.uid())));
drop policy if exists visibility_update on public.household_visibility;
create policy visibility_update on public.household_visibility for update to authenticated
 using(user_id=(select auth.uid()))
 with check(user_id=(select auth.uid()) and exists(select 1 from public.household_members m where m.household_id=household_visibility.household_id and m.user_id=(select auth.uid())));
commit;
select to_regclass('public.household_visibility') is not null as hide_household_ready;
