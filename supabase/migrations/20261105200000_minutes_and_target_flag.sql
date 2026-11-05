-- 1. Minutes become the source of truth. hours is kept as a generated column so every
--    view, report and RPC that reads hours keeps working, but nothing can drift.
-- 2. Projects get counts_toward_target. Lunch and Break are logged for the record but do
--    not count towards the 37.5h week.

-- ---------- 1. minutes ----------
alter table public.time_entries add column if not exists minutes int;
update public.time_entries set minutes = round(hours * 60)::int where minutes is null;
alter table public.time_entries
  alter column minutes set not null,
  add constraint time_entries_minutes_check check (minutes > 0 and minutes <= 1440);

drop view if exists public.v_entries;
drop view if exists public.v_project_totals;

alter table public.time_entries drop column hours;
alter table public.time_entries add column hours numeric(7,3) generated always as (minutes / 60.0) stored;

-- ---------- 2. counts_toward_target ----------
alter table public.projects add column if not exists counts_toward_target boolean not null default true;
update public.projects set counts_toward_target = false where code in ('INT-B', 'INT-L');

-- ---------- views ----------
create view public.v_entries with (security_invoker = on) as
select e.id, e.entry_date, public.week_start(e.entry_date) as week_start, e.hours, e.minutes, e.note, e.source, e.created_at, e.updated_at,
       e.profile_id, pr.full_name as person, pr.email, pr.team_id, t.name as team,
       e.project_id, p.name as project, p.code as project_code, p.billable, p.budget_hours, p.counts_toward_target,
       coalesce(p.colour, c.colour) as colour, p.client_id, c.name as client, c.is_internal,
       e.work_type_id, w.name as work_type
from public.time_entries e
join public.profiles pr on pr.id = e.profile_id
left join public.teams t on t.id = pr.team_id
join public.projects p on p.id = e.project_id
join public.clients c on c.id = p.client_id
left join public.work_types w on w.id = e.work_type_id;

create view public.v_project_totals with (security_invoker = on) as
select p.id as project_id, p.name as project, p.code, p.status, p.billable, p.budget_hours, coalesce(p.colour, c.colour) as colour,
       c.id as client_id, c.name as client, c.is_internal,
       coalesce(sum(e.hours), 0) as logged_hours, count(distinct e.profile_id) as people
from public.projects p
join public.clients c on c.id = p.client_id
left join public.time_entries e on e.project_id = p.id
group by p.id, c.id;

-- ---------- functions that write hours ----------
create or replace function public.split_entry(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e public.time_entries%rowtype; v_half int; v_rest int; v_new uuid;
begin
  select * into e from public.time_entries where id = p_id and profile_id = auth.uid();
  if not found then raise exception 'Not your entry'; end if;
  v_half := greatest(15, (e.minutes / 2 / 15) * 15);
  v_rest := e.minutes - v_half;
  if v_rest < 15 then raise exception 'Too short to split'; end if;
  update public.time_entries set minutes = v_half where id = e.id;
  insert into public.time_entries (profile_id, project_id, work_type_id, entry_date, minutes, note, source, start_time)
  values (e.profile_id, e.project_id, null, e.entry_date, v_rest, null, 'manual', e.start_time + make_interval(mins => v_half))
  returning id into v_new;
  return v_new;
end $$;

create or replace function public.repeat_last_week(p_week_start date)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_monday date := public.week_start(p_week_start);
begin
  if not public.is_active_user() then raise exception 'Not permitted'; end if;
  insert into public.time_entries (profile_id, project_id, work_type_id, entry_date, minutes, note, source, sort_order, start_time)
  select e.profile_id, e.project_id, e.work_type_id, e.entry_date + 7, e.minutes, null, 'copied', e.sort_order, e.start_time
  from public.time_entries e
  join public.projects p on p.id = e.project_id and p.status = 'active'
  where e.profile_id = auth.uid()
    and e.entry_date >= v_monday - 7
    and e.entry_date <  v_monday
    and not exists (
      select 1 from public.time_entries x
      where x.profile_id = e.profile_id and x.project_id = e.project_id
        and x.entry_date = e.entry_date + 7 and x.start_time = e.start_time
    );
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Shortfalls only count projects that count towards the target
create or replace function public.week_shortfalls(p_week_start date)
returns table (profile_id uuid, person text, email text, team text, weekly_target numeric, logged_hours numeric, shortfall numeric, reminded_at timestamptz)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.full_name, pr.email, t.name, pr.weekly_target,
         coalesce(sum(e.hours), 0), pr.weekly_target - coalesce(sum(e.hours), 0),
         (select max(sent_at) from public.reminder_log r where r.profile_id = pr.id and r.week_start = p_week_start)
  from public.profiles pr
  left join public.teams t on t.id = pr.team_id
  left join public.time_entries e on e.profile_id = pr.id and e.entry_date >= p_week_start and e.entry_date < p_week_start + 7
       and e.project_id in (select id from public.projects where counts_toward_target)
  where pr.active and public.is_manager_or_admin() and (public.is_admin() or pr.manager_id = auth.uid())
  group by pr.id, t.name
  having coalesce(sum(e.hours), 0) < pr.weekly_target
  order by 7 desc
$$;
