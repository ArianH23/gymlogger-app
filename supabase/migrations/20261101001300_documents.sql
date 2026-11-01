-- documents: standing texts that Claude reads at run time (the planning guide, the owner's goal), so the
-- instructions live in ONE place instead of being pasted into the chat project and the scheduled task.
-- The texts are published with scripts/publish_guide.py; the owner's goal never goes into git.

create table public.documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, name)
);

create trigger documents_set_updated_at before update on public.documents
  for each row execute function public.set_updated_at();
alter table public.documents enable row level security;
create policy documents_own_rows on public.documents for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

comment on table public.documents is
  'Named texts Claude reads at run time: planning-guide (how to read the database and write a plan) and owner-goal (the owner''s goal and profile). Replace the body to change Claude''s instructions everywhere at once.';
comment on column public.documents.id is 'UUID.';
comment on column public.documents.user_id is 'Owner. RLS restricts every row to this user.';
comment on column public.documents.name is 'planning-guide or owner-goal. Unique per user.';
comment on column public.documents.body is 'The full text (markdown).';
comment on column public.documents.created_at is 'Row creation time (server clock).';
comment on column public.documents.updated_at is 'Last change (server clock, set by trigger).';

-- claude_instructions(): what a planning Claude should read first. With p_include_goal the owner's goal comes
-- before the guide (the scheduled task has no other context); the chat project already has its own goal text.
create function public.claude_instructions(p_include_goal boolean default false) returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(concat_ws(E'\n\n---\n\n',
    case when p_include_goal
         then (select d.body from public.documents d where d.name = 'owner-goal' order by d.updated_at desc limit 1) end,
    (select d.body from public.documents d where d.name = 'planning-guide' order by d.updated_at desc limit 1)
  ), '')
$$;

comment on function public.claude_instructions(boolean) is
  'The owner''s standing instructions for planning: the planning-guide document, preceded by the owner-goal document when p_include_goal is true. Returns an empty string if the guide has not been published.';

revoke execute on function public.claude_instructions(boolean) from public, anon;
grant  execute on function public.claude_instructions(boolean) to authenticated;
