alter table public.time_entries add column if not exists start_time time;
with ordered as (
  select id,
         sum(hours) over (partition by profile_id, entry_date order by sort_order, created_at rows between unbounded preceding and 1 preceding) as before_h
  from public.time_entries where start_time is null
)
update public.time_entries t
set start_time = (time '09:00' + make_interval(mins => (coalesce(o.before_h, 0) * 60)::int))
from ordered o where o.id = t.id;
insert into public.settings (key, value) values ('day_start', '"09:00"'), ('day_end', '"17:30"') on conflict (key) do nothing;
-- repeat_last_week now copies start_time (see live function)
