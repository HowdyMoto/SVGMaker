-- Contact-form submissions. Anyone (signed in or not) may SEND a message; nobody
-- may read them back through the Data API. You read submissions in the Supabase
-- dashboard (Table editor / SQL), where the service role bypasses RLS — so no
-- personal email address has to live in the app or the policy text.

create table if not exists public.contact_messages (
  id          uuid        primary key default gen_random_uuid(),
  -- Set automatically for signed-in senders; null for anonymous ones.
  user_id     uuid        references auth.users (id) on delete set null default auth.uid(),
  -- Optional reply-to the sender typed in; may be null.
  email       text,
  message     text        not null,
  -- Light triage context (browser UA), optional.
  user_agent  text,
  created_at  timestamptz not null default now(),
  constraint contact_message_len check (char_length(message) between 1 and 5000),
  constraint contact_email_len   check (email is null or char_length(email) <= 320)
);

-- Recent-first triage in the dashboard.
create index if not exists contact_messages_created_idx
  on public.contact_messages (created_at desc);

alter table public.contact_messages enable row level security;

-- Insert-only, for everyone. No select/update/delete policies exist, so those are
-- denied for anon + authenticated — submissions can't be read or altered via the API.
create policy "Anyone can submit a contact message"
  on public.contact_messages
  for insert to anon, authenticated
  with check (
    (user_id is null or user_id = auth.uid())
    and char_length(message) between 1 and 5000
  );

grant insert on public.contact_messages to anon, authenticated;
