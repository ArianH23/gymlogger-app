-- Two fixes to submit_run found in testing:
--   * a single impossible heart rate (300 bpm from a sensor glitch) made the whole import fail on the 30 to 250 check; readings
--     outside that range are now left out, and the rest of the run is saved as usual.
--   * a file with no altitude was saved as "climbed 0 m" (a flat run); it now has no climb at all (null), as the app expects.
-- Nothing else changes: the function below is the one from the runs migration with those two lines different.

create or replace function public.submit_run(p_run jsonb) returns jsonb
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
           (p ->> 3)::numeric as alt, (p ->> 4)::numeric as dist,
           -- a heart rate that cannot be real (a sensor glitch: 300, 5) is left out instead of failing the whole import
           case when (p ->> 5)::numeric between 30 and 250 then (p ->> 5)::numeric end as hr
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
  -- The source's own total is the official distance (it is the number you saw in Strava or Google Health); the track is
  -- scaled to it, so the splits add up. Without one, the distance is measured along the track.
  -- When the track has no positions, or disagrees with that total by more than 20%, the GPS was not working: its positions
  -- say nothing reliable about pace, so a steady pace over the recorded time is assumed instead.
  v_dist := (p_run ->> 'distance_m')::numeric;
  if v_dist is null or v_dist <= 0 then
    if coalesce(v_track_d, 0) <= 0 then
      raise exception 'the points cover no distance, and no distance_m was given';
    end if;
    v_dist := v_track_d;
  end if;
  if coalesce(v_track_d, 0) <= 0 or abs(v_dist - v_track_d) / v_track_d > 0.2 then
    -- Assume a steady pace over the recorded time, pauses of more than 30 s left out.
    select jsonb_agg(x.obj || jsonb_build_object('d', v_dist * x.ct / nullif(x.total, 0), 'mt', x.ct) order by x.i), max(x.total)
      into v_pts, v_moving
    from (select (e ->> 'i')::integer as i, e as obj,
                 sum(case when (e ->> 'dt')::numeric <= 30 then (e ->> 'dt')::numeric else 0 end) over (order by (e ->> 'i')::integer) as ct,
                 sum(case when (e ->> 'dt')::numeric <= 30 then (e ->> 'dt')::numeric else 0 end) over () as total
          from jsonb_array_elements(v_pts) e) x;
    v_track_d := v_dist;
  end if;
  if coalesce(v_moving, 0) <= 0 then
    raise exception 'the points show no movement';
  end if;
  v_k := v_dist / v_track_d;
  v_elapsed := greatest(coalesce((p_run ->> 'elapsed_s')::numeric, 0), v_elapsed);

  -- Metres climbed: the source's number, else the rises of the smoothed altitude added up (an approximation).
  -- (null when the file has no altitude: that is not the same as a flat run)
  select coalesce((p_run ->> 'elevation_gain_m')::numeric, sum(case when alt is not null and prev_alt is not null then greatest(alt - prev_alt, 0) end))
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
  if v_run_id is null then
    -- The same run arriving from another source (the Strava history, then a Google Health file): a run of yours that starts
    -- within two minutes of this one is the same run, so it is updated instead of added twice.
    select id into v_run_id
    from public.runs
    where user_id = v_user and started_at between v_started - interval '2 minutes' and v_started + interval '2 minutes'
    order by abs(extract(epoch from (started_at - v_started)))
    limit 1;
  end if;
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
  'Saves a run from its points (see the comment above the function for the JSON). Computes distance (the source''s own total when given, else along the track; when the GPS did not work a steady pace is assumed), moving time (pauses and standing still left out), elevation gain (null without altitude), heart rate (readings under 30 or over 250 are ignored), a thinned track and one split per kilometre. The same source and external_id again, or a run starting within two minutes of an existing one, updates that run instead of adding a second. Returns {run_id, created, distance_m, moving_s, elapsed_s}.';
