-- Cappture — initial schema
-- Time capture against client projects, with roles, allocations and reporting views.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('member', 'manager', 'admin');
create type public.project_status as enum ('active', 'archived');
create type public.entry_source as enum ('manual', 'calendar', 'copied');
create type public.suggestion_status as enum ('pending', 'accepted', 'dismissed');

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  email               text not null unique,
  full_name           text,
  team_id             uuid references public.teams (id) on delete set null,
  role                public.app_role not null default 'member',
  weekly_target       numeric(4,2) not null default 37.5,
  calendar_connected  boolean not null default false,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  team_id     uuid references public.teams (id) on delete set null,
  role        public.app_role not null default 'member',
  invited_by  uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

create table public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  colour      text not null default '#487BFA',
  is_internal boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);

create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete restrict,
  name          text not null,
  code          text not null unique,
  colour        text,
  budget_hours  numeric(8,2) not null default 0 check (budget_hours >= 0),
  billable      boolean not null default true,
  status        public.project_status not null default 'active',
  start_date    date,
  end_date      date,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index projects_client_idx on public.projects (client_id);

-- Who is expected to work on a project, and how many hours they have been given.
create table public.allocations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  hours       numeric(8,2) not null default 0 check (hours >= 0),
  created_at  timestamptz not null default now(),
  unique (project_id, profile_id)
);
create index allocations_profile_idx on public.allocations (profile_id);

create table public.work_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  colour      text not null default '#9275FA',
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.time_entries (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  project_id    uuid not null references public.projects (id) on delete restrict,
  work_type_id  uuid references public.work_types (id) on delete set null,
  entry_date    date not null,
  hours         numeric(5,2) not null check (hours > 0 and hours <= 24),
  note          text,
  source        public.entry_source not null default 'manual',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index time_entries_profile_date_idx on public.time_entries (profile_id, entry_date);
create index time_entries_project_idx on public.time_entries (project_id);
create index time_entries_date_idx on public.time_entries (entry_date);

-- Outlook meetings matched to a project, waiting for the person to accept or dismiss.
create table public.calendar_suggestions (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references public.profiles (id) on delete cascade,
  external_id         text not null,
  title               text not null,
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  hours               numeric(5,2) not null,
  matched_project_id  uuid references public.projects (id) on delete set null,
  status              public.suggestion_status not null default 'pending',
  created_at          timestamptz not null default now(),
  unique (profile_id, external_id)
);

create table public.settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

create table public.reminder_log (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  week_start  date not null,
  kind        text not null,            -- 'friday_nudge' | 'monday_chase' | 'manual'
  sent_at     timestamptz not null default now(),
  sent_by     uuid references public.profiles (id) on delete set null
);
create index reminder_log_week_idx on public.reminder_log (week_start, profile_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
create trigger time_entries_updated_at before update on public.time_entries
  for each row execute function public.set_updated_at();

-- Role lookups used by policies. SECURITY DEFINER so they can read profiles
-- without recursing through the profiles policies themselves.
create or replace function public.app_role_of(p_uid uuid)
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = p_uid and active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role_of(auth.uid()) = 'admin', false)
$$;

create or replace function public.is_manager_or_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.app_role_of(auth.uid()) in ('manager', 'admin'), false)
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

create or replace function public.my_team_id()
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = auth.uid()
$$;

-- Monday of the week containing a date.
create or replace function public.week_start(d date)
returns date language sql immutable as $$
  select (d - ((extract(isodow from d)::int) - 1))::date
$$;

-- ---------------------------------------------------------------------------
-- New sign-ups become profiles. First person in is the admin; invited people
-- get the role and team on their invite; anyone else from an allowed domain
-- comes in as a member; everyone else is created inactive for an admin to approve.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_invite   public.invites%rowtype;
  v_role     public.app_role := 'member';
  v_team     uuid;
  v_active   boolean := false;
  v_domains  jsonb;
  v_domain   text;
  v_name     text;
