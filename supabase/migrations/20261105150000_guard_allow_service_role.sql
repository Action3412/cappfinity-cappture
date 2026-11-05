-- Let the service role / SQL editor update profiles; only gate signed-in non-admins.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role
       or new.team_id is distinct from old.team_id
       or new.active is distinct from old.active
       or new.weekly_target is distinct from old.weekly_target
       or new.email is distinct from old.email then
      raise exception 'Only an admin can change role, team, target or status';
    end if;
  end if;
  return new;
end $$;
