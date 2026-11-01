-- Tests for edit_session and delete_session. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'test@example.com');
insert into public.exercises (id, user_id, name, rep_min, rep_max, increment_kg) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Zz Edit Press', 6, 10, 4),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Zz Edit Curl', 6, 10, 4);
insert into public.routines (id, user_id, name) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Zz Edit Routine');
insert into public.routine_exercises (user_id, routine_id, exercise_id, position, target_sets) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 1, 2);
insert into public.sessions (id, user_id, routine_id, title, started_at, ended_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'Old title', '2026-01-05 10:00+00', '2026-01-05 11:00+00');
insert into public.sets (id, user_id, session_id, exercise_id, set_no, weight_kg, reps) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 1, 40, 8),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 2, 40, 7);
-- a pending claude plan that edits must never touch
insert into public.planned_sessions (id, user_id, routine_id, created_by, status)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'claude', 'pending');

-- Update both sets to 10 reps and rename the session.
select is((public.edit_session('00000000-0000-0000-0000-0000000000d1', 'New title',
  '[{"id": "00000000-0000-0000-0000-0000000000f1", "weight_kg": 40, "reps": 10}, {"id": "00000000-0000-0000-0000-0000000000f2", "weight_kg": 40, "reps": 10}]'::jsonb) ->> 'updated'),
  '2', 'two sets updated');
select is((select title from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'), 'New title', 'title changed');
select is((select reps from public.sets where id = '00000000-0000-0000-0000-0000000000f2'), 10, 'reps changed');
select is((select best_weight_kg from public.exercise_session_stats where session_id = '00000000-0000-0000-0000-0000000000d1'), 40::numeric,
          'stats follow the edit');

-- The rules plan was rebuilt from the corrected numbers: all sets hit rep_max 10, so +4 kg.
select is((select ps.target_weight_kg from public.planned_sets ps join public.planned_sessions p on p.id = ps.planned_session_id
           where p.routine_id = '00000000-0000-0000-0000-0000000000b1' and p.created_by = 'rules' and p.status = 'pending' and ps.set_no = 1),
          44::numeric, 'automatic plan rebuilt from the corrected sets (40 kg x 10 -> 44 kg)');
select is((select status from public.planned_sessions where id = '00000000-0000-0000-0000-0000000000c1'), 'pending', 'claude plan untouched');

-- Delete one set, add a set to another exercise.
select is((public.edit_session('00000000-0000-0000-0000-0000000000d1', null, '[]'::jsonb, array['00000000-0000-0000-0000-0000000000f2']::uuid[],
  '[{"exercise_id": "00000000-0000-0000-0000-0000000000e2", "set_no": 1, "weight_kg": 20, "reps": 12}]'::jsonb) ->> 'deleted'), '1', 'one set deleted');
select is((select count(*) from public.sets where session_id = '00000000-0000-0000-0000-0000000000d1' and deleted_at is null), 2::bigint, 'one removed, one added: 2 live sets');
select is((select total_reps from public.exercise_session_stats where session_id = '00000000-0000-0000-0000-0000000000d1' and exercise_id = '00000000-0000-0000-0000-0000000000e1'),
          10::bigint, 'stats exclude the deleted set');
select ok((select logged_at from public.sets where exercise_id = '00000000-0000-0000-0000-0000000000e2')
          > (select max(logged_at) from public.sets where exercise_id = '00000000-0000-0000-0000-0000000000e1'), 'an added set is logged after the others');

-- A removed set number can be used again in the same call.
select is((public.edit_session('00000000-0000-0000-0000-0000000000d1', null, '[]'::jsonb, array['00000000-0000-0000-0000-0000000000f1']::uuid[],
  '[{"exercise_id": "00000000-0000-0000-0000-0000000000e1", "set_no": 1, "weight_kg": 42, "reps": 9}]'::jsonb) ->> 'added'), '1', 'delete then re-add the same set number');

-- Errors.
select throws_ilike($$select public.edit_session('00000000-0000-0000-0000-0000000000d1', null, '[]', '{}',
  '[{"exercise_id": "00000000-0000-0000-0000-0000000000e1", "set_no": 1, "weight_kg": 40, "reps": 8}]')$$, '%duplicate key%', 'a duplicate set number is rejected');
select throws_ilike($$select public.edit_session('00000000-0000-0000-0000-0000000000d1', '   ')$$, '%cannot be empty%', 'empty title rejected');
select throws_ilike(format($q$select public.edit_session('00000000-0000-0000-0000-0000000000d1', null,
  '[{"id": "%s", "weight_kg": 40, "reps": -3}]'::jsonb)$q$,
  (select id from public.sets where session_id = '00000000-0000-0000-0000-0000000000d1' and deleted_at is null limit 1)),
  '%check constraint%', 'negative reps rejected');
select throws_ilike($$select public.edit_session('00000000-0000-0000-0000-00000000dead')$$, '%not found%', 'unknown session rejected');

-- Deleting the whole session.
select is((public.delete_session('00000000-0000-0000-0000-0000000000d1') ->> 'sets_deleted'), '2', 'delete_session removes the sets too');
select is((select count(*) from public.exercise_session_stats where session_id = '00000000-0000-0000-0000-0000000000d1'), 0::bigint, 'gone from the stats');
select is((select last_session_id from public.routine_status where routine_id = '00000000-0000-0000-0000-0000000000b1'), null::uuid, 'the routine has no last session any more');

select * from finish();
rollback;
