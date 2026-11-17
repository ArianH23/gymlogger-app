-- Tests for backup exercises (what to do instead when the machine is taken). Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'test@example.com');
insert into public.exercises (id, user_id, name, rep_min, rep_max, unilateral, dumbbell_pair, load_type, increment_kg) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Zz Machine Press', 6, 10, false, false, 'weighted', 5),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Zz Dumbbell Press', 6, 10, false, true, 'weighted', 4),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', 'Zz Row', 6, 10, false, false, 'weighted', 5),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a1', 'Zz Never Done', 6, 10, false, false, 'weighted', 5);
insert into public.routines (id, user_id, name) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Zz Backup Routine');
-- the press (3 sets) has the dumbbell press as its backup; the row (2 sets) has none
insert into public.routine_exercises (user_id, routine_id, exercise_id, position, target_sets, backup_exercise_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 1, 3, '00000000-0000-0000-0000-0000000000e2'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e3', 2, 2, null);

-- An older session gives the backup its "last time": two sets, 40 kg x 9 and 36 kg x 8.
insert into public.sessions (id, user_id, title, started_at, ended_at) values
  ('00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000000a1', 'older', '2026-01-01 10:00+00', '2026-01-01 11:00+00');
insert into public.sets (user_id, session_id, exercise_id, set_no, weight_kg, reps) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000000e2', 1, 40, 9),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d0', '00000000-0000-0000-0000-0000000000e2', 2, 36, 8);

create function pg_temp.ws() returns jsonb language sql as $$ select public.workout_start('00000000-0000-0000-0000-0000000000b1') $$;
create function pg_temp.b() returns jsonb language sql as $$ select pg_temp.ws() -> 'exercises' -> 0 -> 'backup' $$;

select throws_ok($$update public.routine_exercises set backup_exercise_id = exercise_id where exercise_id = '00000000-0000-0000-0000-0000000000e3'$$, '23514', null, 'an exercise cannot be its own backup');

select is(pg_temp.b() ->> 'name', 'Zz Dumbbell Press', 'workout_start gives the backup of an exercise');
select ok((pg_temp.b() ->> 'dumbbell_pair')::boolean and (pg_temp.b() ->> 'increment_kg')::numeric = 4, 'the backup has its own exercise fields and weight step');
select is(jsonb_array_length(pg_temp.b() -> 'sets'), 3, 'the backup has as many sets as the exercise it stands in for');
select ok((pg_temp.b() -> 'sets' -> 0 ->> 'target_weight_kg')::numeric = 40 and (pg_temp.b() -> 'sets' -> 0 ->> 'target_reps_min')::integer = 9 and pg_temp.b() -> 'sets' -> 0 ->> 'note' = 'Same as last time', 'set 1 starts from last time''s set 1: its weight, the reps reached as the minimum, and the note saying so');
select is((pg_temp.b() -> 'sets' -> 2 ->> 'target_weight_kg')::numeric, 36::numeric, 'a set beyond last time''s sets starts from the last one there was');
select is(jsonb_array_length(pg_temp.b() -> 'last'), 2, 'last time is included');
select is(pg_temp.ws() -> 'exercises' -> 1 -> 'backup', 'null'::jsonb, 'an exercise without a backup: null');
select is(public.backup_exercise_plan('00000000-0000-0000-0000-0000000000e4', 2) -> 'sets' -> 0 -> 'target_weight_kg', 'null'::jsonb, 'a backup never done before has no targets');

select is((select count(*) from jsonb_object_keys(public.routine_backups('00000000-0000-0000-0000-0000000000b1'))), 1::bigint, 'routine_backups lists the one backup');
select is(public.routine_backups('00000000-0000-0000-0000-0000000000b1') -> '00000000-0000-0000-0000-0000000000e1' ->> 'name', 'Zz Dumbbell Press', 'keyed by the exercise it stands in for');

-- A backup that is already one of the workout's exercises is not offered.
update public.routine_exercises set backup_exercise_id = '00000000-0000-0000-0000-0000000000e1' where exercise_id = '00000000-0000-0000-0000-0000000000e3';
select is(pg_temp.ws() -> 'exercises' -> 1 -> 'backup', 'null'::jsonb, 'a backup already in the workout is not offered');
update public.routine_exercises set backup_exercise_id = null where exercise_id = '00000000-0000-0000-0000-0000000000e3';

-- A plan: press 3 sets, row 2 sets. Session d1 swaps the press for its backup and does the rows as planned.
insert into public.planned_sessions (id, user_id, routine_id, created_by, status) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'rules', 'pending');
insert into public.planned_sets (user_id, planned_session_id, exercise_id, exercise_position, set_no, target_weight_kg, target_reps_min, target_reps_max) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 1, 1, 60, 6, 10),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 1, 2, 60, 6, 10),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 1, 3, 60, 6, 10),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e3', 2, 1, 50, 6, 10),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e3', 2, 2, 50, 6, 10);
insert into public.sessions (id, user_id, routine_id, title, started_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'swapped', now() - interval '1 hour');
insert into public.sets (user_id, session_id, exercise_id, set_no, weight_kg, reps) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2', 1, 40, 9),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2', 2, 40, 8),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e3', 1, 50, 8),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e3', 2, 50, 5);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok($$select public.finish_session('00000000-0000-0000-0000-0000000000d1')$$, 'finishing the session works');
select is((select backup_exercise_id from public.session_swaps where session_id = '00000000-0000-0000-0000-0000000000d1' and exercise_id = '00000000-0000-0000-0000-0000000000e1'),
          '00000000-0000-0000-0000-0000000000e2'::uuid, 'the swap is recorded: the press was replaced by its backup');
select lives_ok($$select public.finish_session('00000000-0000-0000-0000-0000000000d1')$$, 'finishing twice is safe');
select is((select count(*) from public.session_swaps where session_id = '00000000-0000-0000-0000-0000000000d1'), 1::bigint, 'and records the swap once');
reset role;

-- The score counts the two planned rows only (one met, one below the reps): the swapped press is left out.
select is((select planned_sets from public.session_plan_performance where session_id = '00000000-0000-0000-0000-0000000000d1'), 2::bigint, 'the swapped exercise''s planned sets are left out of the score');
select is((select met_sets from public.session_plan_performance where session_id = '00000000-0000-0000-0000-0000000000d1'), 1::bigint, 'the other exercise is scored as usual');

select * from finish();
rollback;
