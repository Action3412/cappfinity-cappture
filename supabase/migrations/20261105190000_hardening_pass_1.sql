-- Hardening pass 1 (applied live on 2026-11-05, recorded here so the repo matches the database)
-- 1. Indexes for every foreign key the advisors flagged
-- 2. RLS policies rewritten with (select auth.uid()) so Postgres evaluates it once per query
-- 3. Dead objects removed (v_week_totals, my_team_id)
-- 4. Admin lockout guard: nobody can demote or deactivate themselves, and there is always one active admin
-- 5. Server-side aggregates so the browser never pulls every time entry just to sum it
-- 6. Atomic split_entry
-- 7. Heartbeat updates no longer bump updated_at

-- 1. Indexes
create index if not exists time_entries_work_type_idx on public.time_entries (work_type_id);
create index if not exists profiles_team_idx on public.profiles (team_id);
create index if not exists reminder_log_profile_idx on public.reminder_log (profile_id);
create index if not exists reminder_log_sent_by_idx on public.reminder_log (sent_by);
create index if not exists reminder_log_week_idx on public.reminder_log (week_start, profile_id);
create index if not exists invites_team_idx on public.invites (team_id);
create index if not exists invites_manager_idx on public.invites (manager_id);
create index if not exists invites_invited_by_idx on public.invites (invited_by);
create index if not exists projects_created_by_idx on public.projects (created_by);
create index if not exists calendar_suggestions_project_idx on public.calendar_suggestions (matched_project_id);

-- 2. Policies
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_manager_or_admin());

drop policy if exists "profiles self" on public.profiles;
create policy "profiles self" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "allocations read" on public.allocations;
create policy "allocations read" on public.allocations for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_manager_or_admin());

drop policy if exists "entries own" on public.time_entries;
create policy "entries own" on public.time_entries for all to authenticated
  using (profile_id = (select auth.uid()) and public.is_active_user())
  with check (profile_id = (select auth.uid()) and public.is_active_user());

drop policy if exists "suggestions own" on public.calendar_suggestions;
create policy "suggestions own" on public.calendar_suggestions for all to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));

drop policy if exists "reminders read" on public.reminder_log;
create policy "reminders read" on public.reminder_log for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_manager_or_admin());

-- 3. Dead objects
drop view if exists public.v_week_totals;
drop function if exists public.my_team_id();

-- 4. Admin lockout guard
create or replace function public.guard_admin_lockout()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and old.id = auth.uid() then
    if new.role is distinct from old.role or new.active is distinct from old.active then
      raise exception 'You cannot change your own role or deactivate yourself';
    end if;
  end if;
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active) then
    if (select count(*) from public.profiles where role = 'admin' and active and id <> old.id) = 0 then
      raise exception 'There must always be at least one active admin';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_admin_lockout on public.profiles;
create trigger profiles_admin_lockout before update on public.profiles
  for each row execute function public.guard_admin_lockout();

-- 5. Server-side aggregates
create or replace function public.my_project_totals()
returns table (project_id uuid, hours numeric)
language sql stable set search_path = public as $$
  select project_id, sum(hours) from public.time_entries where profile_id = (select auth.uid()) group by project_id
$$;

create or replace function public.work_type_usage()
returns table (work_type_id uuid, hours numeric)
language sql stable security definer set search_path = public as $$
  select work_type_id, sum(hours) from public.time_entries where public.is_admin() group by work_type_id
$$;

create or replace function public.project_totals()
returns table (project_id uuid, logged_hours numeric, people int)
language sql stable security definer set search_path = public as $$
  select e.project_id, sum(e.hours), count(distinct e.profile_id)::int
  from public.time_entries e
  where public.is_manager_or_admin()
  group by e.project_id
$$;

-- 6. Atomic split
create or replace function public.split_entry(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e public.time_entries%rowtype; v_half numeric; v_rest numeric; v_new uuid;
begin
  select * into e from public.time_entries where id = p_id and profile_id = auth.uid();
  if not found then raise exception 'Not your entry'; end if;
  v_half := greatest(0.25, round(e.hours / 2 * 4) / 4);
  v_rest := round((e.hours - v_half) * 4) / 4;
  if v_rest < 0.25 then raise exception 'Too short to split'; end if;
  update public.time_entries set hours = v_half where id = e.id;
  insert into public.time_entries (profile_id, project_id, work_type_id, entry_date, hours, note, source, start_time)
  values (e.profile_id, e.project_id, null, e.entry_date, v_rest, null, 'manual', e.start_time + make_interval(mins => (v_half * 60)::int))
  returning id into v_new;
  return v_new;
end $$;

-- 7. Heartbeat-safe updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'profiles' and (to_jsonb(new) - 'last_seen_at' - 'updated_at') = (to_jsonb(old) - 'last_seen_at' - 'updated_at') then
    return new;
  end if;
  new.updated_at = now();
  return new;
end $$;

revoke execute on function public.my_project_totals(), public.work_type_usage(), public.project_totals(), public.split_entry(uuid) from anon;
grant execute on function public.my_project_totals(), public.work_type_usage(), public.project_totals(), public.split_entry(uuid) to authenticated;
