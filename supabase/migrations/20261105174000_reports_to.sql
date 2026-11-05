-- manager_id on profiles/invites; managers see direct reports; see live DB for full function bodies (applied via MCP)
alter table public.profiles add column if not exists manager_id uuid references public.profiles(id) on delete set null;
create index if not exists profiles_manager_idx on public.profiles (manager_id);
alter table public.invites add column if not exists manager_id uuid references public.profiles(id) on delete set null;
