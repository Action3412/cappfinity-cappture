-- repeat_last_week: snap any date to its Monday, and only skip a block when the exact same
-- block (project + day + start time) already exists, so a week with one block on a project
-- can still receive the rest.
create or replace function public.repeat_last_week(p_week_start date)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_count int;
  v_monday date := public.week_start(p_week_start);
begin
  if not public.is_active_user() then raise exception 'Not permitted'; end if;
  insert into public.time_entries (profile_id, project_id, work_type_id, entry_date, hours, note, source, sort_order, start_time)
  select e.profile_id, e.project_id, e.work_type_id, e.entry_date + 7, e.hours, null, 'copied', e.sort_order, e.start_time
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
