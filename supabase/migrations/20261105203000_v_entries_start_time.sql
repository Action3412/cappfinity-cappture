-- Reports drill-down shows a person's week on the clock, so the view needs start_time
drop view public.v_entries;
create view public.v_entries with (security_invoker = on) as
select e.id, e.entry_date, public.week_start(e.entry_date) as week_start, e.hours, e.minutes, e.start_time, e.note, e.source, e.created_at, e.updated_at,
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
