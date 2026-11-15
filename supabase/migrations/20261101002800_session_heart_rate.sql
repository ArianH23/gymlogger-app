-- Heart rate during a gym session, recorded by the watch while the workout is open on it and sent at the end.

alter table public.sessions
  add column avg_hr_bpm integer check (avg_hr_bpm between 30 and 250),
  add column max_hr_bpm integer check (max_hr_bpm between 30 and 250),
  add column hr_track   jsonb;

comment on column public.sessions.avg_hr_bpm is 'Average heart rate during the session, if the watch recorded it.';
comment on column public.sessions.max_hr_bpm is 'Highest heart rate during the session, if the watch recorded it.';
comment on column public.sessions.hr_track is 'Heart rate over the session, one value every 10 seconds: arrays of [seconds from the start, bpm]. Written by submit_session_hr.';

-- Saves the heart rate of a session. p_samples: [[seconds from the start of the session, bpm], ...] in any order.
-- The watch sends everything it has each time, so calling this again replaces what was there.
create function public.submit_session_hr(p_session_id uuid, p_samples jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_track jsonb;
  v_n     integer;
  v_avg   numeric;
  v_max   numeric;
begin
  if not exists (select 1 from public.sessions where id = p_session_id and deleted_at is null) then
    raise exception 'session % not found', p_session_id;
  end if;
  if jsonb_typeof(p_samples) is distinct from 'array' then
    raise exception 'samples must be an array of [seconds from the start, bpm]';
  end if;

  -- Keep readings that make sense (30 to 250 bpm, within a day of the start), then one value per 10 seconds.
  with ok as (
    select (s ->> 0)::numeric as t, (s ->> 1)::numeric as bpm
    from jsonb_array_elements(p_samples) s
    where jsonb_typeof(s) = 'array' and jsonb_typeof(s -> 0) = 'number' and jsonb_typeof(s -> 1) = 'number'
  ),
  good as (
    select t, bpm from ok where bpm between 30 and 250 and t between 0 and 86400
  ),
  buckets as (
    select floor(t / 10) * 10 as t, round(avg(bpm)) as bpm from good group by floor(t / 10)
  )
  select (select jsonb_agg(jsonb_build_array(t, bpm) order by t) from buckets),
         (select count(*) from good), (select avg(bpm) from good), (select max(bpm) from good)
    into v_track, v_n, v_avg, v_max;

  if v_n = 0 then
    return jsonb_build_object('samples', 0);   -- nothing usable: what was there stays
  end if;

  update public.sessions
     set avg_hr_bpm = round(v_avg), max_hr_bpm = round(v_max), hr_track = v_track
   where id = p_session_id;

  return jsonb_build_object('samples', v_n, 'avg_hr_bpm', round(v_avg), 'max_hr_bpm', round(v_max));
end;
$$;

comment on function public.submit_session_hr(uuid, jsonb) is
  'Saves the heart rate the watch recorded during a session: samples as [[seconds from the start, bpm], ...]. Stores the average, the highest, and one value per 10 seconds. Readings outside 30-250 bpm are ignored. Calling it again replaces the earlier heart rate. Returns {samples, avg_hr_bpm, max_hr_bpm}.';
revoke execute on function public.submit_session_hr(uuid, jsonb) from public, anon;
grant  execute on function public.submit_session_hr(uuid, jsonb) to authenticated;
