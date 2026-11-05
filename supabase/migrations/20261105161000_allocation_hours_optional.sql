alter table public.allocations alter column hours drop not null;
alter table public.allocations alter column hours drop default;
alter table public.allocations drop constraint if exists allocations_hours_check;
alter table public.allocations add constraint allocations_hours_check check (hours is null or hours > 0);
update public.allocations set hours = null where hours = 0;
