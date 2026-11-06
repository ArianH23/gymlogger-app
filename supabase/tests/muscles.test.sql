-- Tests for the muscle tags and the per session / week / month muscle totals. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'one@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'two@example.com');

-- Exercises named like the catalog get their standard tags from the trigger; a custom one gets none.
insert into public.exercises (id, user_id, name, unilateral) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Bench Press (Barbell)', false),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Lateral Raise (Cable)', true),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', 'Zz Custom Move', false),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a2', 'Bench Press (Barbell)', false);

insert into public.sessions (id, user_id, title, started_at, ended_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'monday', '2026-01-05 10:00+00', '2026-01-05 11:00+00'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'next week', '2026-01-14 10:00+00', '2026-01-14 11:00+00'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1', 'unfinished', '2026-01-15 10:00+00', null),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a1', 'february', '2026-02-02 10:00+00', '2026-02-02 11:00+00'),
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000a2', 'other user', '2026-01-05 10:00+00', '2026-01-05 11:00+00');

create function pg_temp.s(p_user text, p_session text, p_ex text, p_no int, p_side text default null, p_warm boolean default false)
returns void language sql as $$
  insert into public.sets (user_id, session_id, exercise_id, set_no, side, weight_kg, reps, is_warmup)
  values (('00000000-0000-0000-0000-0000000000' || p_user)::uuid, ('00000000-0000-0000-0000-0000000000' || p_session)::uuid,
          ('00000000-0000-0000-0000-0000000000' || p_ex)::uuid, p_no, p_side, 40, 8, p_warm)
$$;

-- Monday: 3 bench sets and a warm-up (not counted), 2 left/right raise sets (each pair is one set), 2 sets of the untagged move.
select pg_temp.s('a1','d1','e1',1); select pg_temp.s('a1','d1','e1',2); select pg_temp.s('a1','d1','e1',3); select pg_temp.s('a1','d1','e1',4,null,true);
select pg_temp.s('a1','d1','e2',1,'L'); select pg_temp.s('a1','d1','e2',1,'R'); select pg_temp.s('a1','d1','e2',2,'L'); select pg_temp.s('a1','d1','e2',2,'R');
select pg_temp.s('a1','d1','e3',1); select pg_temp.s('a1','d1','e3',2);
-- The next week: 2 bench sets. The unfinished session: 5 (must not count). February: 1. The other user: 1 in the same week.
select pg_temp.s('a1','d2','e1',1); select pg_temp.s('a1','d2','e1',2);
select pg_temp.s('a1','d3','e1',1); select pg_temp.s('a1','d3','e1',2); select pg_temp.s('a1','d3','e1',3); select pg_temp.s('a1','d3','e1',4); select pg_temp.s('a1','d3','e1',5);
select pg_temp.s('a1','d4','e1',1);
select pg_temp.s('a2','d5','e4',1);

create function pg_temp.sm(p_session text, p_muscle text) returns public.session_muscles language sql as $$
  select * from public.session_muscles where session_id = ('00000000-0000-0000-0000-0000000000' || p_session)::uuid and muscle = p_muscle
$$;

select is((select count(*) from public.muscle_defs()), 16::bigint, 'there are 16 muscles');
select is((select count(distinct exercise_name) from public.exercise_muscle_defaults()), 72::bigint, 'the standard tags cover all 72 catalog exercises');
select is((select count(*) from public.exercise_muscles where exercise_id = '00000000-0000-0000-0000-0000000000e1'), 3::bigint, 'a new exercise named like the catalog is tagged by the trigger (bench: chest, triceps, front delts)');
select is((select role from public.exercise_muscles where exercise_id = '00000000-0000-0000-0000-0000000000e1' and muscle = 'chest'), 'primary', 'chest is primary for bench');
select is((select role from public.exercise_muscles where exercise_id = '00000000-0000-0000-0000-0000000000e1' and muscle = 'triceps'), 'secondary', 'triceps is secondary for bench');
select is((select count(*) from public.exercise_muscles where exercise_id = '00000000-0000-0000-0000-0000000000e3'), 0::bigint, 'a custom exercise gets no tags');

select is((pg_temp.sm('d1', 'chest')).sets, 3.0, 'three working sets give the primary muscle 3 (the warm-up does not count)');
select is((pg_temp.sm('d1', 'triceps')).sets, 1.5, 'a secondary muscle gets half a set per set');
select is((pg_temp.sm('d1', 'side_delts')).sets, 2.0, 'a left/right pair counts as one set');
select is((select count(*) from public.session_muscles where session_id = '00000000-0000-0000-0000-0000000000d1'), 4::bigint, 'only trained muscles appear, and an untagged exercise adds none (4 of 16)');
select is((pg_temp.sm('d1', 'chest')).share, 0.375, 'share = 3 of the 8 weighted sets');
select is((select count(*) from public.session_muscles where session_id = '00000000-0000-0000-0000-0000000000d3'), 0::bigint, 'an unfinished session has no rows');

select is((select sets from public.weekly_muscles where user_id = '00000000-0000-0000-0000-0000000000a1' and week_start = '2026-01-05' and muscle = 'chest'), 3.0, 'week of Monday 5 Jan: chest 3');
select is((select sets from public.weekly_muscles where user_id = '00000000-0000-0000-0000-0000000000a1' and week_start = '2026-01-12' and muscle = 'chest'), 2.0, 'week of 12 Jan: chest 2');
select is((select share from public.weekly_muscles where user_id = '00000000-0000-0000-0000-0000000000a1' and week_start = '2026-01-05' and muscle = 'chest'), 0.375, 'weekly share is out of the week total');
select is((select sets from public.monthly_muscles where user_id = '00000000-0000-0000-0000-0000000000a1' and month_start = '2026-01-01' and muscle = 'chest'), 5.0, 'January: both weeks add up, chest 5');
select is((select sessions from public.monthly_muscles where user_id = '00000000-0000-0000-0000-0000000000a1' and month_start = '2026-01-01' and muscle = 'chest'), 2::bigint, 'January chest was trained in 2 sessions');
select is((select sets from public.weekly_muscles where user_id = '00000000-0000-0000-0000-0000000000a2' and week_start = '2026-01-05' and muscle = 'chest'), 1.0, 'another user is counted separately');
select throws_ok($$insert into public.exercise_muscles (user_id, exercise_id, muscle, role) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e3', 'toes', 'primary')$$, '23514', null, 'an unknown muscle is rejected');
select is((select count(*) from pg_policies where tablename = 'exercise_muscles'), 1::bigint, 'row level security policy exists on exercise_muscles');

select * from finish();
rollback;
