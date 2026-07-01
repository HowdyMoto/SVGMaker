-- Guardrails on projects.name / projects.content. RLS keeps a row private to its
-- owner, but nothing bounded how MUCH a client could store, so a runaway autosave
-- or a hostile client could stash arbitrarily large blobs. Cap them: name 1–200
-- chars, content ≤20MB (matching the editor's own large-document ceiling).
--
-- Idempotent (safe to re-run) — ADD CONSTRAINT isn't, so each is guarded and the
-- duplicate_object error swallowed, mirroring the contact_messages policy migration.

do $$ begin
  alter table public.projects
    add constraint project_name_len check (char_length(name) between 1 and 200);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.projects
    add constraint project_content_len check (char_length(content) <= 20000000);
exception when duplicate_object then null; end $$;
