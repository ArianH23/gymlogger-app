-- Tests for the heart rate per set (view set_heart_rate). Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'one@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'two@example.com');

insert into public.exercises (id, user_id, name, unilateral) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Bench Press (Barbell)', false),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Lateral Raise (Cable)', true),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a2', 'Bench Press (Barbell)', false);

-- d1: 20 minutes with a heart-rate track. d2: no heart rate. d3: the other user's, with a track.
insert into public.sessions (id, user_id, title, started_at, ended_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'with hr', '2026-01-05 10:00+00', '2026-01-05 10:20+00'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'no hr', '2026-01-06 10:00+00', '2026-01-06 10:20+00'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a2', 'other user', '2026-01-05 10:00+00', '2026-01-05 10:20+00');

-- The track, [seconds, bpm]:
--   bench set 1 logged at 120 s: 100 at 60, 150 at 110, 140 at 130 (in the window 60..140)  -> peak 150
--   rest: 120 at 150, 95 at 200, 105 at 230 (window 141..240, the next set is logged at 300) -> low 95, drop 55
--   bench set 2 logged at 300 s: 110 at 250, 155 at 300, 160 at 305                          -> peak 160
--   the raise follows at 370 s, so the rest window (321..310) is empty                       -> low null
--   raise set 1: left logged at 370 s, right at 420 s: 130 at 330, 145 at 400, 150 at 440     -> peak 150 (310..440)
--   after it, the last set: 90 at 600, 85 at 700, 70 at 800 (only up to 420 + 300 = 720)     -> low 85
update public.sessions set hr_track = '[[60,100],[110,150],[130,140],[150,120],[200,95],[230,105],[250,110],[300,155],[305,160],[330,130],[400,145],[440,150],[600,90],[700,85],[800,70]]'::jsonb
 where id = '00000000-0000-0000-0000-0000000000d1';
update public.sessions set hr_track = '[[100,120],[120,130]]'::jsonb where id = '00000000-0000-0000-0000-0000000000d3';

create function pg_temp.s(p_user text, p_session text, p_ex text, p_no int, p_at timestamptz, p_side text default null) returns void language sql as $$
  insert into public.sets (user_id, session_id, exercise_id, set_no, side, weight_kg, reps, logged_at)
  values (('00000000-0000-0000-0000-0000000000' || p_user)::uuid, ('00000000-0000-0000-0000-0000000000' || p_session)::uuid,
          ('00000000-0000-0000-0000-0000000000' || p_ex)::uuid, p_no, p_side, 40, 8, p_at)
$$;

select pg_temp.s('a1','d1','e1',1,'2026-01-05 10:02:00+00');
select pg_temp.s('a1','d1','e1',2,'2026-01-05 10:05:00+00');
select pg_temp.s('a1','d1','e2',1,'2026-01-05 10:06:10+00','L');
select pg_temp.s('a1','d1','e2',1,'2026-01-05 10:07:00+00','R');
-- added the next day by editing the session: no real time
select pg_temp.s('a1','d1','e1',3,'2026-01-06 09:00:00+00');
-- a session without heart rate, and the other user's
select pg_temp.s('a1','d2','e1',1,'2026-01-06 10:02:00+00');
select pg_temp.s('a2','d3','e3',1,'2026-01-05 10:02:00+00');

create function pg_temp.h(p_ex text, p_no int) returns public.set_heart_rate language sql as $$
  select * from public.set_heart_rate
  where session_id = '00000000-0000-0000-0000-0000000000d1' and exercise_id = ('00000000-0000-0000-0000-0000000000' || p_ex)::uuid and set_no = p_no
$$;

select is((pg_temp.h('e1', 1)).peak_bpm, 150, 'peak = the highest from 60 s before the set was logged to 20 s after');
select is((pg_temp.h('e1', 1)).rest_low_bpm, 95, 'rest low = the lowest until 60 s before the next set is logged');
select is((pg_temp.h('e1', 1)).drop_bpm, 55, 'drop = peak - rest low');
select is((pg_temp.h('e1', 2)).peak_bpm, 160, 'the second set has its own peak');
select is((pg_temp.h('e1', 2)).rest_low_bpm, null, 'the next set followed too soon: no rest low');
select is((pg_temp.h('e1', 2)).drop_bpm, null, 'and so no drop');
select is((select count(*) from public.set_heart_rate where session_id = '00000000-0000-0000-0000-0000000000d1' and exercise_id = '00000000-0000-0000-0000-0000000000e2'), 1::bigint, 'the two sides of a left/right set are one row');
select is((pg_temp.h('e2', 1)).peak_bpm, 150, 'its window runs from the first side to the last');
select is((pg_temp.h('e2', 1)).rest_low_bpm, 85, 'after the last set the rest window is 5 minutes at most (the 70 at 800 s is outside)');
select is((pg_temp.h('e2', 1)).logged_at, '2026-01-05 10:07:00+00'::timestamptz, 'logged_at is the last side');
select is((select count(*) from public.set_heart_rate where session_id = '00000000-0000-0000-0000-0000000000d1' and set_no = 3), 0::bigint, 'a set added later by editing has no row');
select is((select count(*) from public.set_heart_rate where session_id = '00000000-0000-0000-0000-0000000000d2'), 0::bigint, 'a session without heart rate has no rows');

-- as the first user, the other user's rows are not visible
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.set_heart_rate where session_id = '00000000-0000-0000-0000-0000000000d3'), 0::bigint, 'another user''s heart rate is not visible');
reset role;

select * from finish();
rollback;
