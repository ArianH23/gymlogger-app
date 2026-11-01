-- Tests for the exercise statistics views. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'test@example.com');
insert into public.exercises (id, user_id, name, load_type, unilateral) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Zz Stats Press', 'weighted', false),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Zz Stats Chin', 'assisted', false),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', 'Zz Stats Raise', 'weighted', true),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a1', 'Zz Stats Calf', 'bodyweight', false),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000a1', 'Zz Stats Light', 'weighted', false),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000a1', 'Zz Stats Never', 'weighted', false);

insert into public.sessions (id, user_id, title, started_at, ended_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 's1', '2026-01-01 10:00+00', '2026-01-01 11:00+00'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 's2', '2026-01-08 10:00+00', '2026-01-08 11:00+00'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1', 'unfinished', '2026-01-15 10:00+00', null);

create function pg_temp.s(p_session text, p_ex text, p_no int, p_w numeric, p_reps int, p_side text default null, p_warm boolean default false)
returns void language sql as $$
  insert into public.sets (user_id, session_id, exercise_id, set_no, side, weight_kg, reps, is_warmup)
  values ('00000000-0000-0000-0000-0000000000a1', ('00000000-0000-0000-0000-0000000000' || p_session)::uuid,
          ('00000000-0000-0000-0000-0000000000' || p_ex)::uuid, p_no, p_side, p_w, p_reps, p_warm)
$$;

-- Press: session 1 = 40x10, 40x8, 44x6 (+ a warm-up that must not count); session 2 = 44x7; unfinished 60x5 must not count.
select pg_temp.s('d1','e1',1,40,10); select pg_temp.s('d1','e1',2,40,8); select pg_temp.s('d1','e1',3,44,6);
select pg_temp.s('d1','e1',4,100,5,null,true);
select pg_temp.s('d2','e1',1,44,7);
select pg_temp.s('d3','e1',1,60,5);
-- Chin-up (assisted): 50x9, 50x8, then 45x8 next week.
select pg_temp.s('d1','e2',1,50,9); select pg_temp.s('d1','e2',2,50,8); select pg_temp.s('d2','e2',1,45,8);
-- Left/right raise: set 1 L12 R10 at 7.5 kg.
select pg_temp.s('d1','e3',1,7.5,12,'L'); select pg_temp.s('d1','e3',1,7.5,10,'R');
-- Bodyweight calf raise: no weight.
select pg_temp.s('d1','e4',1,null,15); select pg_temp.s('d1','e4',2,null,12);
-- Light exercise: one set of 20 reps (too many for a 1RM estimate).
select pg_temp.s('d1','e5',1,20,20);

create function pg_temp.st(p_session text, p_ex text) returns public.exercise_session_stats language sql as $$
  select * from public.exercise_session_stats
  where session_id = ('00000000-0000-0000-0000-0000000000' || p_session)::uuid and exercise_id = ('00000000-0000-0000-0000-0000000000' || p_ex)::uuid
$$;

select is((pg_temp.st('d1','e1')).best_weight_kg, 44::numeric, 'heaviest weight of the session');
select is((pg_temp.st('d1','e1')).sets, 3::bigint, 'warm-up not counted as a set');
select is((pg_temp.st('d1','e1')).total_reps, 24::bigint, 'total reps');
select is(round((pg_temp.st('d1','e1')).est_1rm_kg, 2), 53.33, 'estimated 1RM = best Epley (40 x 10)');
select is((pg_temp.st('d1','e1')).best_set_volume_kg, 400::numeric, 'best set volume');
select is((pg_temp.st('d1','e1')).session_volume_kg, 984::numeric, 'session volume (400 + 320 + 264)');
select is((select count(*) from public.exercise_session_stats where exercise_id = '00000000-0000-0000-0000-0000000000e1'), 2::bigint,
          'unfinished session ignored');
select is(round((pg_temp.st('d2','e1')).est_1rm_kg, 2), 54.27, '1RM of the next session');

select is((pg_temp.st('d2','e2')).best_weight_kg, 45::numeric, 'assisted: lowest assistance is the best');
select is((pg_temp.st('d1','e2')).est_1rm_kg, null::numeric, 'assisted: no 1RM');

select is((pg_temp.st('d1','e3')).best_reps, 10, 'left/right: the lower side counts');
select is((pg_temp.st('d1','e3')).session_volume_kg, 75::numeric, 'left/right: volume uses the lower side (7.5 x 10)');

select is((pg_temp.st('d1','e4')).best_weight_kg, null::numeric, 'bodyweight: no weight');
select is((pg_temp.st('d1','e4')).session_volume_kg, null::numeric, 'bodyweight: no volume');
select is((pg_temp.st('d1','e4')).total_reps, 27::bigint, 'bodyweight: reps still counted');

select is((pg_temp.st('d1','e5')).est_1rm_kg, null::numeric, '20-rep sets are too many for a 1RM estimate');
select is((pg_temp.st('d1','e5')).session_volume_kg, 400::numeric, 'but they count for volume');

select is((select reps from public.exercise_best_reps_by_weight where exercise_id = '00000000-0000-0000-0000-0000000000e1' and weight_kg = 44),
          7, 'best reps at 44 kg is 7 (the later session)');
select is((select reps from public.exercise_best_reps_by_weight where exercise_id = '00000000-0000-0000-0000-0000000000e1' and weight_kg = 40),
          10, 'best reps at 40 kg is 10');

select is((select sessions from public.exercise_summary where exercise_id = '00000000-0000-0000-0000-0000000000e1'), 2::bigint,
          'summary counts finished sessions');
select is((select last_performed_at from public.exercise_summary where exercise_id = '00000000-0000-0000-0000-0000000000e6'), null::timestamptz,
          'an exercise never done has no last date');

select * from finish();
rollback;
