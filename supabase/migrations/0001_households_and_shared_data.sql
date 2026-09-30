-- ChillAllot: authenticated users, household membership, and private shared app data.
-- Apply in the Supabase SQL editor or with the Supabase CLI.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  badge_color text not null default 'sage' check (badge_color in ('sage','blue','peach','lavender','coral','gold')),
  avatar_key text not null default 'initial' check (avatar_key in ('initial','leaf','sun','moon','cat','dog','home')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists badge_color text not null default 'sage';
alter table public.profiles add column if not exists avatar_key text not null default 'initial';

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  invite_code text not null unique default upper(encode(gen_random_bytes(5), 'hex')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- The app keeps its four modules and preferences as separate JSON documents.
-- Each document remains protected by household membership RLS.
create table if not exists public.household_data (
  household_id uuid not null references public.households(id) on delete cascade,
  data_key text not null check (data_key in ('bills','shopping','appointments','chores','quick_adds','notifications','quiet_hours','theme','store','dismissed_sources')),
  payload jsonb not null default '{}'::jsonb,
  updated_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (household_id, data_key)
);

create or replace function public.is_household_member(target_household uuid)
returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.household_members hm
    where hm.household_id = target_household and hm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_household_member(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;

create or replace function public.create_household(household_name text)
returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare new_household uuid;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  if length(trim(household_name)) not between 1 and 80 then raise exception 'Enter a household name'; end if;
  insert into public.households(name, created_by) values (trim(household_name), auth.uid()) returning id into new_household;
  insert into public.household_members(household_id, user_id, role) values (new_household, auth.uid(), 'owner');
  return new_household;
end;
$$;

create or replace function public.join_household(invite_code_input text)
returns uuid language plpgsql security definer
set search_path = public, pg_temp
as $$
declare target_household uuid;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  select id into target_household from public.households
    where invite_code = upper(trim(invite_code_input));
  if target_household is null then raise exception 'Invite code not found'; end if;
  insert into public.household_members(household_id, user_id, role)
    values (target_household, auth.uid(), 'member') on conflict do nothing;
  return target_household;
end;
$$;

revoke all on function public.create_household(text) from public;
revoke all on function public.join_household(text) from public;
grant execute on function public.create_household(text) to authenticated;
grant execute on function public.join_household(text) to authenticated;

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_data enable row level security;

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "Household members read co-member profiles" on public.profiles;
create policy "Household members read co-member profiles" on public.profiles for select to authenticated using (
  exists (
    select 1 from public.household_members mine
    join public.household_members theirs on theirs.household_id = mine.household_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);
drop policy if exists "Users create own profile" on public.profiles;
create policy "Users create own profile" on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "Members read households" on public.households;
create policy "Members read households" on public.households for select to authenticated using (public.is_household_member(id));
drop policy if exists "Members update household name" on public.households;
create policy "Members update household name" on public.households for update to authenticated using (public.is_household_member(id)) with check (public.is_household_member(id));

drop policy if exists "Members read household roster" on public.household_members;
create policy "Members read household roster" on public.household_members for select to authenticated using (public.is_household_member(household_id));

drop policy if exists "Members read shared data" on public.household_data;
create policy "Members read shared data" on public.household_data for select to authenticated using (public.is_household_member(household_id));
drop policy if exists "Members add shared data" on public.household_data;
create policy "Members add shared data" on public.household_data for insert to authenticated with check (public.is_household_member(household_id) and updated_by = auth.uid());
drop policy if exists "Members update shared data" on public.household_data;
create policy "Members update shared data" on public.household_data for update to authenticated using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
drop policy if exists "Members remove shared data" on public.household_data;
create policy "Members remove shared data" on public.household_data for delete to authenticated using (public.is_household_member(household_id));

-- Create a profile for each new auth user; display name comes from sign-up metadata.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', ''))
  on conflict (id) do update set display_name = excluded.display_name, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Enable live household updates for connected devices.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'household_data'
  ) then
    alter publication supabase_realtime add table public.household_data;
  end if;
end;
$$;
