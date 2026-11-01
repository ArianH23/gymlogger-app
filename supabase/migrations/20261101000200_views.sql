-- Read-only views shared by every client. security_invoker = true makes them obey the caller's RLS.

-- last_performance: for each exercise, the working sets of the most recent finished session that
-- contained it (any session: routine, variant or legacy). One row per set number; for left/right
-- exercises the two sides are merged into one row.
create view public.last_performance with (security_invoker = true) as
with latest as (
  select distinct on (s.exercise_id) s.exercise_id, s.session_id
  from public.sets s
  join public.sessions ss on ss.id = s.session_id
  where s.deleted_at is null and ss.deleted_at is null
    and not s.is_warmup
    and ss.ended_at is not null
  order by s.exercise_id, ss.started_at desc
)
select
  l.exercise_id,
  e.name                                         as exercise_name,
  l.session_id,
  ss.started_at                                  as session_started_at,
  s.set_no,
  max(s.weight_kg)                               as weight_kg,
  max(s.reps) filter (where s.side = 'L')        as reps_l,
  max(s.reps) filter (where s.side = 'R')        as reps_r,
  case when bool_or(s.side is not null)
       then least(max(s.reps) filter (where s.side = 'L'), max(s.reps) filter (where s.side = 'R'))
       else max(s.reps)
  end                                            as reps_result
from latest l
join public.exercises e  on e.id = l.exercise_id
join public.sessions  ss on ss.id = l.session_id
join public.sets      s  on s.session_id = l.session_id and s.exercise_id = l.exercise_id
where s.deleted_at is null and not s.is_warmup
group by l.exercise_id, e.name, l.session_id, ss.started_at, s.set_no;

comment on view public.last_performance is
  'Most recent finished session per exercise: its working sets (no warm-ups), one row per set number, left/right sides merged.';
comment on column public.last_performance.exercise_id is 'Exercise.';
comment on column public.last_performance.exercise_name is 'Exercise name.';
comment on column public.last_performance.session_id is 'The session these sets come from.';
comment on column public.last_performance.session_started_at is 'When that session started.';
comment on column public.last_performance.set_no is 'Set number within the exercise (1, 2, 3...).';
comment on column public.last_performance.weight_kg is 'Load used (pair total for dumbbell pairs, assistance for assisted). If L and R differ, the higher.';
comment on column public.last_performance.reps_l is 'Reps on the left side (left/right exercises only, otherwise null).';
comment on column public.last_performance.reps_r is 'Reps on the right side (left/right exercises only, otherwise null).';
comment on column public.last_performance.reps_result is 'Result used for progression: the LOWER of L and R for left/right exercises, otherwise the reps. If only one side was logged, that side.';

-- current_plan: for each routine, the pending plan the app should show. A pending Claude plan wins
-- over a pending rules plan; within the same author the newest wins.
create view public.current_plan with (security_invoker = true) as
select distinct on (ps.routine_id) ps.*
from public.planned_sessions ps
where ps.status = 'pending'
order by ps.routine_id, (ps.created_by = 'claude') desc, ps.created_at desc;

comment on view public.current_plan is
  'One row per routine: the pending planned_session to show. A pending claude plan beats a pending rules plan. Targets are in planned_sets.';