begin
  v_name := coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));

  if not exists (select 1 from public.profiles) then
    v_role := 'admin'; v_active := true;
  else
    select * into v_invite from public.invites where lower(email) = lower(new.email) and accepted_at is null;
    if found then
      v_role := v_invite.role; v_team := v_invite.team_id; v_active := true;
      update public.invites set accepted_at = now() where id = v_invite.id;
    else
      select value into v_domains from public.settings where key = 'allowed_email_domains';
      v_domain := lower(split_part(new.email, '@', 2));
      if v_domains is not null and v_domains ? v_domain then
        v_active := true;
      end if;
    end if;
  end if;

  insert into public.profiles (id, email, full_name, team_id, role, active)
  values (new.id, new.email, v_name, v_team, v_role, v_active);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Members may edit their own name; only admins may change role, team, target or active.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    if new.role is distinct from old.role
       or new.team_id is distinct from old.team_id
       or new.active is distinct from old.active
       or new.weekly_target is distinct from old.weekly_target
       or new.email is distinct from old.email then
      raise exception 'Only an admin can change role, team, target or status';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.clients enable row level security;
alter table public.projects enable row level security;
alter table public.allocations enable row level security;
alter table public.work_types enable row level security;
alter table public.time_entries enable row level security;
alter table public.calendar_suggestions enable row level security;
alter table public.settings enable row level security;
alter table public.reminder_log enable row level security;

-- Reference data: every active user can read, admins write.
create policy "teams read"        on public.teams      for select to authenticated using (public.is_active_user());
create policy "teams admin"       on public.teams      for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "clients read"      on public.clients    for select to authenticated using (public.is_active_user());
create policy "clients admin"     on public.clients    for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "projects read"     on public.projects   for select to authenticated using (public.is_active_user());
create policy "projects admin"    on public.projects   for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "work types read"   on public.work_types for select to authenticated using (public.is_active_user());
create policy "work types admin"  on public.work_types for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "settings read"     on public.settings   for select to authenticated using (public.is_active_user());
create policy "settings admin"    on public.settings   for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "allocations read"  on public.allocations for select to authenticated using (public.is_active_user());
create policy "allocations admin" on public.allocations for all    to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "invites admin"     on public.invites    for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- Profiles: everyone can see who is in the system (names for reports); you can
-- edit your own row (guarded above); admins can do anything.
create policy "profiles read"     on public.profiles for select to authenticated using (public.is_active_user() or id = auth.uid());
create policy "profiles self"     on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles admin"    on public.profiles for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- Time entries: own rows always; managers see their team; admins see all.
create policy "entries own"       on public.time_entries for all to authenticated
  using (profile_id = auth.uid() and public.is_active_user())
  with check (profile_id = auth.uid() and public.is_active_user());
create policy "entries team"      on public.time_entries for select to authenticated
  using (public.is_manager_or_admin() and exists (
    select 1 from public.profiles p where p.id = time_entries.profile_id and p.team_id = public.my_team_id()));
create policy "entries admin"     on public.time_entries for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "suggestions own"   on public.calendar_suggestions for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

create policy "reminders read"    on public.reminder_log for select to authenticated
  using (profile_id = auth.uid() or public.is_manager_or_admin());
create policy "reminders write"   on public.reminder_log for insert to authenticated
  with check (public.is_manager_or_admin());

-- ---------------------------------------------------------------------------
-- Reporting views (security_invoker so RLS on the base tables still applies)
-- ---------------------------------------------------------------------------
create or replace view public.v_entries
with (security_invoker = true) as
select
  e.id, e.entry_date, public.week_start(e.entry_date) as week_start,
  e.hours, e.note, e.source, e.created_at, e.updated_at,
  e.profile_id, pr.full_name as person, pr.email,
  pr.team_id, t.name as team,
  e.project_id, p.name as project, p.code as project_code, p.billable, p.budget_hours,
  coalesce(p.colour, c.colour) as colour,
  p.client_id, c.name as client, c.is_internal,
  e.work_type_id, w.name as work_type
from public.time_entries e
join public.profiles pr on pr.id = e.profile_id
left join public.teams t on t.id = pr.team_id
join public.projects p on p.id = e.project_id
join public.clients c on c.id = p.client_id
left join public.work_types w on w.id = e.work_type_id;

create or replace view public.v_project_totals
with (security_invoker = true) as
select
  p.id as project_id, p.name as project, p.code, p.status, p.billable, p.budget_hours,
  coalesce(p.colour, c.colour) as colour,
  c.id as client_id, c.name as client, c.is_internal,
  coalesce(sum(e.hours), 0) as logged_hours,
  count(distinct e.profile_id) as people
from public.projects p
join public.clients c on c.id = p.client_id
left join public.time_entries e on e.project_id = p.id
group by p.id, c.id;

