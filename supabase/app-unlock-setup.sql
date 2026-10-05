begin;
create table if not exists public.app_unlock_credentials (
 id text primary key,user_id uuid not null references auth.users(id) on delete cascade,
 public_key jsonb not null,counter bigint not null default 0,transports jsonb not null default '[]',
 created_at timestamptz not null default now()
);
create index if not exists app_unlock_credentials_user_idx on public.app_unlock_credentials(user_id);
create table if not exists public.app_unlock_challenges (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('register','authenticate')),credential_id text,
 challenge text not null,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '5 minutes'
);
create index if not exists app_unlock_challenges_user_idx on public.app_unlock_challenges(user_id,created_at);
alter table public.app_unlock_credentials enable row level security;
alter table public.app_unlock_challenges enable row level security;
revoke all on public.app_unlock_credentials,public.app_unlock_challenges from public,anon,authenticated;
grant select,insert,update,delete on public.app_unlock_credentials,public.app_unlock_challenges to service_role;
-- Consume before verifying: failures cannot reuse a challenge. Only the trusted function can call this.
create or replace function public.consume_app_unlock_challenge(challenge_id uuid,actor_id uuid,expected_kind text)
returns setof public.app_unlock_challenges language sql security invoker set search_path='' as $$
 delete from public.app_unlock_challenges where id=challenge_id and user_id=actor_id and kind=expected_kind and expires_at>now() returning *;
$$;
revoke all on function public.consume_app_unlock_challenge(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.consume_app_unlock_challenge(uuid,uuid,text) to service_role;
commit;
