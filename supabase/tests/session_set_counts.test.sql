-- Tests for the set count of a session (session_set_counts). Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'test@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'other@example.com');
insert into public.exercises (id, user_id, name, unilateral) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Zz Count Press', false),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Zz Count Curl', true);
insert into public.sessions (id, user_id, title, started_at, ended_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'finished', '2026-01-05 10:00+00', '2026-01-05 11:00+00'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'open', '2026-01-06 10:00+00', null),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1', 'empty', '2026-01-07 10:00+00', '2026-01-07 11:00+00');
-- The press: a warm-up and three working sets (one of them deleted). The curl is left/right: two sets, four rows.
insert into public.sets (user_id, session_id, exercise_id, set_no, side, weight_kg, reps, is_warmup, deleted_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 1, null, 20, 10, true, null),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 2, null, 40, 8, false, null),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 3, null, 40, 7, false, null),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 4, null, 40, 6, false, now()),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2', 1, 'L', 12, 10, false, null),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2', 1, 'R', 12, 9, false, null),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2', 2, 'L', 12, 8, false, null),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2', 2, 'R', 12, 8, false, null),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e1', 1, null, 40, 8, false, null);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

select is((select working_sets from public.session_set_counts where session_id = '00000000-0000-0000-0000-0000000000d1'), 4,
  'two working press sets and two left/right curl sets: 4 (no warm-up, no deleted set, a pair counted once)');
select is((select count(*) from public.sets where session_id = '00000000-0000-0000-0000-0000000000d1' and deleted_at is null), 7::bigint, 'while the live rows in the table are 7 (the warm-up and both sides of each curl set are rows too)');
select is((select count(*) from public.session_set_counts where session_id = '00000000-0000-0000-0000-0000000000d2'), 0::bigint, 'an open session has no count yet');
select is((select count(*) from public.session_set_counts where session_id = '00000000-0000-0000-0000-0000000000d3'), 0::bigint, 'a session with no sets has no row');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select is((select count(*) from public.session_set_counts), 0::bigint, 'another user sees none of it');
reset role;
select is((select count(*) from public.session_set_counts where session_id = '00000000-0000-0000-0000-0000000000d1'), 1::bigint, 'it is one row per session');

select * from finish();
rollback;
