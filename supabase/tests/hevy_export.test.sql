-- Tests for the Hevy export (Strong CSV format). Run with: npx supabase test db
-- The checks run as the test user (row level security), because the local database may hold other data.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'one@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'two@example.com');
insert into public.exercises (id, user_id, name, unilateral, load_type) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Zz Press', false, 'weighted'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Incline Bench Press (Dumbbell) 30°', false, 'weighted'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', 'Dumbbell Row (Single Arm)', true, 'weighted'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a1', 'Zz Pullup', false, 'bodyweight'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000a2', 'Zz Press', false, 'weighted');
insert into public.sessions (id, user_id, title, started_at, ended_at, notes, source) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'Push, heavy', '2026-01-05 10:00+00', '2026-01-05 10:45+00', 'felt "good"', 'app'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'Imported day', '2026-01-04 09:00+00', '2026-01-04 10:02+00', null, 'hevy_import'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1', 'Unfinished', '2026-01-06 10:00+00', null, null, 'app'),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a2', 'Other user', '2026-01-05 10:00+00', '2026-01-05 11:00+00', null, 'app');
insert into public.session_exercise_notes (user_id, session_id, exercise_id, note) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e3', 'slow');

create function pg_temp.s(p_user text, p_session text, p_ex text, p_no int, p_w numeric, p_reps int, p_secs int, p_side text default null, p_warm boolean default false)
returns void language sql as $$
  insert into public.sets (user_id, session_id, exercise_id, set_no, side, weight_kg, reps, is_warmup, logged_at)
  values (('00000000-0000-0000-0000-0000000000' || p_user)::uuid, ('00000000-0000-0000-0000-0000000000' || p_session)::uuid,
          ('00000000-0000-0000-0000-0000000000' || p_ex)::uuid, p_no, p_side, p_w, p_reps, p_warm,
          '2026-01-05 10:00+00'::timestamptz + make_interval(secs => p_secs))
$$;

-- Session 1: a warm-up (left out), 3 press sets, one incline 30° set, 2 left/right row sets, one bodyweight pull-up set.
select pg_temp.s('a1', 'd1', 'e1', 9, 100, 5, 1, null, true);
select pg_temp.s('a1', 'd1', 'e1', 1, 40, 8, 2); select pg_temp.s('a1', 'd1', 'e1', 2, 40, 8, 3); select pg_temp.s('a1', 'd1', 'e1', 3, 42.5, 6, 4);
select pg_temp.s('a1', 'd1', 'e2', 1, 20, 10, 10);
select pg_temp.s('a1', 'd1', 'e3', 1, 30, 10, 20, 'L'); select pg_temp.s('a1', 'd1', 'e3', 1, 30, 9, 21, 'R');
select pg_temp.s('a1', 'd1', 'e4', 1, null, 10, 30);
select pg_temp.s('a1', 'd2', 'e1', 1, 50, 5, 1);
select pg_temp.s('a1', 'd3', 'e1', 1, 60, 5, 1);
select pg_temp.s('a2', 'd4', 'e5', 1, 70, 5, 1);

-- From here on: signed in as user one.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

select is(public.csv_field('abc'), 'abc', 'a plain value is not quoted');
select is(public.csv_field('a,b'), '"a,b"', 'a value with a comma is quoted');
select is(public.csv_field('say "hi"'), '"say ""hi"""', 'quotes are doubled');
select is(public.hevy_exercise_name('Incline Bench Press (Dumbbell) 30°'), 'Incline Bench Press (Dumbbell)', 'the incline angle goes back to Hevy''s one incline bench');
select is(public.hevy_exercise_name('Dumbbell Row (Single Arm)'), 'Dumbbell Row', 'the single-arm row goes back to Hevy''s dumbbell row');
select is(public.hevy_exercise_name('Squat (Barbell)'), 'Squat (Barbell)', 'other names are unchanged');

select is(split_part(public.export_hevy_csv(), chr(10), 1), 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE', 'the header is the 12 Strong columns');
select is(length(public.export_hevy_csv()) - length(replace(public.export_hevy_csv(), chr(10), '')), 7, 'the default export has 7 rows: warm-up, imported and unfinished are left out');
select is(length(public.export_hevy_csv(false)) - length(replace(public.export_hevy_csv(false), chr(10), '')), 8, 'with everything, the imported session adds its row');
select ok(public.export_hevy_csv() !~ ',100,', 'the warm-up set is not exported');
select ok(public.export_hevy_csv() !~ 'Imported day' and public.export_hevy_csv(false) ~ 'Imported day', 'the imported history is only in the full export');
select ok(public.export_hevy_csv(false) !~ 'Unfinished', 'an unfinished session is never exported');
select is(split_part(split_part(public.export_hevy_csv(), chr(10), 2), ',', 1), '2026-01-05 11:00:00', 'the date is in local time');
select is((select distinct duration from public.hevy_export_rows where session_id = '00000000-0000-0000-0000-0000000000d1'), '45m', 'duration 45 minutes is 45m');
select is((select distinct duration from public.hevy_export_rows where session_id = '00000000-0000-0000-0000-0000000000d2'), '1h 2m', 'duration 62 minutes is 1h 2m');
select ok(public.export_hevy_csv() ~ '"Push, heavy"' and public.export_hevy_csv() ~ '"felt ""good"""', 'a title with a comma and notes with quotes are quoted correctly');
select is((select string_agg(set_order::text || ':' || weight, ' ' order by set_order) from public.hevy_export_rows where exercise_name = 'Zz Press' and session_id = '00000000-0000-0000-0000-0000000000d1'), '1:40 2:40 3:42.5', 'set order counts from 1 and weights have no trailing zeros');
select is((select string_agg(notes, '|' order by set_order) from public.hevy_export_rows where exercise_name = 'Dumbbell Row'), 'L · slow|R', 'left and right are separate rows, the side in notes, the exercise note on the first row');
select is((select notes from public.hevy_export_rows where exercise_name = 'Incline Bench Press (Dumbbell)'), '30°', 'the incline angle is kept in the notes');
select is((select weight from public.hevy_export_rows where exercise_name = 'Zz Pullup'), '0', 'a bodyweight set has weight 0');
select ok(strpos(public.export_hevy_csv(), 'Zz Press') < strpos(public.export_hevy_csv(), 'Incline Bench') and strpos(public.export_hevy_csv(), 'Incline Bench') < strpos(public.export_hevy_csv(), 'Zz Pullup'), 'exercises come in the order they were done');

-- Another user only ever gets their own rows.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select is(length(public.export_hevy_csv(false)) - length(replace(public.export_hevy_csv(false), chr(10), '')), 1, 'another user''s export has only their own row');

reset role;
select set_config('request.jwt.claims', '', true);
select * from finish();
rollback;
