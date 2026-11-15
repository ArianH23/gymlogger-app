-- Tests for runs: submit_run (distance, moving time, splits, elevation, re-import), the run views, and runs in the
-- calendar and the week streak. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'one@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'two@example.com');

-- A steady run: one point every 5 seconds for 1000 s at 2.5 m/s = 2500 m, heart rate 150, flat at 20 m.
-- p_pause adds a 120 s stop half way; p_climb raises the altitude evenly to that many metres; p_speed changes the speed.
create function pg_temp.pts(p_pause boolean default false, p_climb numeric default 0, p_speed numeric default 2.5, p_seconds integer default 1000)
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_array(
           s + case when p_pause and s > p_seconds / 2 then 120 else 0 end,
           41.4, 2.18 + s * 0.00001, 20 + p_climb * s / p_seconds, s * p_speed, 150) order by s)
  from generate_series(0, p_seconds, 5) as s
$$;
create function pg_temp.run(p_id text, p_points jsonb, p_extra jsonb default '{}') returns jsonb language sql as $$
  select public.submit_run(jsonb_build_object('source', 'google_health', 'external_id', p_id,
                                              'started_at', '2026-03-02T07:00:00+01:00', 'points', p_points) || p_extra)
$$;

-- Everything below is done signed in as user one.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

select is((pg_temp.run('steady', pg_temp.pts())) ->> 'created', 'true', 'a new run is created');
select is((select distance_m from public.runs where external_id = 'steady'), 2500.0, 'distance comes from the points: 2500 m');
select is((select moving_s from public.runs where external_id = 'steady'), 1000, 'moving time 1000 s');
select is((select pace_s_per_km from public.run_summary where title = 'Run' and distance_m = 2500.0 limit 1), 400.0, 'pace = 400 s per km');
select is((select count(*) from public.run_splits s join public.runs r on r.id = s.run_id where r.external_id = 'steady'), 3::bigint, 'three splits: two kilometres and the rest');
select is((select string_agg(seconds::text, ' ' order by km) from public.run_splits s join public.runs r on r.id = s.run_id where r.external_id = 'steady'), '400.0 400.0 200.0', 'split times 400, 400 and 200 s');
select is((select s.distance_m from public.run_splits s join public.runs r on r.id = s.run_id where r.external_id = 'steady' and km = 3), 500.0, 'the last split is the remaining 500 m');
select is((select avg_hr_bpm from public.runs where external_id = 'steady'), 150, 'average heart rate from the points');
select is((select elevation_gain_m from public.runs where external_id = 'steady'), 0.0, 'a flat run climbs 0 m');
select ok((select jsonb_array_length(track) from public.runs where external_id = 'steady') between 190 and 202, 'the track keeps about one point every 5 seconds');

-- A pause is not moving time, and does not slow the splits.
select pg_temp.run('paused', pg_temp.pts(true));
select is((select elapsed_s from public.runs where external_id = 'paused'), 1120, 'elapsed time includes the 120 s pause');
select is((select moving_s from public.runs where external_id = 'paused'), 995, 'moving time leaves the pause out (and the 5 s step that spans it)');
select is((select seconds from public.run_splits s join public.runs r on r.id = s.run_id where r.external_id = 'paused' and km = 2), 395.0, 'the split with the pause takes 395 s of moving time, not 515');

-- The source's own distance wins when it is close to the track, and the splits add up to it.
select pg_temp.run('reported', pg_temp.pts(), '{"distance_m": 2450, "calories": 300}');
select is((select distance_m from public.runs where external_id = 'reported'), 2450.0, 'the reported distance is used');
select is((select sum(s.distance_m) from public.run_splits s join public.runs r on r.id = s.run_id where r.external_id = 'reported'), 2450.0, 'the splits add up to the reported distance');
select is((select calories_kcal from public.runs where external_id = 'reported'), 300, 'calories are kept');
select pg_temp.run('wild', pg_temp.pts(), '{"distance_m": 9000}');
select is((select distance_m from public.runs where external_id = 'wild'), 2500.0, 'a reported distance far from the track is ignored');

-- A climb, and a source-given elevation gain.
select pg_temp.run('climb', pg_temp.pts(false, 50));
select ok((select elevation_gain_m from public.runs where external_id = 'climb') between 44 and 50.5, 'a steady 50 m climb gives about 50 m of gain');
select pg_temp.run('given-gain', pg_temp.pts(false, 50), '{"elevation_gain_m": 61}');
select is((select elevation_gain_m from public.runs where external_id = 'given-gain'), 61.0, 'the source''s elevation gain is used when given');

