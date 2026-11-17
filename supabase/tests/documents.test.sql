-- Tests for documents and claude_instructions. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- Work on a clean slate for the two names (the local database may already hold the real ones).
delete from public.documents where name in ('planning-guide', 'owner-goal', 'evidence-notes');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'test@example.com');

select is(public.claude_instructions(false), '', 'nothing published: an empty string, not an error');

insert into public.documents (user_id, name, body) values
  ('00000000-0000-0000-0000-0000000000a1', 'planning-guide', 'GUIDE v1'),
  ('00000000-0000-0000-0000-0000000000a1', 'owner-goal', 'GOAL v1');

select is(public.claude_instructions(false), 'GUIDE v1', 'without the goal: just the guide');
select is(public.claude_instructions(true), E'GOAL v1\n\n---\n\nGUIDE v1', 'with the goal: goal first, then the guide');
select is(public.claude_instructions(), 'GUIDE v1', 'the goal is not included by default');

update public.documents set body = 'GUIDE v2' where name = 'planning-guide';
select is(public.claude_instructions(true), E'GOAL v1\n\n---\n\nGUIDE v2', 'updating the body changes what Claude reads');

delete from public.documents where name = 'owner-goal';
select is(public.claude_instructions(true), 'GUIDE v2', 'a missing goal is skipped without stray separators');

select throws_ok($$insert into public.documents (user_id, name, body) values ('00000000-0000-0000-0000-0000000000a1', 'planning-guide', 'dup')$$,
                 '23505', null, 'one document per name');
-- Another user cannot see these rows (row level security).
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a2', 'other@example.com');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.documents where user_id = '00000000-0000-0000-0000-0000000000a1'), 0::bigint, 'another user sees none of your documents');
reset role;

-- The evidence notes come last, after the guide.
insert into public.documents (user_id, name, body) values ('00000000-0000-0000-0000-0000000000a1', 'evidence-notes', 'EVIDENCE');
select is(public.claude_instructions(false), E'GUIDE v2

---

EVIDENCE', 'evidence notes follow the guide');
insert into public.documents (user_id, name, body) values ('00000000-0000-0000-0000-0000000000a1', 'owner-goal', 'GOAL v2');
select is(public.claude_instructions(true), E'GOAL v2

---

GUIDE v2

---

EVIDENCE', 'goal, guide, then evidence');
delete from public.documents where name = 'planning-guide';
select is(public.claude_instructions(false), 'EVIDENCE', 'a missing guide is skipped without stray separators');

select * from finish();
rollback;
