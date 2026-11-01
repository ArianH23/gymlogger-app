-- workout_plan(routine_id): what a client should show when you start a routine.
--
-- It is the winning plan (a pending claude plan beats the rules plan), kept in step with the routine:
--  * if the routine's exercises were edited AFTER the plan was written, exercises that were removed are
--    dropped and, for a claude plan, exercises that were added are appended with the rules plan's targets;
--  * a claude plan written after the last edit is shown exactly as written (leaving an exercise out is then
--    a deliberate choice of the planner).
-- Claude's targets for the exercises that remain are never changed.

create function public.workout_plan(p_routine_id uuid)
returns table (
  exercise_id        uuid,
  exercise_position  integer,
  set_no             integer,
  target_weight_kg   numeric,
  target_reps_min    integer,
  target_reps_max    integer,
  note               text,
  source             text
)
language sql
stable
set search_path = ''
as $$
  with cur as (
    select c.id, c.created_by, c.created_at from public.current_plan c where c.routine_id = p_routine_id
  ),
  rx as (
    select x.exercise_id, x.position from public.routine_exercises x
    where x.routine_id = p_routine_id and x.deleted_at is null
  ),
  edited as (
    select max(x.updated_at) as at from public.routine_exercises x where x.routine_id = p_routine_id
  ),
  stale as (   -- the winning plan was written before the routine's exercises were last edited
    select coalesce((select cur.created_at < edited.at from cur, edited), false) as is_stale,
           coalesce((select cur.created_by = 'claude' from cur), false) as is_claude
  ),
  base as (
    select ps.exercise_id, ps.exercise_position, ps.set_no, ps.target_weight_kg, ps.target_reps_min,
           ps.target_reps_max, ps.note, cur.created_by as source
    from cur
    join public.planned_sets ps on ps.planned_session_id = cur.id
    where not (select is_stale from stale)
       or exists (select 1 from rx where rx.exercise_id = ps.exercise_id)
  ),
  rules_plan as (
    select p.id from public.planned_sessions p
    where p.routine_id = p_routine_id and p.created_by = 'rules' and p.status = 'pending'
    order by p.created_at desc limit 1
  ),
  extra as (   -- routine exercises the stale claude plan doesn't know about
    select ps.exercise_id,
           (select coalesce(max(b.exercise_position), 0) from base b)
             + (dense_rank() over (order by rx.position))::integer as exercise_position,
           ps.set_no, ps.target_weight_kg, ps.target_reps_min, ps.target_reps_max, ps.note,
           'rules'::text as source
    from rx
    join rules_plan r on true
    join public.planned_sets ps on ps.planned_session_id = r.id and ps.exercise_id = rx.exercise_id
    where (select is_stale and is_claude from stale)
      and not exists (select 1 from base b where b.exercise_id = rx.exercise_id)
  )
  select * from base
  union all
  select * from extra
  order by exercise_position, set_no
$$;

comment on function public.workout_plan(uuid) is
  'The plan to show when starting a routine: the pending claude plan if there is one, else the rules plan, kept in step with later edits to the routine (removed exercises dropped, added ones appended from the rules plan). One row per planned set.';

revoke execute on function public.workout_plan(uuid) from public, anon;
grant  execute on function public.workout_plan(uuid) to authenticated;