-- Without "distance so far", the distance is measured between the positions: 10 steps of 0.001 degrees along the equator.
select public.submit_run(jsonb_build_object('source', 'tcx_file', 'external_id', 'gps', 'started_at', '2026-03-03T07:00:00+01:00',
  'points', (select jsonb_agg(jsonb_build_array(s * 30, 0, s * 0.001, null, null, null) order by s) from generate_series(0, 10) s)));
select ok((select distance_m from public.runs where external_id = 'gps') between 1108 and 1116, 'ten steps of 0.001 degrees on the equator are about 1112 m');
select is((select avg_hr_bpm from public.runs where external_id = 'gps'), null, 'no heart rate in the file: none stored');

-- Importing the same run again updates it, keeps your title, and brings it back if it was deleted.
update public.runs set title = 'Beach run', deleted_at = now() where external_id = 'steady';
select is((pg_temp.run('steady', pg_temp.pts(false, 0, 3))) ->> 'created', 'false', 'the same run again is an update');
select is((select count(*) from public.runs where external_id = 'steady'), 1::bigint, 'still one row');
select is((select title || ' ' || distance_m::text || ' ' || (deleted_at is null)::text from public.runs where external_id = 'steady'), 'Beach run 3000.0 true', 'new numbers, your title kept, no longer deleted');

select throws_ok($$select public.submit_run('{"source": "google_health", "external_id": "x", "started_at": "2026-03-02T07:00:00+01:00", "points": [[0, 1, 1, 0, 0, null]]}')$$, 'P0001', null, 'a run with one point is rejected');
select throws_ok($$select public.submit_run('{"source": "nope", "external_id": "x", "started_at": "2026-03-02T07:00:00+01:00", "points": [[0, 1, 1, 0, 0, null], [5, 1, 1, 0, 10, null]]}')$$, 'P0001', null, 'an unknown source is rejected');

-- A long run for the bests: 6 km, with the kilometres getting faster (the 5 fastest in a row are the last five).
select public.submit_run(jsonb_build_object('source', 'strava_import', 'external_id', 'long', 'started_at', '2026-03-09T07:00:00+01:00',
  'points', (select jsonb_agg(jsonb_build_array(a.t0 + j * 10, null, null, null, (a.k - 1) * 1000 + j * 10 * 1000.0 / a.sec, null) order by a.k, j)
             from (select k, 400 - 10 * k as sec, sum(400 - 10 * k) over (order by k) - (400 - 10 * k) as t0 from generate_series(1, 6) k) a,
                  lateral generate_series(case when a.k = 1 then 0 else 1 end, a.sec / 10) j)));
select is((select value from public.run_bests where kind = 'longest'), 6000.0, 'longest run: 6000 m');
select is((select value from public.run_bests where kind = 'best_1k'), 269.8, 'fastest kilometre over all runs: 269.8 s (the GPS-only run)');
select is((select value from public.run_bests where kind = 'best_5k'), 1800.0, 'fastest 5 km: the last five kilometres, 380+370+360+350+340 s');
select is((select runs::text || ' ' || distance_km::text from public.weekly_runs where week_start = '2026-03-09'), '1 6.00', 'the week of 9 March has one run of 6 km');

-- Runs are on the calendar and count for the streak; another user sees none of this.
select is((select count(*) from public.workout_calendar where kind = 'run'), 8::bigint, 'the calendar lists the 8 runs');
reset role;
select set_config('request.jwt.claims', '', true);
select public.submit_run(jsonb_build_object('source', 'google_health', 'external_id', 'today', 'user_id', '00000000-0000-0000-0000-0000000000a2',
  'started_at', now() - interval '1 hour', 'points', pg_temp.pts()));
select is((select week_streak::text || ' ' || sessions_this_week::text || ' ' || rest_days::text from public.training_streak where user_id = '00000000-0000-0000-0000-0000000000a2'),
          '1 1 ' || ((now() at time zone 'Europe/Berlin')::date - ((now() - interval '1 hour') at time zone 'Europe/Berlin')::date)::text,
          'a run this week alone gives a week streak of 1 and resets the rest days');
select is((select count(*) from pg_policies where tablename in ('runs', 'run_splits')), 2::bigint, 'row level security policies exist on runs and run_splits');

select * from finish();
rollback;
