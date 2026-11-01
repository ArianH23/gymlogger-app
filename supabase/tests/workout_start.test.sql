-- Tests for workout_start (what a client needs to start a workout). Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'test@example.com');
insert into public.exercises (id, user_id, name, rep_min, rep_max, unilateral, dumbbell_pair, load_type, increment_kg) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Zz Start Press', 6, 10, false, true, 'weighted', 4),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Zz Start Raise', 12, 20, true, false, 'weighted', null);
insert into public.routines (id, user_id, name) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Zz Start Routine');
insert into public.routine_exercises (user_id, routine_id, exercise_id, position, target_sets) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e2', 2, 2),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 1, 3);

create function pg_temp.ws() returns jsonb language sql as $$ select public.workout_start('00000000-0000-0000-0000-0000000000b1') $$;

select throws_ilike($$select public.workout_start('00000000-0000-0000-0000-00000000dead')$$, '%not found%', 'unknown routine raises');

-- No plan yet: the routine's own exercises in position order, usual number of sets, no targets.
select is(pg_temp.ws() -> 'exercises' -> 0 ->> 'name', 'Zz Start Press', 'no plan: exercises in routine position order');
select is(jsonb_array_length(pg_temp.ws() -> 'exercises' -> 0 -> 'sets'), 3, 'no plan: the routine''s number of sets');
select is(pg_temp.ws() -> 'exercises' -> 0 -> 'sets' -> 0 -> 'target_weight_kg', 'null'::jsonb, 'no plan: no targets');
select is(pg_temp.ws() ->> 'plan_by', null, 'no plan: plan_by is null');

-- A finished session gives "last time".
insert into public.sessions (id, user_id, routine_id, title, started_at, ended_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 's', '2026-01-05 10:00+00', '2026-01-05 11:00+00');
insert into public.sets (user_id, session_id, exercise_id, set_no, side, weight_kg, reps) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 1, null, 40, 8),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2', 1, 'L', 7.5, 12),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2', 1, 'R', 7.5, 10);
select is(pg_temp.ws() -> 'exercises' -> 0 -> 'last' -> 0 ->> 'reps_result', '8', 'last time is included');
select is(pg_temp.ws() -> 'exercises' -> 1 -> 'last' -> 0 ->> 'reps_l', '12', 'left/right: both sides in last time');
select is(pg_temp.ws() -> 'exercises' -> 1 -> 'last' -> 0 ->> 'reps_result', '10', 'left/right: the lower side is the result');

select is((pg_temp.ws() -> 'exercises' -> 0 ->> 'increment_kg')::numeric, 4::numeric, 'the exercise''s increment_kg is included');
select is(pg_temp.ws() -> 'exercises' -> 1 -> 'increment_kg', 'null'::jsonb, 'no increment set: null');

-- A rules plan, then a claude plan.
insert into public.planned_sessions (id, user_id, routine_id, created_by, status, notes) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'rules', 'pending', 'auto note');
insert into public.planned_sets (user_id, planned_session_id, exercise_id, exercise_position, set_no, target_weight_kg, target_reps_min, target_reps_max) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 1, 1, 44, 7, 10),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e2', 2, 1, 7.5, 12, 20);
select is(pg_temp.ws() ->> 'plan_by', 'rules', 'rules plan: reported');
select is(pg_temp.ws() ->> 'plan_notes', null, 'rules plan: its internal note is not exposed');

insert into public.planned_sessions (id, user_id, routine_id, created_by, status, notes) values
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'claude', 'pending', 'claude says hi');
insert into public.planned_sets (user_id, planned_session_id, exercise_id, exercise_position, set_no, target_weight_kg, target_reps_min, target_reps_max, note) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e1', 1, 1, 48, 6, 8, 'push it'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e1', 1, 2, 44, 6, 8, null);
select is((pg_temp.ws() -> 'exercises' -> 0 -> 'sets' -> 0 ->> 'target_weight_kg')::numeric, 48::numeric, 'claude plan wins, with its note on the set');

select * from finish();
rollback;
