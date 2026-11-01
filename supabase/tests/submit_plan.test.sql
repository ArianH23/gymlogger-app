-- Tests for submit_plan (Claude's way of writing a plan). Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'test@example.com');
insert into public.routines (id, user_id, name, position) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Zz Test Routine', 1);
insert into public.exercises (id, user_id, name, load_type) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Bench Press (Dumbbell)', 'weighted'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Chin Up (Assisted)', 'assisted'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', 'Standing Calf Raise', 'bodyweight'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a1', 'Lateral Raise (Dumbbell)', 'weighted');
insert into public.routine_exercises (user_id, routine_id, exercise_id, position)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
        '00000000-0000-0000-0000-0000000000e1', 1);

-- A pending rules plan that submit_plan must never touch.
insert into public.planned_sessions (id, user_id, routine_id, created_by, status)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000b1', 'rules', 'pending');

create temp table result (r jsonb);
insert into result select public.submit_plan('Zz Test Routine', $json$[
  {"exercise": "Bench Press (Dumbbell)", "sets": [
     {"weight_kg": 44, "reps_min": 7, "reps_max": 10},
     {"weight_kg": 44, "reps_min": 7, "reps_max": 10},
     {"weight_kg": 40, "reps_min": 8, "reps_max": 10, "note": "back-off set"}]},
  {"exercise": "chin up (assisted)", "sets": [{"weight_kg": 45, "reps_min": 6, "reps_max": 10}]},
  {"exercise": "Standing Calf Raise", "sets": [{"reps_min": 13}]},
  {"exercise": "Lateral Raise (Dumbbell)", "sets": [{"weight_kg": 24, "reps_min": 13, "reps_max": 20}]}
]$json$::jsonb, 'Test plan');

select is((select r ->> 'sets' from result), '6', 'returns the number of sets');
select is((select count(*) from public.planned_sessions where routine_id = '00000000-0000-0000-0000-0000000000b1' and created_by = 'claude' and status = 'pending'), 1::bigint,
          'one pending claude plan');
select is((select notes from public.planned_sessions where routine_id = '00000000-0000-0000-0000-0000000000b1' and created_by = 'claude' and status = 'pending'), 'Test plan', 'notes saved');
select is((select count(*) from public.planned_sets where planned_session_id = (select (r ->> 'planned_session_id')::uuid from result)),
          6::bigint, 'all sets stored');
select is((select array_agg(distinct exercise_position order by exercise_position) from public.planned_sets
           where planned_session_id = (select (r ->> 'planned_session_id')::uuid from result)),
          array[1, 2, 3, 4], 'exercise order kept');
select is((select array_agg(target_weight_kg order by set_no) from public.planned_sets
           where exercise_id = '00000000-0000-0000-0000-0000000000e1'
             and planned_session_id = (select (r ->> 'planned_session_id')::uuid from result)),
          array[44, 44, 40]::numeric[], 'each set keeps its own weight');
select is((select note from public.planned_sets where exercise_id = '00000000-0000-0000-0000-0000000000e1' and set_no = 3),
          'back-off set', 'set note saved');
select is((select target_reps_max from public.planned_sets where exercise_id = '00000000-0000-0000-0000-0000000000e3'), 13,
          'reps_max defaults to reps_min');
select is((select target_weight_kg from public.planned_sets where exercise_id = '00000000-0000-0000-0000-0000000000e3'),
          null::numeric, 'no weight is allowed (bodyweight)');
select is((select count(*) from public.planned_sets where exercise_id = '00000000-0000-0000-0000-0000000000e4'), 1::bigint,
          'exercise outside the routine is accepted');
select is((select status from public.planned_sessions where id = '00000000-0000-0000-0000-0000000000c1'), 'pending',
          'rules plan untouched');
select is((select id from public.current_plan where routine_id = '00000000-0000-0000-0000-0000000000b1'),
          (select (r ->> 'planned_session_id')::uuid from result), 'current_plan shows the claude plan');

-- A second plan supersedes the first claude plan only.
select lives_ok($$select public.submit_plan('zz test routine', '[{"exercise": "Bench Press (Dumbbell)", "sets": [{"weight_kg": 44, "reps_min": 8}]}]')$$,
                'routine name is case-insensitive');
select is((select count(*) from public.planned_sessions where routine_id = '00000000-0000-0000-0000-0000000000b1' and created_by = 'claude' and status = 'superseded'), 1::bigint,
          'older claude plan superseded');

-- Errors: each one must say what is wrong, and write nothing.
select throws_ilike($$select public.submit_plan('Workout Z', '[]')$$, '%routine "Workout Z" not found. Available routines:%Zz Test Routine%',
                    'unknown routine lists the available ones');
select throws_ilike($$select public.submit_plan('Zz Test Routine', '[{"exercise": "Bench Press Barbell", "sets": [{"reps_min": 5}]}]')$$,
                    '%not found. Similar names: Bench Press (Dumbbell)%', 'unknown exercise suggests similar names');
select throws_ilike($$select public.submit_plan('Zz Test Routine', '[{"exercise": "Bench Press (Dumbbell)", "sets": [{"weight_kg": 40, "reps_min": 10, "reps_max": 8}]}]')$$,
                    '%reps_min <= reps_max%', 'reps_min above reps_max rejected');
select throws_ilike($$select public.submit_plan('Zz Test Routine', '[{"exercise": "Bench Press (Dumbbell)", "sets": [{"weight_kg": -5, "reps_min": 8}]}]')$$,
                    '%weight_kg >= 0%', 'negative weight rejected');
select throws_ilike($$select public.submit_plan('Zz Test Routine', '[{"exercise": "Bench Press (Dumbbell)", "sets": [{"weight_kg": "heavy", "reps_min": 8}]}]')$$,
                    '%weight_kg must be a number%', 'text weight rejected');
select throws_ilike($$select public.submit_plan('Zz Test Routine', '[{"exercise": "Bench Press (Dumbbell)", "sets": [{"reps_min": 8}]},
                                                               {"exercise": "Bench Press (Dumbbell)", "sets": [{"reps_min": 8}]}]')$$,
                    '%appears twice%', 'same exercise twice rejected');

-- A failure in the 2nd exercise must not leave the 1st one (or a new plan row) behind.
select public.submit_plan('Zz Test Routine', '[{"exercise": "Bench Press (Dumbbell)", "sets": [{"reps_min": 8}]}]');
select throws_ilike($$select public.submit_plan('Zz Test Routine', '[{"exercise": "Bench Press (Dumbbell)", "sets": [{"reps_min": 8}]}, {"exercise": "Nope", "sets": []}]')$$,
                    '%not found%', 'bad second exercise raises');
select is((select count(*) from public.planned_sessions where routine_id = '00000000-0000-0000-0000-0000000000b1' and created_by = 'claude'), 3::bigint, 'failed call wrote nothing');

select * from finish();
rollback;
