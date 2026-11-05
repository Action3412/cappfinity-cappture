alter table public.time_entries add column if not exists start_time time;
with ordered as (
  select id, sum(hours) over (partition by profile_id, entry_date order by sort_order, created_at rows between unbounded preceding and 1 preceding) as before_h
  from public.time_entries where start_time is null
)
update public.time_entries t set start_time = (time '09:00' + make_interval(mins => (coalesce(o.before_h, 0) * 60)::int)) from ordered o where o.id = t.id;
insert into public.settings (key, value) values ('day_start', '"09:00"'), ('day_end', '"17:30"') on conflict (key) do nothing;

create or replace function public.repeat_last_week(p_week_start date)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not public.is_active_user() then raise exception 'Not permitted'; end if;
  insert into public.time_entries (profile_id, project_id, work_type_id, entry_date, hours, note, source, sort_order, start_time)
  select e.profile_id, e.project_id, e.work_type_id, e.entry_date + 7, e.hours, null, 'copied', e.sort_order, e.start_time
  from public.time_entries e
  join public.projects p on p.id = e.project_id and p.status = 'active'
  where e.profile_id = auth.uid() and e.entry_date >= p_week_start - 7 and e.entry_date < p_week_start
    and not exists (select 1 from public.time_entries x where x.profile_id = e.profile_id and x.project_id = e.project_id and x.entry_date = e.entry_date + 7);
  get diagnostics v_count = row_count;
  return v_count;
end $$;
