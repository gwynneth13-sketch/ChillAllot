-- Owner-controlled shared household name.
begin;
create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;
create or replace function private.rename_household(target_household uuid,household_name text)
returns text language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();chosen text:=btrim(household_name);
begin
 if actor is null or not exists(select 1 from public.household_members where household_id=target_household and user_id=actor and role='owner') then raise exception 'Only the household owner can change its name';end if;
 if chosen is null or length(chosen) not between 1 and 80 then raise exception 'Enter a household name up to 80 characters';end if;
 update public.households set name=chosen where id=target_household;
 return chosen;
end $$;
create or replace function public.rename_household(target_household uuid,household_name text)
returns text language sql security invoker set search_path='' as $$select private.rename_household(target_household,household_name)$$;
revoke all on function private.rename_household(uuid,text),public.rename_household(uuid,text) from public,anon;
grant execute on function private.rename_household(uuid,text),public.rename_household(uuid,text) to authenticated;
commit;
