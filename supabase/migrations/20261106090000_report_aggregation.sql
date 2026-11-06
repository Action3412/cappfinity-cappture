-- Reports at scale: the browser no longer pulls raw entries for the page. One call returns
-- everything the widgets need, already grouped, with the filters applied here and the same
-- visibility rules as the rest of the app (admins see everyone, managers see their reports).

create index if not exists time_entries_project_date_idx on public.time_entries (project_id, entry_date);
create index if not exists time_entries_date_profile_idx on public.time_entries (entry_date, profile_id);

-- The filtered, visible rows for a report. Everything else builds on this.
create or replace function public.report_rows(
  p_from date, p_to date,
  p_client uuid default null, p_team uuid default null, p_person uuid default null, p_work_type uuid default null
)
returns table (
  entry_id uuid, entry_date date, dow int, hours numeric, billable boolean, counts boolean,
  profile_id uuid, person text, email text, team_id uuid, team text,
  project_id uuid, project text, project_code text, colour text, budget_hours numeric,
  client_id uuid, client text, is_internal boolean,
  work_type_id uuid, work_type text
)
language sql stable security definer set search_path = public as $$
  select e.id, e.entry_date, extract(isodow from e.entry_date)::int, e.hours, p.billable, p.counts_toward_target,
         e.profile_id, pr.full_name, pr.email, pr.team_id, t.name,
         e.project_id, p.name, p.code, coalesce(p.colour, c.colour), p.budget_hours,
         c.id, c.name, c.is_internal,
         e.work_type_id, w.name
  from public.time_entries e
  join public.profiles pr on pr.id = e.profile_id
  left join public.teams t on t.id = pr.team_id
  join public.projects p on p.id = e.project_id
  join public.clients c on c.id = p.client_id
  left join public.work_types w on w.id = e.work_type_id
  where public.is_manager_or_admin()
    and (public.is_admin() or e.profile_id = auth.uid() or pr.manager_id = auth.uid())
    and e.entry_date between p_from and p_to
    and (p_client is null or c.id = p_client)
    and (p_team is null or pr.team_id = p_team)
    and (p_person is null or e.profile_id = p_person)
    and (p_work_type is null or e.work_type_id = p_work_type)
$$;

