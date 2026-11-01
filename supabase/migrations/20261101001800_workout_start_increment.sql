-- workout_start now also returns each exercise's increment_kg (null if it has none). The watch uses it as the step of its weight wheel,
-- so a crown turn moves 4 kg on a dumbbell pair, 2.5 kg where no step is set, and so on. Nothing else about the function changes.

create or replace function public.workout_start(p_routine_id uuid) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_routine   record;
  v_plan      record;
  v_exercises jsonb;
begin
  select r.id, r.name into v_routine
  from public.routines r
  where r.id = p_routine_id and r.deleted_at is null;
  if not found then
    raise exception 'routine % not found', p_routine_id;
  end if;

  select c.created_by, c.notes into v_plan from public.current_plan c where c.routine_id = p_routine_id;

  with plan_sets as (
    select w.exercise_id, w.exercise_position as pos, w.set_no, w.target_weight_kg, w.target_reps_min,
           w.target_reps_max, w.note
    from public.workout_plan(p_routine_id) w
  ),
  fallback as (
    select x.exercise_id, x.position as pos, g.n as set_no, null::numeric as target_weight_kg,
           null::integer as target_reps_min, null::integer as target_reps_max, null::text as note
    from public.routine_exercises x
    cross join lateral generate_series(1, x.target_sets) as g (n)
    where x.routine_id = p_routine_id and x.deleted_at is null
      and not exists (select 1 from plan_sets)
  ),
  all_sets as (
    select * from plan_sets
    union all
    select * from fallback
  ),
  per_exercise as (
    select s.exercise_id, min(s.pos) as pos,
           jsonb_agg(jsonb_build_object('set_no', s.set_no, 'target_weight_kg', s.target_weight_kg,
                                        'target_reps_min', s.target_reps_min, 'target_reps_max', s.target_reps_max,
                                        'note', s.note) order by s.set_no) as sets
    from all_sets s
    group by s.exercise_id
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'exercise_id', e.id, 'name', e.name, 'load_type', e.load_type,
             'unilateral', e.unilateral, 'dumbbell_pair', e.dumbbell_pair, 'increment_kg', e.increment_kg,
             'sets', p.sets,
             'last', coalesce((select jsonb_agg(jsonb_build_object('set_no', l.set_no, 'weight_kg', l.weight_kg,
                                                                    'reps_l', l.reps_l, 'reps_r', l.reps_r,
                                                                    'reps_result', l.reps_result) order by l.set_no)
                               from public.last_performance l where l.exercise_id = e.id), '[]'::jsonb)
           ) order by p.pos), '[]'::jsonb)
    into v_exercises
  from per_exercise p
  join public.exercises e on e.id = p.exercise_id and e.deleted_at is null;

  return jsonb_build_object(
    'routine_id', v_routine.id,
    'routine_name', v_routine.name,
    'plan_by', v_plan.created_by,
    'plan_notes', case when v_plan.created_by = 'claude' then v_plan.notes end,
    'exercises', v_exercises);
end;
$$;

comment on function public.workout_start(uuid) is
  'Everything needed to start a workout on a routine in one call: exercises in plan order (with their increment_kg, the step for changing weight) with their planned sets (targets, notes) and what was done last time. Plan = the winning plan kept in step with routine edits, or the routine''s own exercises if there is none.';
