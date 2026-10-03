-- Allow custom badge colors, letters, emojis, and cropped photos.
-- Existing profile permissions and household isolation stay in place.
begin;
alter table public.profiles drop constraint if exists profiles_badge_color_check;
alter table public.profiles drop constraint if exists profiles_avatar_key_check;
alter table public.profiles add constraint profiles_badge_color_check check (
  badge_color in ('sage','blue','peach','lavender','coral','gold')
  or badge_color ~ '^#[0-9A-Fa-f]{6}$'
);
alter table public.profiles add constraint profiles_avatar_key_check check (
  avatar_key in ('initial','leaf','sun','moon','cat','dog','home')
  or avatar_key ~ '^initial:[A-Z]$'
  or (avatar_key like 'emoji:%' and char_length(avatar_key) between 7 and 40)
  or (avatar_key ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' and octet_length(avatar_key) <= 80000)
);
commit;
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.profiles'::regclass
and conname in ('profiles_badge_color_check','profiles_avatar_key_check');