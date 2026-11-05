-- Week approvals. Only shown in the app when the "require approval" setting is on, but the
-- tables and locks are always there so turning it on later needs no migration.
--
-- Flow: person submits a week -> entries lock -> their manager (or an admin) approves or returns it.
-- Returned unlocks the week so they can fix it and resubmit. A submitted week can be withdrawn
-- by the person until it is approved. Admins can always edit.

create type public.approval_status as enum ('submitted', 'approved', 'returned');

create table public.week_approvals (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles (id) on delete cascade,
  week_start   date not null,
  status       public.approval_status not null default 'submitted',
  submitted_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references public.profiles (id) on delete set null,
  note         text,
  unique (profile_id, week_start)
);
create index week_approvals_status_idx on public.week_approvals (status, week_start);
create index week_approvals_decided_by_idx on public.week_approvals (decided_by);
alter table public.week_approvals enable row level security;

create policy "approvals read" on public.week_approvals for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_admin() or public.reports_to_me(profile_id));

-- Locked means submitted or approved and the caller is not an admin
create or replace function public.week_locked(p_profile uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.week_approvals a
    where a.profile_id = p_profile and a.week_start = public.week_start(p_date)
      and a.status in ('submitted', 'approved')
  ) and not public.is_admin()
$$;
revoke execute on function public.week_locked(uuid, date) from anon;

create or replace function public.guard_locked_week()
returns trigger language plpgsql security definer set search_path = public as $$
declare r public.time_entries;
begin
  r := coalesce(new, old);
  if auth.uid() is not null and public.week_locked(r.profile_id, r.entry_date) then
    raise exception 'That week has been submitted for approval and is locked. Withdraw it first if you need to change something.';
  end if;
  if tg_op = 'UPDATE' and new.entry_date <> old.entry_date and auth.uid() is not null and public.week_locked(new.profile_id, new.entry_date) then
    raise exception 'That week has been submitted for approval and is locked.';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists time_entries_locked_week on public.time_entries;
create trigger time_entries_locked_week before insert or update or delete on public.time_entries
  for each row execute function public.guard_locked_week();

-- Submit (or resubmit after a return). Withdraw deletes a submitted row.
create or replace function public.submit_week(p_week_start date)
returns public.week_approvals language plpgsql security definer set search_path = public as $$
declare v_monday date := public.week_start(p_week_start); r public.week_approvals;
begin
  if not public.is_active_user() then raise exception 'Not permitted'; end if;
  if exists (select 1 from public.week_approvals where profile_id = auth.uid() and week_start = v_monday and status = 'approved') then
    raise exception 'That week is already approved';
  end if;
  insert into public.week_approvals (profile_id, week_start, status, submitted_at, decided_at, decided_by, note)
  values (auth.uid(), v_monday, 'submitted', now(), null, null, null)
  on conflict (profile_id, week_start) do update
    set status = 'submitted', submitted_at = now(), decided_at = null, decided_by = null, note = null
  returning * into r;
  return r;
end $$;

create or replace function public.withdraw_week(p_week_start date)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.week_approvals
  where profile_id = auth.uid() and week_start = public.week_start(p_week_start) and status = 'submitted';
end $$;

-- Manager or admin decides
create or replace function public.decide_week(p_profile uuid, p_week_start date, p_status public.approval_status, p_note text default null)
returns public.week_approvals language plpgsql security definer set search_path = public as $$
declare r public.week_approvals;
begin
  if p_status not in ('approved', 'returned') then raise exception 'Status must be approved or returned'; end if;
  if not (public.is_admin() or public.reports_to_me(p_profile)) then raise exception 'Not permitted'; end if;
  update public.week_approvals
  set status = p_status, decided_at = now(), decided_by = auth.uid(), note = nullif(trim(p_note), '')
  where profile_id = p_profile and week_start = public.week_start(p_week_start)
  returning * into r;
  if r.id is null then raise exception 'Nothing submitted for that week'; end if;
  return r;
end $$;

-- Queue for managers: everything submitted (or recently decided) for people who report to me
create or replace function public.approvals_queue()
returns table (id uuid, profile_id uuid, person text, email text, team text, week_start date, status public.approval_status,
               submitted_at timestamptz, decided_at timestamptz, note text, logged_hours numeric, weekly_target numeric)
language sql stable security definer set search_path = public as $$
  select a.id, a.profile_id, pr.full_name, pr.email, t.name, a.week_start, a.status, a.submitted_at, a.decided_at, a.note,
         coalesce((select sum(e.hours) from public.time_entries e join public.projects p on p.id = e.project_id and p.counts_toward_target
                   where e.profile_id = a.profile_id and e.entry_date >= a.week_start and e.entry_date < a.week_start + 7), 0),
         pr.weekly_target
  from public.week_approvals a
  join public.profiles pr on pr.id = a.profile_id
  left join public.teams t on t.id = pr.team_id
  where public.is_manager_or_admin() and (public.is_admin() or public.reports_to_me(a.profile_id))
    and (a.status = 'submitted' or a.decided_at > now() - interval '30 days')
  order by a.status = 'submitted' desc, a.submitted_at
$$;

revoke execute on function public.submit_week(date), public.withdraw_week(date), public.decide_week(uuid, date, public.approval_status, text), public.approvals_queue() from anon;
grant execute on function public.submit_week(date), public.withdraw_week(date), public.decide_week(uuid, date, public.approval_status, text), public.approvals_queue() to authenticated;
