-- Exercise statistics for the app (charts, records, exercise list), computed once here so every client
-- (phone app, future watch, Claude) shows the same numbers.
-- Same conventions as everywhere else: working sets only (no warm-ups), finished sessions only,
-- left/right sets merged to the LOWER side, dumbbell-pair weights are the PAIR TOTAL, assisted
-- exercises are better with LOWER weight.

-- One row per working set.
create view public.exercise_set_results with (security_invoker = true) as
select
  s.exercise_id,
  s.session_id,
  ss.started_at,
  s.set_no,
  max(s.weight_kg) as weight_kg,
  case when bool_or(s.side is not null)
       then least(max(s.reps) filter (where s.side = 'L'), max(s.reps) filter (where s.side = 'R'))
       else max(s.reps)
  end as reps
from public.sets s
join public.sessions ss on ss.id = s.session_id
where s.deleted_at is null and ss.deleted_at is null and not s.is_warmup and ss.ended_at is not null
group by s.exercise_id, s.session_id, ss.started_at, s.set_no;

comment on view public.exercise_set_results is
  'One row per working set (no warm-ups, finished sessions only), left/right merged to the lower reps.';
comment on column public.exercise_set_results.exercise_id is 'Exercise.';
comment on column public.exercise_set_results.session_id is 'Session the set belongs to.';
comment on column public.exercise_set_results.started_at is 'When the session started.';
comment on column public.exercise_set_results.set_no is 'Set number within the exercise in that session.';
comment on column public.exercise_set_results.weight_kg is 'Load (pair total for dumbbell pairs, assistance for assisted). Null for bodyweight.';
comment on column public.exercise_set_results.reps is 'Reps; for left/right sets the lower of the two sides.';

-- One row per exercise per session: the numbers the charts plot.
create view public.exercise_session_stats with (security_invoker = true) as
select
  r.exercise_id,
  r.session_id,
  r.started_at,
  count(*)                                                        as sets,
  sum(r.reps)                                                     as total_reps,
  max(r.reps)                                                     as best_reps,
  case when e.load_type = 'assisted' then min(r.weight_kg) else max(r.weight_kg) end as best_weight_kg,
  -- Epley estimate from sets of up to 12 reps (higher rep counts make the estimate unreliable).
  case when e.load_type = 'weighted'
       then max(case when r.reps = 1 then r.weight_kg
                     when r.reps <= 12 then r.weight_kg * (1 + r.reps / 30.0) end)
  end                                                             as est_1rm_kg,
  max(r.weight_kg * r.reps)                                       as best_set_volume_kg,
  sum(r.weight_kg * r.reps)                                       as session_volume_kg
from public.exercise_set_results r
join public.exercises e on e.id = r.exercise_id
group by r.exercise_id, r.session_id, r.started_at, e.load_type;

comment on view public.exercise_session_stats is
  'Per exercise and session: heaviest weight (lowest assistance for assisted exercises), estimated 1RM, best set volume, session volume, reps. Working sets only.';
comment on column public.exercise_session_stats.sets is 'Number of working sets.';
comment on column public.exercise_session_stats.total_reps is 'Sum of reps over the working sets.';
comment on column public.exercise_session_stats.best_reps is 'Most reps in one set.';
comment on column public.exercise_session_stats.best_weight_kg is 'Heaviest weight used; for assisted exercises the LOWEST assistance. Pair total for dumbbell pairs.';
comment on column public.exercise_session_stats.est_1rm_kg is 'Estimated one-rep max (Epley) from the best set of up to 12 reps. Only for weighted exercises, null otherwise.';
comment on column public.exercise_session_stats.best_set_volume_kg is 'Highest weight x reps of a single set.';
comment on column public.exercise_session_stats.session_volume_kg is 'Sum of weight x reps over all working sets.';

-- Best reps for every weight used, with the date it happened.
create view public.exercise_best_reps_by_weight with (security_invoker = true) as
select distinct on (exercise_id, weight_kg)
  exercise_id, weight_kg, reps, started_at
from public.exercise_set_results
where weight_kg is not null and reps is not null
order by exercise_id, weight_kg, reps desc, started_at desc;

comment on view public.exercise_best_reps_by_weight is
  'For each exercise and weight used: the most reps ever done at that weight, and the latest date it was done.';
comment on column public.exercise_best_reps_by_weight.weight_kg is 'The weight.';
comment on column public.exercise_best_reps_by_weight.reps is 'Most reps ever done at that weight.';
comment on column public.exercise_best_reps_by_weight.started_at is 'Start of the most recent session that reached that rep count.';

-- One row per exercise for the Exercises tab.
create view public.exercise_summary with (security_invoker = true) as
select
  e.id as exercise_id,
  count(distinct st.session_id)  as sessions,
  max(st.started_at)             as last_performed_at,
  case when e.load_type = 'assisted' then min(st.best_weight_kg) else max(st.best_weight_kg) end as best_weight_kg
from public.exercises e
left join public.exercise_session_stats st on st.exercise_id = e.id
where e.deleted_at is null
group by e.id, e.load_type;

comment on view public.exercise_summary is
  'One row per exercise: how many sessions it appears in, when it was last done, and its best weight (lowest assistance for assisted).';
comment on column public.exercise_summary.sessions is 'Number of finished sessions containing the exercise.';
comment on column public.exercise_summary.last_performed_at is 'Start of the latest session containing it, or null if never done.';
comment on column public.exercise_summary.best_weight_kg is 'All-time best weight; null if never done or bodyweight.';
