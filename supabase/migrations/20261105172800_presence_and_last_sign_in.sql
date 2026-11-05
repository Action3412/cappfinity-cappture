alter table public.profiles add column if not exists last_seen_at timestamptz;
create or replace function public.touch_presence()
returns void language sql security definer set search_path = public as $$
  update public.profiles set last_seen_at = now() where id = auth.uid()
$$;
revoke execute on function public.touch_presence() from anon, public;
create or replace function public.people_activity()
returns table (profile_id uuid, last_sign_in_at timestamptz, last_seen_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, u.last_sign_in_at, p.last_seen_at, u.created_at
  from public.profiles p join auth.users u on u.id = p.id
  where public.is_manager_or_admin()
$$;
revoke execute on function public.people_activity() from anon, public;
