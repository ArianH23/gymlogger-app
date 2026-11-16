-- Heart rate per set, worked out from what is already stored: the session's heart-rate track (one value every 10 seconds)
-- and the time each set was logged. Nothing new is recorded.
--
-- A set is logged just after it is done, and the heart rate peaks at the end of the effort or a little after. So:
--   peak      = the highest value from 60 seconds before the set was logged to 20 seconds after
--   rest low  = the lowest value after that, until 60 seconds before the next set is logged (5 minutes at most)
--   drop      = peak - rest low: how far the heart rate came down during the rest
-- The two sides of a left/right set are one set here: from the first side logged to the last.

create view public.set_heart_rate with (security_invoker = true) as
with grouped as (
  select s.user_id, s.session_id, s.exercise_id, s.set_no,
         bool_or(s.is_warmup) as is_warmup,
         min(s.logged_at)     as first_logged,
         max(s.logged_at)     as last_logged
  from public.sets s
  where s.deleted_at is null
  group by s.user_id, s.session_id, s.exercise_id, s.set_no
),
timed as (
  select g.*,
         extract(epoch from g.first_logged - ss.started_at) as t0,
         extract(epoch from g.last_logged - ss.started_at)  as t1,
         extract(epoch from lead(g.first_logged) over (partition by g.session_id order by g.first_logged, g.exercise_id, g.set_no) - ss.started_at) as next_t0,
         ss.hr_track
  from grouped g
  join public.sessions ss on ss.id = g.session_id
  where ss.deleted_at is null
    and ss.hr_track is not null
    -- a set added afterwards by editing the session has no real time: leave it out
    and g.first_logged >= ss.started_at
    and (ss.ended_at is null or g.last_logged <= ss.ended_at)
)
select t.user_id,
       t.session_id,
       t.exercise_id,
       t.set_no,
       t.is_warmup,
       t.last_logged                 as logged_at,
       hr.peak_bpm,
       hr.rest_low_bpm,
       hr.peak_bpm - hr.rest_low_bpm as drop_bpm
from timed t
cross join lateral (
  select max((p ->> 1)::integer) filter (where (p ->> 0)::numeric between t.t0 - 60 and t.t1 + 20) as peak_bpm,
         min((p ->> 1)::integer) filter (where (p ->> 0)::numeric > t.t1 + 20
                                           and (p ->> 0)::numeric <= least(coalesce(t.next_t0 - 60, t.t1 + 300), t.t1 + 300)) as rest_low_bpm
  from jsonb_array_elements(t.hr_track) p
) hr
where hr.peak_bpm is not null;

comment on view public.set_heart_rate is
  'Heart rate per set, for sessions where the watch recorded it: the peak around the set (from 60 s before it was logged to 20 s after) and the lowest value in the rest that followed (until 60 s before the next set is logged, 5 minutes at most). Left/right sides are one set. Sets with no heart-rate reading around them, and sets added later by editing, have no row. Context only: not a target.';
comment on column public.set_heart_rate.user_id is 'Owner.';
comment on column public.set_heart_rate.session_id is 'The session.';
comment on column public.set_heart_rate.exercise_id is 'The exercise.';
comment on column public.set_heart_rate.set_no is 'Set number within the exercise.';
comment on column public.set_heart_rate.is_warmup is 'true = warm-up set.';
comment on column public.set_heart_rate.logged_at is 'When the set was logged (the last side, for a left/right set).';
comment on column public.set_heart_rate.peak_bpm is 'Highest heart rate around the set.';
comment on column public.set_heart_rate.rest_low_bpm is 'Lowest heart rate in the rest after the set; null when the next set followed too soon to tell.';
comment on column public.set_heart_rate.drop_bpm is 'peak_bpm - rest_low_bpm: how far the heart rate fell during the rest. Null when rest_low_bpm is.';
