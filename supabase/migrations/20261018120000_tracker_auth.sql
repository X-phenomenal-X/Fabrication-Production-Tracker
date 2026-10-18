-- Cutting tracker sign-in lock.
-- Run once in the Supabase SQL editor. Safe to run again.
-- Invited people can read the board. Editors can change it.
-- The public anon key can no longer read or write.
--
-- After this, invite each person, copy the user id from
-- Authentication → Users, and add a row. Examples are at the bottom.
-- Do not put a secret or service_role key in the tracker.

create table if not exists public.tracker_state (
  site text not null,
  part text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (site, part)
);

create table if not exists public.tracker_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('editor', 'viewer')),
  email text,
  created_at timestamptz not null default now()
);

alter table public.tracker_state enable row level security;
alter table public.tracker_members enable row level security;

revoke all on table public.tracker_state from anon, authenticated;
revoke all on table public.tracker_members from anon, authenticated;
grant select, insert, update on table public.tracker_state to authenticated;
grant select on table public.tracker_members to authenticated;

-- One lookup the row rules can call. security definer so the lookup still
-- works after members are hidden from the public, without letting the
-- browser change who is on the list.
create or replace function public.tracker_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.tracker_members where user_id = auth.uid()
$$;

revoke all on function public.tracker_role() from public, anon;
grant execute on function public.tracker_role() to authenticated;

drop policy if exists "tracker read" on public.tracker_state;
drop policy if exists "tracker insert" on public.tracker_state;
drop policy if exists "tracker update" on public.tracker_state;
drop policy if exists "members read tracker" on public.tracker_state;
drop policy if exists "editors insert tracker" on public.tracker_state;
drop policy if exists "editors update tracker" on public.tracker_state;
drop policy if exists "member reads own row" on public.tracker_members;

create policy "members read tracker"
  on public.tracker_state
  for select
  to authenticated
  using (public.tracker_role() in ('editor', 'viewer'));

create policy "editors insert tracker"
  on public.tracker_state
  for insert
  to authenticated
  with check (public.tracker_role() = 'editor');

create policy "editors update tracker"
  on public.tracker_state
  for update
  to authenticated
  using (public.tracker_role() = 'editor')
  with check (public.tracker_role() = 'editor');

create policy "member reads own row"
  on public.tracker_members
  for select
  to authenticated
  using (user_id = auth.uid());

-- After you invite someone, open Authentication → Users, copy their user id,
-- and run one of these with the real id and email:
--
-- insert into public.tracker_members (user_id, role, email)
-- values ('00000000-0000-0000-0000-000000000000', 'editor', 'lead@example.com')
-- on conflict (user_id) do update set role = excluded.role, email = excluded.email;
--
-- insert into public.tracker_members (user_id, role, email)
-- values ('00000000-0000-0000-0000-000000000000', 'viewer', 'wall@example.com')
-- on conflict (user_id) do update set role = excluded.role, email = excluded.email;
