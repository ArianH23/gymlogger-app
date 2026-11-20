-- Volume without assistance. On an assisted exercise (assisted chin-up) the weight is the help you were given, so it is not
-- load you lifted: counting it made a session with a chin-up look bigger than it was (and a routine's "volume change" wrong,
-- because the session page already left it out). exercise_session_stats now gives no volume for an assisted exercise, the way it
-- already gives none for a bodyweight one, so the weekly overview, the session scores and the routine page all agree.
-- Nothing else changes: the view below is the one from the exercise stats migration with the two volume lines different.

create or replace view public.exercise_session_stats with (security_invoker = true) as
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
  -- On an assisted exercise the weight is the help you were given, not load you lifted: it adds no volume.
  case when e.load_type <> 'assisted' then max(r.weight_kg * r.reps) end as best_set_volume_kg,
  case when e.load_type <> 'assisted' then sum(r.weight_kg * r.reps) end as session_volume_kg
from public.exercise_set_results r
join public.exercises e on e.id = r.exercise_id
group by r.exercise_id, r.session_id, r.started_at, e.load_type;

comment on column public.exercise_session_stats.best_set_volume_kg is 'Highest weight x reps of a single set. Null for assisted and bodyweight exercises.';
comment on column public.exercise_session_stats.session_volume_kg is 'Sum of weight x reps over all working sets. Null for assisted and bodyweight exercises (assistance is not load that was lifted).';
