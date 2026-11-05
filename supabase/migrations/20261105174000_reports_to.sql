-- Reports-to (line manager). Managers see the time of people who report to them.
alter table public.profiles add column if not exists manager_id uuid references public.profiles(id) on delete set null;
create index if not exists profiles_manager_idx on public.profiles (manager_id);
alter table public.invites add column if not exists manager_id uuid references public.profiles(id) on delete set null;

create or replace function public.reports_to_me(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_profile and manager_id = auth.uid())
$$;
revoke execute on function public.reports_to_me(uuid) from anon, public;

drop policy if exists "entries team" on public.time_entries;
create policy "entries reports" on public.time_entries for select to authenticated
  using (public.is_manager_or_admin() and public.reports_to_me(time_entries.profile_id));

create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role or new.team_id is distinct from old.team_id or new.manager_id is distinct from old.manager_id
       or new.active is distinct from old.active or new.weekly_target is distinct from old.weekly_target or new.email is distinct from old.email then
      raise exception 'Only an admin can change role, team, manager, target or status';
    end if;
  end if;
  return new;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_invite public.invites%rowtype; v_role public.app_role := 'member'; v_team uuid; v_manager uuid;
  v_active boolean := false; v_domains jsonb; v_domain text; v_name text;
begin
  v_name := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));
  if not exists (select 1 from public.profiles) then
    v_role := 'admin'; v_active := true;
  else
    select * into v_invite from public.invites where lower(email) = lower(new.email) and accepted_at is null;
    if found then
      v_role := v_invite.role; v_team := v_invite.team_id; v_manager := v_invite.manager_id; v_active := true;
      update public.invites set accepted_at = now() where id = v_invite.id;
    else
      select value into v_domains from public.settings where key = 'allowed_email_domains';
      v_domain := lower(split_part(new.email, '@', 2));
      if v_domains is not null and v_domains ? v_domain then v_active := true; end if;
    end if;
  end if;
  insert into public.profiles (id, email, full_name, team_id, manager_id, role, active)
  values (new.id, new.email, v_name, v_team, v_manager, v_role, v_active);
  return new;
end $$;

create or replace function public.week_shortfalls(p_week_start date)
returns table (profile_id uuid, person text, email text, team text, weekly_target numeric, logged_hours numeric, shortfall numeric, reminded_at timestamptz)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.full_name, pr.email, t.name, pr.weekly_target,
         coalesce(sum(e.hours), 0), pr.weekly_target - coalesce(sum(e.hours), 0),
         (select max(sent_at) from public.reminder_log r where r.profile_id = pr.id and r.week_start = p_week_start)
  from public.profiles pr
  left join public.teams t on t.id = pr.team_id
  left join public.time_entries e on e.profile_id = pr.id and e.entry_date >= p_week_start and e.entry_date < p_week_start + 7
  where pr.active and public.is_manager_or_admin() and (public.is_admin() or pr.manager_id = auth.uid())
  group by pr.id, t.name
  having coalesce(sum(e.hours), 0) < pr.weekly_target
  order by shortfall desc
$$;

create or replace function public.people_activity()
returns table (profile_id uuid, last_sign_in_at timestamptz, last_seen_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, u.last_sign_in_at, p.last_seen_at, u.created_at
  from public.profiles p join auth.users u on u.id = p.id
  where public.is_admin() or (public.is_manager_or_admin() and p.manager_id = auth.uid())
$$;