create or replace function public.report_summary(
  p_from date, p_to date,
  p_client uuid default null, p_team uuid default null, p_person uuid default null, p_work_type uuid default null
)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_manager_or_admin() then raise exception 'Not permitted'; end if;
  with base as (select * from public.report_rows(p_from, p_to, p_client, p_team, p_person, p_work_type)),
  scope as (
    select count(*) as entries, count(distinct profile_id) as people,
           coalesce(sum(hours), 0) as hours, coalesce(sum(hours) filter (where billable), 0) as billable,
           min(entry_date) as first_day, max(entry_date) as last_day
    from base
  ),
  by_day as (
    select entry_date as d,
           coalesce(sum(hours) filter (where billable and counts), 0) as billable,
           coalesce(sum(hours) filter (where not billable and counts), 0) as internal,
           coalesce(sum(hours) filter (where not counts), 0) as not_counted
    from base group by entry_date order by entry_date
  ),
  by_wt as (
    select work_type_id as id, coalesce(work_type, 'Uncategorised') as name, sum(hours) as hours
    from base group by work_type_id, work_type order by 3 desc
  ),
  by_client as (
    select client_id as id, client as name, is_internal, sum(hours) as hours
    from base group by client_id, client, is_internal order by 4 desc
  ),
  by_person as (
    select profile_id as id, person as name, email, team_id, team, count(*) as entries,
           sum(hours) as hours, sum(hours) filter (where billable) as billable,
           array[ sum(hours) filter (where dow = 1), sum(hours) filter (where dow = 2), sum(hours) filter (where dow = 3),
                  sum(hours) filter (where dow = 4), sum(hours) filter (where dow = 5) ] as dow
    from base group by profile_id, person, email, team_id, team order by 7 desc
  ),
  by_team as (
    select team_id as id, coalesce(team, 'No team') as name, count(distinct profile_id) as people,
           sum(hours) as hours, sum(hours) filter (where billable) as billable,
           array[ sum(hours) filter (where dow = 1), sum(hours) filter (where dow = 2), sum(hours) filter (where dow = 3),
                  sum(hours) filter (where dow = 4), sum(hours) filter (where dow = 5) ] as dow
    from base group by team_id, team order by 4 desc
  ),
  projects as (
    select b.project_id, b.project as name, b.project_code as code, b.colour, b.budget_hours as budget, b.billable,
           b.client_id, b.client, b.is_internal,
           sum(b.hours) as logged, count(distinct b.profile_id) as people,
           (select coalesce(sum(x.hours), 0) from public.time_entries x where x.project_id = b.project_id) as all_time
    from base b
    group by b.project_id, b.project, b.project_code, b.colour, b.budget_hours, b.billable, b.client_id, b.client, b.is_internal
    order by b.is_internal, 10 desc
  )
  select jsonb_build_object(
    'scope', (select to_jsonb(s) from scope s),
    'by_day', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from by_day x),
    'by_work_type', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from by_wt x),
    'by_client', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from by_client x),
    'by_person', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from by_person x),
    'by_team', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from by_team x),
    'projects', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from projects x),
    -- Each option list is built with the OTHER filters applied, so the dropdowns never conflict
    'options', jsonb_build_object(
      'clients', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from (select distinct client_id as id, client as name from public.report_rows(p_from, p_to, null, p_team, p_person, p_work_type)) q),
      'teams', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from (select distinct team_id as id, team as name from public.report_rows(p_from, p_to, p_client, null, p_person, p_work_type) where team_id is not null) q),
      'people', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'team', team) order by name), '[]') from (select distinct profile_id as id, coalesce(person, email) as name, team from public.report_rows(p_from, p_to, p_client, p_team, null, p_work_type)) q),
      'work_types', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from (select distinct work_type_id as id, work_type as name from public.report_rows(p_from, p_to, p_client, p_team, p_person, null) where work_type_id is not null) q)
    )
  ) into r;
  return r;
end $$;

-- One project opened up: each person's hours split by work type, within the same filters
create or replace function public.report_project_people(
  p_project uuid, p_from date, p_to date,
  p_team uuid default null, p_person uuid default null, p_work_type uuid default null
)
returns table (profile_id uuid, person text, team text, work_type text, hours numeric)
language sql stable security definer set search_path = public as $$
  select b.profile_id, coalesce(b.person, b.email), coalesce(b.team, '—'), coalesce(b.work_type, 'Uncategorised'), sum(b.hours)
  from public.report_rows(p_from, p_to, null, p_team, p_person, p_work_type) b
  where b.project_id = p_project
  group by 1, 2, 3, 4
  order by 2, 4
$$;

-- Summary export: hours by person, client, project and work type. Small however long the period.
create or replace function public.report_export_summary(
  p_from date, p_to date,
  p_client uuid default null, p_team uuid default null, p_person uuid default null, p_work_type uuid default null
)
returns table (person text, email text, team text, client text, project text, project_code text, billable boolean, work_type text, hours numeric, entries bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(b.person, b.email), b.email, coalesce(b.team, ''), b.client, b.project, b.project_code, b.billable, coalesce(b.work_type, 'Uncategorised'),
         sum(b.hours), count(*)
  from public.report_rows(p_from, p_to, p_client, p_team, p_person, p_work_type) b
  group by 1, 2, 3, 4, 5, 6, 7, 8
  order by 4, 5, 1, 8
$$;

revoke execute on function public.report_rows(date, date, uuid, uuid, uuid, uuid), public.report_summary(date, date, uuid, uuid, uuid, uuid),
  public.report_project_people(uuid, date, date, uuid, uuid, uuid), public.report_export_summary(date, date, uuid, uuid, uuid, uuid) from anon;
grant execute on function public.report_rows(date, date, uuid, uuid, uuid, uuid), public.report_summary(date, date, uuid, uuid, uuid, uuid),
  public.report_project_people(uuid, date, date, uuid, uuid, uuid), public.report_export_summary(date, date, uuid, uuid, uuid, uuid) to authenticated;
