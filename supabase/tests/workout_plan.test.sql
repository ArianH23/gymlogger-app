-- Tests for workout_plan: the plan shown when starting a routine. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'test@example.com');
insert into public.routines (id, user_id, name) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Zz Plan Routine');
insert into public.exercises (id, user_id, name, rep_min, rep_max, increment_kg) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Zz Plan A', 6, 10, 4),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Zz Plan B', 6, 10, 4),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', 'Zz Plan C', 6, 10, 4);
insert into public.routine_exercises (id, user_id, routine_id, exercise_id, position, target_sets, updated_at) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 1, 2, now() - interval '3 days'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e2', 2, 2, now() - interval '3 days');

-- A claude plan written 2 days ago for A and B (targets 100 / 200), and a pending rules plan for A, B (and C once added).
insert into public.planned_sessions (id, user_id, routine_id, created_by, status, created_at) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'claude', 'pending', now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'rules', 'pending', now() - interval '1 hour');
insert into public.planned_sets (user_id, planned_session_id, exercise_id, exercise_position, set_no, target_weight_kg, target_reps_min) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 1, 1, 100, 8),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e2', 2, 1, 200, 8),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e1', 1, 1, 1, 1),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e2', 2, 1, 2, 2),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e3', 3, 1, 3, 3);

create function pg_temp.names() returns text language sql as $$
  select string_agg(e.name || ':' || w.target_weight_kg::int || ':' || w.source, ' | ' order by w.exercise_position, w.set_no)
  from public.workout_plan('00000000-0000-0000-0000-0000000000b1') w join public.exercises e on e.id = w.exercise_id
$$;

-- 1. Routine not edited since the claude plan: shown exactly as written.
select is(pg_temp.names(), 'Zz Plan A:100:claude | Zz Plan B:200:claude', 'unedited routine: the claude plan as written');

-- 2. Add exercise C to the routine today: C is appended with the rules plan's targets; A and B keep claude's.
insert into public.routine_exercises (user_id, routine_id, exercise_id, position, target_sets)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e3', 3, 2);
select is(pg_temp.names(), 'Zz Plan A:100:claude | Zz Plan B:200:claude | Zz Plan C:3:rules', 'added exercise appended from the rules plan, claude targets kept');

-- 3. Remove B from the routine: dropped from the plan, A and C remain.
update public.routine_exercises set deleted_at = now() where id = '00000000-0000-0000-0000-0000000000f2';
select is(pg_temp.names(), 'Zz Plan A:100:claude | Zz Plan C:3:rules', 'removed exercise dropped');

-- 4. Appended exercise comes after the last one in the plan.
select is((select exercise_position from public.workout_plan('00000000-0000-0000-0000-0000000000b1') where source = 'rules' limit 1), 2, 'appended exercise continues the numbering after the last remaining one');

-- 5. A claude plan written AFTER the edit is shown as written, even if it leaves an exercise out.
insert into public.planned_sessions (id, user_id, routine_id, created_by, status, created_at)
values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'claude', 'pending', now() + interval '1 minute');
insert into public.planned_sets (user_id, planned_session_id, exercise_id, exercise_position, set_no, target_weight_kg, target_reps_min)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000e1', 1, 1, 111, 8);
select is(pg_temp.names(), 'Zz Plan A:111:claude', 'a newer claude plan is shown exactly as written');

-- 6. With only a rules plan, it is returned as is.
update public.planned_sessions set status = 'superseded' where created_by = 'claude';
select is(pg_temp.names(), 'Zz Plan A:1:rules | Zz Plan C:3:rules', 'rules plan alone: unchanged (B was removed from the routine)');
select is((select count(distinct source) from public.workout_plan('00000000-0000-0000-0000-0000000000b1')), 1::bigint, 'single source');

-- 7. No plan at all: no rows.
update public.planned_sessions set status = 'superseded';
select is((select count(*) from public.workout_plan('00000000-0000-0000-0000-0000000000b1')), 0::bigint, 'no pending plan: no rows');
select is((select count(*) from public.workout_plan('00000000-0000-0000-0000-00000000dead')), 0::bigint, 'unknown routine: no rows');

select * from finish();
rollback;
