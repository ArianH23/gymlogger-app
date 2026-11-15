-- Runs. A run is imported from a file (the Strava history, or a TCX exported from Google Health): nothing plans them.
-- submit_run is the single way a run is saved, so every source gets the same distance, moving time, splits and elevation.

-- Distance in metres between two points on the earth (0 if a coordinate is missing).
create function public.haversine_m(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric) returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when lat1 is null or lon1 is null or lat2 is null or lon2 is null then 0
              else (2 * 6371000 * asin(least(1, sqrt(
                     power(sin(radians(lat2 - lat1) / 2), 2)
                     + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)))))::numeric
         end
$$;
comment on function public.haversine_m(numeric, numeric, numeric, numeric) is 'Great-circle distance in metres between two latitude/longitude points; 0 if any coordinate is missing.';
revoke execute on function public.haversine_m(numeric, numeric, numeric, numeric) from public, anon;
grant  execute on function public.haversine_m(numeric, numeric, numeric, numeric) to authenticated;

create table public.runs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source           text not null check (source in ('strava_import', 'google_health', 'tcx_file')),
  external_id      text not null,
  title            text not null default 'Run',
  started_at       timestamptz not null,
  elapsed_s        integer not null check (elapsed_s > 0),
  moving_s         integer not null check (moving_s > 0),
  distance_m       numeric(8, 1) not null check (distance_m > 0),
  elevation_gain_m numeric(6, 1),
  avg_hr_bpm       integer check (avg_hr_bpm between 30 and 250),
  max_hr_bpm       integer check (max_hr_bpm between 30 and 250),
  calories_kcal    integer check (calories_kcal >= 0),
  notes            text,
  track            jsonb not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (user_id, source, external_id)
);
create trigger runs_set_updated_at before update on public.runs
  for each row execute function public.set_updated_at();
alter table public.runs enable row level security;
create policy runs_own_rows on public.runs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create index runs_user_started on public.runs (user_id, started_at desc);

comment on table public.runs is 'Runs imported from a file. Written only by submit_run, which computes the numbers; the app may edit title and notes or soft-delete.';
comment on column public.runs.id is 'Run id.';
comment on column public.runs.user_id is 'Owner. RLS restricts every row to this user.';
comment on column public.runs.source is 'Where it came from: strava_import, google_health, or tcx_file (a TCX from another device).';
comment on column public.runs.external_id is 'The id in the source (Strava activity id, or the TCX activity id). Unique per user and source, so importing a run again updates it.';
comment on column public.runs.title is 'Name shown in the app.';
comment on column public.runs.started_at is 'When the run started.';
comment on column public.runs.elapsed_s is 'Seconds from start to end, pauses included.';
comment on column public.runs.moving_s is 'Seconds actually moving (pauses and standing still left out). Pace is based on this.';
comment on column public.runs.distance_m is 'Distance in metres: the source''s own total when it gives one, else measured along the track.';
comment on column public.runs.elevation_gain_m is 'Metres climbed: the source''s number, or an approximation from the smoothed altitude.';
comment on column public.runs.avg_hr_bpm is 'Average heart rate, if the file has heart rate.';
comment on column public.runs.max_hr_bpm is 'Highest heart rate, if the file has heart rate.';
comment on column public.runs.calories_kcal is 'Calories as estimated by the source.';
comment on column public.runs.notes is 'Your notes.';
comment on column public.runs.track is 'The route, thinned to one point about every 5 seconds: arrays of [seconds from start, latitude, longitude, altitude m, distance m, heart rate].';
comment on column public.runs.created_at is 'Row creation time.';
comment on column public.runs.updated_at is 'Last change (server clock, set by trigger).';
comment on column public.runs.deleted_at is 'Soft delete marker.';