create or replace view public.v_week_totals
with (security_invoker = true) as
select
  pr.id as profile_id, pr.full_name as person, pr.email, pr.team_id, t.name as team, pr.weekly_target,
  w.week_start,
  coalesce(sum(e.hours), 0) as logged_hours
from public.profiles pr
left join public.teams t on t.id = pr.team_id
cross join lateral (
  select distinct public.week_start(entry_date) as week_start from public.time_entries where profile_id = pr.id
) w
left join public.time_entries e on e.profile_id = pr.id and public.week_start(e.entry_date) = w.week_start
where pr.active
group by pr.id, t.name, w.week_start;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Copy the previous week's entries into the given week for the current user.
create or replace function public.repeat_last_week(p_week_start date)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if not public.is_active_user() then raise exception 'Not permitted'; end if;
  insert into public.time_entries (profile_id, project_id, work_type_id, entry_date, hours, note, source)
  select e.profile_id, e.project_id, e.work_type_id, e.entry_date + 7, e.hours, null, 'copied'
  from public.time_entries e
  join public.projects p on p.id = e.project_id and p.status = 'active'
  where e.profile_id = auth.uid()
    and e.entry_date >= p_week_start - 7
    and e.entry_date <  p_week_start
    and not exists (
      select 1 from public.time_entries x
      where x.profile_id = e.profile_id and x.project_id = e.project_id and x.entry_date = e.entry_date + 7
    );
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Who is short of their weekly target for a given week (managers: own team; admins: everyone).
create or replace function public.week_shortfalls(p_week_start date)
returns table (profile_id uuid, person text, email text, team text, weekly_target numeric, logged_hours numeric, shortfall numeric, reminded_at timestamptz)
language sql stable security definer set search_path = public as $$
  select pr.id, pr.full_name, pr.email, t.name, pr.weekly_target,
         coalesce(sum(e.hours), 0) as logged_hours,
         pr.weekly_target - coalesce(sum(e.hours), 0) as shortfall,
         (select max(sent_at) from public.reminder_log r where r.profile_id = pr.id and r.week_start = p_week_start) as reminded_at
  from public.profiles pr
  left join public.teams t on t.id = pr.team_id
  left join public.time_entries e on e.profile_id = pr.id
        and e.entry_date >= p_week_start and e.entry_date < p_week_start + 7
  where pr.active
    and public.is_manager_or_admin()
    and (public.is_admin() or pr.team_id = public.my_team_id())
  group by pr.id, t.name
  having coalesce(sum(e.hours), 0) < pr.weekly_target
  order by shortfall desc
$$;

-- ---------------------------------------------------------------------------
-- Seed: teams, work types, internal projects, settings
-- ---------------------------------------------------------------------------
insert into public.teams (name) values
  ('Solutions'), ('Psychology'), ('Delivery'), ('Creative'), ('Client Success'), ('Technology'), ('Leadership');

insert into public.work_types (name, colour, sort_order) values
  ('Analysis', '#487BFA', 1),
  ('QA', '#9275FA', 2),
  ('Creative', '#FB6CF5', 3),
  ('Delivery', '#FDB601', 4),
  ('Client meeting', '#262626', 5),
  ('Project management', '#8A8A94', 6);

insert into public.clients (name, colour, is_internal) values ('Internal', '#6B6B76', true);

insert into public.projects (client_id, name, code, budget_hours, billable)
select c.id, v.name, v.code, 0, false
from public.clients c, (values
  ('Pitches & proposals', 'INT-PITCH'),
  ('Brand & marketing',   'INT-BRAND'),
  ('Admin & meetings',    'INT-ADMIN'),
  ('Learning & development', 'INT-LEARN'),
  ('Leave / sick',        'INT-LEAVE')
) as v(name, code)
where c.name = 'Internal';

insert into public.settings (key, value) values
  ('weekly_target_hours',    '37.5'),
  ('day_hours',              '7.5'),
  ('duration_chunks',        '[{"label":"30m","hours":0.5},{"label":"1h","hours":1},{"label":"2h","hours":2},{"label":"½ day","hours":3.75},{"label":"Full day","hours":7.5}]'),
  ('allowed_email_domains',  '["cappfinity.com"]'),
  ('friday_nudge_time',      '"15:00"'),
  ('monday_chase_time',      '"09:00"'),
  ('cc_manager_on_chase',    'true'),
  ('require_approval',       'false');
