-- Tests for an exercise replaced by another during a workout (sessions.replaced, finish_session, sync_workout). Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'test@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'other@example.com');
insert into public.exercises (id, user_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Zz R Press'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Zz R Row'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', 'Zz R Cable Row'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 'Zz R Not Mine');
insert into public.routines (id, user_id, name) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Zz R Routine');
insert into public.routine_exercises (user_id, routine_id, exercise_id, position, target_sets) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 1, 2),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e2', 2, 2);
-- the plan: the press and the row, 2 sets each
insert into public.planned_sessions (id, user_id, routine_id, created_by, status, created_at) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'claude', 'pending', now() - interval '3 hours');
insert into public.planned_sets (user_id, planned_session_id, exercise_id, exercise_position, set_no, target_weight_kg, target_reps_min, target_reps_max) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 1, 1, 50, 8, 10),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 1, 2, 50, 8, 10),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e2', 2, 1, 40, 8, 10),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e2', 2, 2, 40, 8, 10);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

create function pg_temp.s(p_id text, p_exercise text, p_set_no integer, p_weight numeric, p_reps integer) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id::uuid, 'exercise_id', p_exercise::uuid, 'set_no', p_set_no, 'side', null, 'weight_kg', p_weight, 'reps', p_reps, 'logged_at', now() - interval '20 minutes')
$$;
create function pg_temp.finished(p_session text, p_sets jsonb, p_replaced jsonb) returns jsonb language sql as $$
  select public.sync_workout(jsonb_build_object('id', p_session::uuid, 'routine_id', '00000000-0000-0000-0000-0000000000b1', 'title', 'Zz R Routine',
    'started_at', now() - interval '1 hour', 'sets', p_sets, 'ended_at', now()) || case when p_replaced is null then '{}'::jsonb else jsonb_build_object('replaced', p_replaced) end)
$$;

-- The row (e2) was replaced by the cable row (e3); a malformed entry comes along and is dropped.
select pg_temp.finished('00000000-0000-0000-0000-0000000000d1', jsonb_build_array(
  pg_temp.s('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-0000000000e1', 1, 50, 10),
  pg_temp.s('00000000-0000-0000-0000-000000000a02', '00000000-0000-0000-0000-0000000000e1', 2, 50, 9),
  pg_temp.s('00000000-0000-0000-0000-000000000a03', '00000000-0000-0000-0000-0000000000e3', 1, 40, 12),
  pg_temp.s('00000000-0000-0000-0000-000000000a04', '00000000-0000-0000-0000-0000000000e3', 2, 40, 12)),
  jsonb_build_object('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e3', 'not-an-id', '00000000-0000-0000-0000-0000000000e3'));

select is((select replaced from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'),
          jsonb_build_object('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e3'), 'the replacement is stored, and a malformed entry is dropped');
select is((select backup_exercise_id from public.session_swaps where session_id = '00000000-0000-0000-0000-0000000000d1' and exercise_id = '00000000-0000-0000-0000-0000000000e2'),
          '00000000-0000-0000-0000-0000000000e3'::uuid, 'finishing records it like a backup swap: the row was replaced by the cable row');
select is((select count(*) from public.session_swaps where session_id = '00000000-0000-0000-0000-0000000000d1'), 1::bigint, 'and only that one');
select is((select planned_sets::text || ' ' || met_sets::text || ' ' || met_pct::text from public.session_scores where session_id = '00000000-0000-0000-0000-0000000000d1'), '2 2 100',
          'the replaced exercise is left out of the score: 2 planned sets, both met, 100% (it was 50% when counted as not done)');

-- Sending the same finished workout again changes nothing.
select pg_temp.finished('00000000-0000-0000-0000-0000000000d1', '[]', jsonb_build_object('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e3'));
select is((select count(*) from public.session_swaps where session_id = '00000000-0000-0000-0000-0000000000d1'), 1::bigint, 'sending it again adds no second swap');

-- A replacement that did not happen: the old exercise has sets logged too.
select pg_temp.finished('00000000-0000-0000-0000-0000000000d2', jsonb_build_array(
  pg_temp.s('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-0000000000e2', 1, 40, 10),
  pg_temp.s('00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-0000000000e3', 1, 40, 12)),
  jsonb_build_object('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e3'));
select is((select count(*) from public.session_swaps where session_id = '00000000-0000-0000-0000-0000000000d2'), 0::bigint, 'when sets were logged for the old exercise too, nothing is recorded as replaced');

-- Another user's exercise cannot be named as a replacement.
select pg_temp.finished('00000000-0000-0000-0000-0000000000d3', jsonb_build_array(
  pg_temp.s('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-0000000000f1', 1, 40, 12)),
  jsonb_build_object('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1'));
select is((select count(*) from public.session_swaps where session_id = '00000000-0000-0000-0000-0000000000d3'), 0::bigint, 'another user''s exercise is not recorded as a replacement');

-- A workout with no replacement is scored and recorded as before.
select pg_temp.finished('00000000-0000-0000-0000-0000000000d4', jsonb_build_array(
  pg_temp.s('00000000-0000-0000-0000-000000000d01', '00000000-0000-0000-0000-0000000000e1', 1, 50, 10)), null);
select is((select count(*) from public.session_swaps where session_id = '00000000-0000-0000-0000-0000000000d4'), 0::bigint, 'a workout with no replacement has no swap');
select is((select replaced from public.sessions where id = '00000000-0000-0000-0000-0000000000d4'), '{}'::jsonb, 'and an empty replaced map');

-- Someone else's session cannot be given replacements.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select is((select count(*) from public.sessions where replaced <> '{}'::jsonb), 0::bigint, 'another user sees none of the replacements');
reset role;

select * from finish();
rollback;