create table public.run_splits (
  run_id        uuid not null references public.runs (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  km            integer not null check (km > 0),
  distance_m    numeric(6, 1) not null check (distance_m > 0),
  seconds       numeric(7, 1) not null check (seconds >= 0),
  elev_change_m numeric(6, 1),
  avg_hr_bpm    integer,
  primary key (run_id, km)
);
alter table public.run_splits enable row level security;
create policy run_splits_own_rows on public.run_splits for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

comment on table public.run_splits is 'One row per kilometre of a run (the last one may be shorter). Written by submit_run.';
comment on column public.run_splits.run_id is 'The run.';
comment on column public.run_splits.user_id is 'Owner. RLS restricts every row to this user.';
comment on column public.run_splits.km is 'Which kilometre: 1 is the first.';
comment on column public.run_splits.distance_m is 'Length of this split: 1000, or less for the last one.';
comment on column public.run_splits.seconds is 'Moving time for this split.';
comment on column public.run_splits.elev_change_m is 'Altitude at the end minus at the start of the split (smoothed).';
comment on column public.run_splits.avg_hr_bpm is 'Average heart rate in the split, if recorded.';

-- Saves a run from its points. p_run:
--   {"source": "google_health", "external_id": "...", "started_at": "2026-07-18T07:28:41+02:00", "title": "Run" (optional),
--    "distance_m": 5020.8, "elapsed_s": 2016, "elevation_gain_m": 30, "calories": 533, "notes": "..." (all optional),
--    "points": [[seconds from start, latitude, longitude, altitude m, distance so far m, heart rate], ...]}
-- A point may leave out (null) anything but the time. Without "distance so far" the distance is measured between positions.
create function public.submit_run(p_run jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_user     uuid := coalesce(auth.uid(), nullif(p_run ->> 'user_id', '')::uuid);
  v_source   text := p_run ->> 'source';
  v_ext      text := nullif(trim(p_run ->> 'external_id'), '');
  v_started  timestamptz;
  v_pts      jsonb;
  v_n        integer;
  v_track_d  numeric;
  v_dist     numeric;
  v_k        numeric := 1;
  v_elapsed  numeric;
  v_moving   numeric;
  v_gain     numeric;
  v_avg_hr   numeric;
  v_max_hr   numeric;
  v_track    jsonb;
  v_run_id   uuid;
  v_created  boolean;
begin
  if v_user is null then
    raise exception 'no user: sign in, or give user_id when importing with the service key';
  end if;
  if v_source is null or v_source not in ('strava_import', 'google_health', 'tcx_file') then
    raise exception 'source must be strava_import, google_health or tcx_file';
  end if;
  if v_ext is null then
    raise exception 'external_id is required (the id of the run in its source)';
  end if;
  begin
    v_started := (p_run ->> 'started_at')::timestamptz;
  exception when others then
    raise exception 'started_at is not a valid time';
  end;
  if v_started is null then
    raise exception 'started_at is required';
  end if;
  if jsonb_typeof(p_run -> 'points') is distinct from 'array' or jsonb_array_length(p_run -> 'points') < 2 then
    raise exception 'a run needs at least 2 points';
  end if;

  -- Every point with its distance so far, its moving time so far and a smoothed altitude.
  with raw as (
    select ord::integer as i,
           (p ->> 0)::numeric as t, (p ->> 1)::numeric as lat, (p ->> 2)::numeric as lon,
           (p ->> 3)::numeric as alt, (p ->> 4)::numeric as dist, (p ->> 5)::numeric as hr
    from jsonb_array_elements(p_run -> 'points') with ordinality as e (p, ord)
  ),
  given as (select bool_and(dist is not null) as has_dist from raw),
  seg as (
    select r.*, lag(r.t) over w as pt, lag(r.lat) over w as plat, lag(r.lon) over w as plon, lag(r.dist) over w as pdist
    from raw r
    window w as (order by r.i)
  ),
  step as (
    select s.*,
           case when s.i = 1 then 0 else s.t - s.pt end as dt,
           case when s.i = 1 then 0
                when (select has_dist from given) then greatest(s.dist - s.pdist, 0)
                else public.haversine_m(s.plat, s.plon, s.lat, s.lon) end as dd
    from seg s
  ),
  cum as (
    select st.i, st.t, st.lat, st.lon, st.hr, st.dt,
           sum(st.dd) over (order by st.i) as d,
           -- moving: not a pause (a gap of more than 30 s) and faster than a slow shuffle (0.5 m/s)
           sum(case when st.dt > 0 and st.dt <= 30 and st.dd / nullif(st.dt, 0) >= 0.5 then st.dt else 0 end) over (order by st.i) as mt,
           avg(st.alt) over (order by st.i rows between 10 preceding and 10 following) as alt
    from step st
  )
  select jsonb_agg(jsonb_build_object('i', i, 't', t, 'lat', lat, 'lon', lon, 'hr', hr, 'dt', dt, 'd', d, 'mt', mt, 'alt', alt) order by i),
         count(*), max(d), max(t), max(mt), avg(hr), max(hr)
    into v_pts, v_n, v_track_d, v_elapsed, v_moving, v_avg_hr, v_max_hr
  from cum;

  if exists (select 1 from jsonb_array_elements(v_pts) e where e ->> 't' is null) then
    raise exception 'every point needs a time (seconds from the start)';
  end if;
  if exists (select 1 from jsonb_array_elements(v_pts) e where (e ->> 'dt')::numeric < 0) then
    raise exception 'the points must be in time order';
  end if;
  if coalesce(v_track_d, 0) <= 0 then
    raise exception 'the points cover no distance';
  end if;
  if coalesce(v_moving, 0) <= 0 then
    raise exception 'the points show no movement';
  end if;

  -- The source's own total is the official distance when it is close to the track (within 20%); the track is scaled to it.
  v_dist := (p_run ->> 'distance_m')::numeric;
  if v_dist is null or v_dist <= 0 or abs(v_dist - v_track_d) / v_track_d > 0.2 then
    v_dist := v_track_d;
  end if;
  v_k := v_dist / v_track_d;
  v_elapsed := greatest(coalesce((p_run ->> 'elapsed_s')::numeric, 0), v_elapsed);

  -- Metres climbed: the source's number, else the rises of the smoothed altitude added up (an approximation).
  select coalesce((p_run ->> 'elevation_gain_m')::numeric, sum(greatest(alt - prev_alt, 0)))
    into v_gain
  from (select x.alt, lag(x.alt) over (order by x.i) as prev_alt
        from jsonb_to_recordset(v_pts) as x (i integer, alt numeric)) a;

  -- The route, thinned to about one point every 5 seconds (always the first and the last).
  select jsonb_agg(jsonb_build_array(round(x.t), round(x.lat, 5), round(x.lon, 5), round(x.alt, 1), round(x.d * v_k), x.hr) order by x.i)
    into v_track
  from (select y.*, lag(y.t) over (order by y.i) as pt
        from jsonb_to_recordset(v_pts) as y (i integer, t numeric, lat numeric, lon numeric, alt numeric, d numeric, hr numeric)) x
  where x.i = 1 or x.i = v_n or floor(x.t / 5) <> floor(x.pt / 5);

  select id into v_run_id from public.runs where user_id = v_user and source = v_source and external_id = v_ext;
  v_created := v_run_id is null;
  if v_created then
    insert into public.runs (user_id, source, external_id, title, started_at, elapsed_s, moving_s, distance_m, elevation_gain_m,
                             avg_hr_bpm, max_hr_bpm, calories_kcal, notes, track)
    values (v_user, v_source, v_ext, coalesce(nullif(trim(p_run ->> 'title'), ''), 'Run'), v_started, round(v_elapsed), round(v_moving),
            round(v_dist, 1), round(v_gain, 1), round(v_avg_hr), round(v_max_hr), round((p_run ->> 'calories')::numeric),
            nullif(trim(p_run ->> 'notes'), ''), v_track)
    returning id into v_run_id;
  else
    -- Importing a run again refreshes its numbers and brings it back if it was deleted, but keeps your title and notes.
    update public.runs
       set started_at = v_started, elapsed_s = round(v_elapsed), moving_s = round(v_moving), distance_m = round(v_dist, 1),
           elevation_gain_m = round(v_gain, 1), avg_hr_bpm = round(v_avg_hr), max_hr_bpm = round(v_max_hr),
           calories_kcal = coalesce(round((p_run ->> 'calories')::numeric), calories_kcal), track = v_track, deleted_at = null
     where id = v_run_id;
    delete from public.run_splits where run_id = v_run_id;
  end if;

  -- One split per kilometre: when the (scaled) distance crosses each kilometre mark, read off the moving time and the altitude.
  with pts as (
    select x.i, x.d * v_k as d, x.mt, x.alt, x.hr
    from jsonb_to_recordset(v_pts) as x (i integer, d numeric, mt numeric, alt numeric, hr numeric)
  ),
  marks as (
    select k, least(k * 1000.0, v_dist) as mark from generate_series(1, ceil(v_dist / 1000.0)::integer) as k
  ),
  hit as (
    select m.k, m.mark, coalesce((select min(p.i) from pts p where p.d >= m.mark - 0.01), v_n) as i
    from marks m
  ),
  at_mark as (
    select h.k, h.mark, h.i,
           case when b.i is null or a.d = b.d then a.mt else b.mt + (h.mark - b.d) / (a.d - b.d) * (a.mt - b.mt) end as mt,
           case when b.i is null or a.d = b.d then a.alt else b.alt + (h.mark - b.d) / (a.d - b.d) * (a.alt - b.alt) end as alt
    from hit h
    join pts a on a.i = h.i
    left join pts b on b.i = h.i - 1
  ),
  spl as (
    select m.k, m.mark, m.i, m.mt, m.alt,
           lag(m.mark, 1, 0.0) over (order by m.k) as prev_mark,
           lag(m.mt, 1, 0.0) over (order by m.k) as prev_mt,
           lag(m.alt, 1, (select alt from pts where i = 1)) over (order by m.k) as prev_alt,
           lag(m.i, 1, 0) over (order by m.k) as prev_i
    from at_mark m
  )
  insert into public.run_splits (run_id, user_id, km, distance_m, seconds, elev_change_m, avg_hr_bpm)
  select v_run_id, v_user, s.k, round(s.mark - s.prev_mark, 1), round(greatest(s.mt - s.prev_mt, 0), 1), round(s.alt - s.prev_alt, 1),
         (select round(avg(p.hr)) from pts p where p.i > s.prev_i and p.i <= s.i)
  from spl s
  where s.mark - s.prev_mark >= 0.1;

  return jsonb_build_object('run_id', v_run_id, 'created', v_created, 'distance_m', round(v_dist, 1), 'moving_s', round(v_moving),
                            'elapsed_s', round(v_elapsed));
end;
$$;

comment on function public.submit_run(jsonb) is
  'Saves a run from its points (see the comment above the function for the JSON). Computes distance (the source''s total when given and close to the track, else along the track), moving time (pauses and standing still left out), elevation gain, heart rate, a thinned track and one split per kilometre. The same source and external_id again updates the run. Returns {run_id, created, distance_m, moving_s, elapsed_s}.';
revoke execute on function public.submit_run(jsonb) from public, anon;
grant  execute on function public.submit_run(jsonb) to authenticated;

-- One row per run with its pace: what lists and totals read (no track: fetch that from runs for one run).
create view public.run_summary with (security_invoker = true) as
select r.id as run_id,
       r.user_id,
       r.started_at,
       (r.started_at at time zone 'Europe/Berlin')::date as day,
       r.title,
       r.source,
       r.distance_m,
       round(r.distance_m / 1000, 2) as distance_km,
       r.moving_s,
       r.elapsed_s,
       round(r.moving_s / (r.distance_m / 1000), 1) as pace_s_per_km,
       r.elevation_gain_m,
       r.avg_hr_bpm,
       r.max_hr_bpm,
       r.calories_kcal,
       r.notes
from public.runs r
where r.deleted_at is null;

comment on view public.run_summary is 'One row per run: distance, moving and elapsed time, pace in seconds per km (moving time / distance), elevation gain, heart rate, calories.';
comment on column public.run_summary.run_id is 'The run.';
comment on column public.run_summary.user_id is 'Owner.';
comment on column public.run_summary.started_at is 'When it started.';
comment on column public.run_summary.day is 'The day it started, local time.';
comment on column public.run_summary.title is 'Name.';
comment on column public.run_summary.source is 'strava_import, google_health or tcx_file.';
comment on column public.run_summary.distance_m is 'Distance in metres.';
comment on column public.run_summary.distance_km is 'Distance in km, 2 decimals.';
comment on column public.run_summary.moving_s is 'Moving time in seconds.';
comment on column public.run_summary.elapsed_s is 'Elapsed time in seconds, pauses included.';
comment on column public.run_summary.pace_s_per_km is 'Pace: moving seconds per km.';
comment on column public.run_summary.elevation_gain_m is 'Metres climbed.';
comment on column public.run_summary.avg_hr_bpm is 'Average heart rate.';
comment on column public.run_summary.max_hr_bpm is 'Highest heart rate.';
comment on column public.run_summary.calories_kcal is 'Calories (the source''s estimate).';
comment on column public.run_summary.notes is 'Your notes.';

create view public.weekly_runs with (security_invoker = true) as
select user_id,
       date_trunc('week', day::timestamp)::date as week_start,
       count(*)::integer as runs,
       round(sum(distance_m) / 1000, 2) as distance_km,
       sum(moving_s)::integer as moving_s,
       round(sum(moving_s) / (sum(distance_m) / 1000), 1) as pace_s_per_km
from public.run_summary
group by user_id, date_trunc('week', day::timestamp)::date;
comment on view public.weekly_runs is 'Runs per week (Monday start, local time): how many, total km, total moving time and the overall pace.';
comment on column public.weekly_runs.user_id is 'Owner.';
comment on column public.weekly_runs.week_start is 'Monday of the week.';
comment on column public.weekly_runs.runs is 'Number of runs.';
comment on column public.weekly_runs.distance_km is 'Total distance in km.';
comment on column public.weekly_runs.moving_s is 'Total moving time in seconds.';
comment on column public.weekly_runs.pace_s_per_km is 'Overall pace: total moving seconds per km.';

create view public.monthly_runs with (security_invoker = true) as
select user_id,
       date_trunc('month', day::timestamp)::date as month_start,
       count(*)::integer as runs,
       round(sum(distance_m) / 1000, 2) as distance_km,
       sum(moving_s)::integer as moving_s,
       round(sum(moving_s) / (sum(distance_m) / 1000), 1) as pace_s_per_km
from public.run_summary
group by user_id, date_trunc('month', day::timestamp)::date;
comment on view public.monthly_runs is 'Runs per calendar month: how many, total km, total moving time and the overall pace.';
comment on column public.monthly_runs.user_id is 'Owner.';
comment on column public.monthly_runs.month_start is 'First day of the month.';
comment on column public.monthly_runs.runs is 'Number of runs.';
comment on column public.monthly_runs.distance_km is 'Total distance in km.';
comment on column public.monthly_runs.moving_s is 'Total moving time in seconds.';
comment on column public.monthly_runs.pace_s_per_km is 'Overall pace: total moving seconds per km.';

-- Your bests, one row each: the longest run, the fastest kilometre, and the fastest 5 km (five kilometres in a row within a run).
create view public.run_bests with (security_invoker = true) as
with full_splits as (
  select s.user_id, s.run_id, s.km, s.seconds,
         sum(s.seconds) over (partition by s.run_id order by s.km rows between current row and 4 following) as five_s,
         count(*) over (partition by s.run_id order by s.km rows between current row and 4 following) as five_n,
         max(s.km) over (partition by s.run_id order by s.km rows between current row and 4 following) as five_last
  from public.run_splits s
  join public.runs r on r.id = s.run_id and r.deleted_at is null
  where s.distance_m >= 999.5
),
candidates as (
  select user_id, 'best_1k'::text as kind, seconds as value, run_id from full_splits
  union all
  select user_id, 'best_5k', five_s, run_id from full_splits where five_n = 5 and five_last = km + 4
  union all
  select user_id, 'longest', -distance_m, id from public.runs where deleted_at is null
),
ranked as (
  select c.*, row_number() over (partition by c.user_id, c.kind order by c.value, c.run_id) as rn from candidates c
)
select k.user_id,
       k.kind,
       case when k.kind = 'longest' then -k.value else k.value end as value,
       case when k.kind = 'longest' then 'm' else 's' end as unit,
       k.run_id,
       (r.started_at at time zone 'Europe/Berlin')::date as day
from ranked k
join public.runs r on r.id = k.run_id
where k.rn = 1;

comment on view public.run_bests is 'Your running bests, one row each: best_1k (fastest full kilometre, seconds), best_5k (fastest five kilometres in a row inside one run, seconds), longest (metres). With the run and its day.';
comment on column public.run_bests.user_id is 'Owner.';
comment on column public.run_bests.kind is 'best_1k, best_5k or longest.';
comment on column public.run_bests.value is 'Seconds for best_1k and best_5k, metres for longest.';
comment on column public.run_bests.unit is 's or m.';
comment on column public.run_bests.run_id is 'The run it was set in.';
comment on column public.run_bests.day is 'The day of that run.';

-- The calendar now has runs too. training_streak reads this view, so a run keeps the week streak alive and resets the rest days.
create or replace view public.workout_calendar with (security_invoker = true) as
select s.user_id,
       (s.started_at at time zone 'Europe/Berlin')::date as day,
       s.id as session_id,
       s.title,
       s.started_at,
       'workout'::text as kind,
       null::uuid as run_id
from public.sessions s
where s.ended_at is not null and s.deleted_at is null
union all
select r.user_id,
       (r.started_at at time zone 'Europe/Berlin')::date,
       null::uuid,
       r.title,
       r.started_at,
       'run'::text,
       r.id
from public.runs r
where r.deleted_at is null;

comment on view public.workout_calendar is
  'One row per finished gym session and per run, with the calendar day (local time) and its kind. Several on one day give several rows.';
comment on column public.workout_calendar.session_id is 'The session (empty for a run).';
comment on column public.workout_calendar.kind is 'workout (a gym session) or run.';
comment on column public.workout_calendar.run_id is 'The run (empty for a gym session).';
comment on view public.training_streak is
  'Per user: the current week streak (weeks in a row with at least one finished workout or run, Monday to Sunday in local time; still alive during the current week), the best streak ever, the day of the last activity, the rest days since it, and the activities this week. No row until there is one.';
comment on column public.training_streak.sessions_this_week is 'Finished gym sessions and runs since Monday.';
