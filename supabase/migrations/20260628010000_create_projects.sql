-- Cloud-saved SVGMaker documents — one row per saved project.
-- Each document is stored as the serialized SVG string from serializeDocumentSVG()
-- (editor state lives in an embedded <metadata> block), so loading a project is
-- just loadDocumentSVG(content). No separate JSON schema needed.

create table if not exists public.projects (
  id          uuid        primary key default gen_random_uuid(),
  -- Defaults to the caller's auth uid so the client never has to set it; RLS
  -- (below) still enforces that it matches the signed-in user.
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  name        text        not null default 'Untitled',
  content     text        not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- List a user's documents by recency without touching the (large) content column.
create index if not exists projects_user_updated_idx
  on public.projects (user_id, updated_at desc);

-- Keep updated_at fresh on every write (drives the "last edited" sort + autosave UI).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- Row-Level Security: every row is private to its owner.
alter table public.projects enable row level security;

create policy "Select own projects" on public.projects
  for select to authenticated using (auth.uid() = user_id);

create policy "Insert own projects" on public.projects
  for insert to authenticated with check (auth.uid() = user_id);

create policy "Update own projects" on public.projects
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Delete own projects" on public.projects
  for delete to authenticated using (auth.uid() = user_id);

-- The project was created with "auto-expose new tables" OFF, so grant the Data
-- API role explicitly. `anon` is intentionally omitted — cloud projects require
-- a signed-in user; RLS does the per-row gating on top of this table-level grant.
grant select, insert, update, delete on public.projects to authenticated;
