-- claude_instructions() now also returns the 'evidence-notes' document (short, verified research summaries and
-- how to cite them), after the guide. The signature is unchanged, so nothing that calls it needs to change.
-- Order: owner-goal (optional), planning-guide, evidence-notes. Missing documents are skipped.

create or replace function public.claude_instructions(p_include_goal boolean default false) returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(concat_ws(E'\n\n---\n\n',
    case when p_include_goal
         then (select d.body from public.documents d where d.name = 'owner-goal' order by d.updated_at desc limit 1) end,
    (select d.body from public.documents d where d.name = 'planning-guide' order by d.updated_at desc limit 1),
    (select d.body from public.documents d where d.name = 'evidence-notes' order by d.updated_at desc limit 1)
  ), '')
$$;

comment on function public.claude_instructions(boolean) is
  'The owner''s standing instructions for planning: the owner-goal document (only when p_include_goal is true), then the planning-guide, then the evidence-notes. Missing documents are skipped; returns an empty string if none is published.';
