alter table public.time_entries add column if not exists sort_order int not null default 0;
create index if not exists time_entries_day_order_idx on public.time_entries (profile_id, entry_date, sort_order);
