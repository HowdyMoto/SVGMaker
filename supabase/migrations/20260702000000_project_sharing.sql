-- Cloud collaboration: public/private visibility, project categories, and
-- per-user sharing (owner grants specific BuzzQuill users viewer/editor access).
--
-- RLS note: the projects <-> project_shares policies would mutually recurse if
-- each SELECT-ed the other directly. We break that with SECURITY DEFINER helper
-- functions (is_project_owner / project_share_role) that run as the definer and
-- therefore DON'T re-trigger RLS — the standard Supabase pattern for this.
-- Idempotent throughout so it can be re-applied safely.

-- ---- projects: visibility + category -------------------------------------

alter table public.projects add column if not exists visibility text not null default 'private';
alter table public.projects add column if not exists category text;

do $$ begin
  alter table public.projects
    add constraint project_visibility_chk check (visibility in ('private', 'public'));
exception when duplicate_object then null; end $$;

-- Browse a user's boards by category, recency-first, without the content column.
create index if not exists projects_user_category_idx
  on public.projects (user_id, category, updated_at desc);
-- Public gallery listing.
create index if not exists projects_public_idx
  on public.projects (updated_at desc) where visibility = 'public';

-- ---- project_shares --------------------------------------------------------

create table if not exists public.project_shares (
  project_id    uuid        not null references public.projects (id) on delete cascade,
  grantee_id    uuid        not null references auth.users (id) on delete cascade,
  -- Denormalized for display in the Share dialog (auth.users isn't API-readable).
  grantee_email text,
  role          text        not null default 'viewer',
  created_at    timestamptz not null default now(),
  primary key (project_id, grantee_id),
  constraint share_role_chk check (role in ('viewer', 'editor'))
);
create index if not exists project_shares_grantee_idx on public.project_shares (grantee_id);

-- ---- SECURITY DEFINER helpers (break the RLS recursion) --------------------

create or replace function public.is_project_owner(pid uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.projects p where p.id = pid and p.user_id = auth.uid());
$$;

-- The caller's role on a project via a share ('viewer'|'editor'), or null.
create or replace function public.project_share_role(pid uuid)
returns text
language sql security definer stable set search_path = public as $$
  select s.role from public.project_shares s
   where s.project_id = pid and s.grantee_id = auth.uid();
$$;

-- Resolve an email to a user id so an owner can share by email. auth.users is
-- not reachable through the Data API, hence a SECURITY DEFINER RPC. Returns null
-- (not an error) when there's no such account.
create or replace function public.find_user_by_email(email_input text)
returns uuid
language sql security definer stable set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(trim(email_input)) limit 1;
$$;

-- ---- projects RLS: extend read + update for public/shared ------------------

drop policy if exists "Select own projects" on public.projects;
create policy "Read accessible projects" on public.projects
  for select to authenticated
  using (
    auth.uid() = user_id
    or visibility = 'public'
    or public.project_share_role(id) is not null
  );

-- Truly public boards are readable even when signed out (share-a-link).
drop policy if exists "Anon reads public projects" on public.projects;
create policy "Anon reads public projects" on public.projects
  for select to anon
  using (visibility = 'public');

drop policy if exists "Update own projects" on public.projects;
create policy "Update accessible projects" on public.projects
  for update to authenticated
  using (auth.uid() = user_id or public.project_share_role(id) = 'editor')
  with check (auth.uid() = user_id or public.project_share_role(id) = 'editor');

-- Insert + Delete stay owner-only (their policies from create_projects.sql remain).

-- ---- project_shares RLS ----------------------------------------------------

alter table public.project_shares enable row level security;

drop policy if exists "Read own or granted shares" on public.project_shares;
create policy "Read own or granted shares" on public.project_shares
  for select to authenticated
  using (public.is_project_owner(project_id) or grantee_id = auth.uid());

drop policy if exists "Owner inserts shares" on public.project_shares;
create policy "Owner inserts shares" on public.project_shares
  for insert to authenticated
  with check (public.is_project_owner(project_id) and grantee_id <> auth.uid());

drop policy if exists "Owner updates shares" on public.project_shares;
create policy "Owner updates shares" on public.project_shares
  for update to authenticated
  using (public.is_project_owner(project_id))
  with check (public.is_project_owner(project_id));

drop policy if exists "Owner deletes shares" on public.project_shares;
create policy "Owner deletes shares" on public.project_shares
  for delete to authenticated
  using (public.is_project_owner(project_id));

-- ---- grants ----------------------------------------------------------------

grant select on public.projects to anon; -- gated to public rows by RLS above
grant select, insert, update, delete on public.project_shares to authenticated;
revoke all on function public.find_user_by_email(text) from public, anon;
grant execute on function public.find_user_by_email(text) to authenticated;
grant execute on function public.is_project_owner(uuid) to authenticated;
grant execute on function public.project_share_role(uuid) to authenticated;
