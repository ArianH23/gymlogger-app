-- A backup for an exercise of a routine: what to do instead when the machine is taken. The watch and the phone offer
-- it with one tap while nothing is logged for the planned exercise yet.
--   * routine_exercises.backup_exercise_id: the backup (optional)
--   * workout_start returns each exercise's backup, ready to use: its sets start from what was done last time
--   * routine_backups(routine): the same backups keyed by exercise, for the phone (which builds its plan from workout_plan)
--   * session_swaps: written when the session is finished, so a planned exercise that was swapped is not scored as skipped

alter table public.routine_exercises
  add column backup_exercise_id uuid references public.exercises (id),
  add constraint routine_exercises_backup_differs check (backup_exercise_id is null or backup_exercise_id <> exercise_id);
comment on column public.routine_exercises.backup_exercise_id is
  'Optional backup exercise: done instead of this one when the machine is taken. It is not planned; its sets start from what was done last time.';

create table public.session_swaps (
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id         uuid not null references public.sessions (id) on delete cascade,
  exercise_id        uuid not null references public.exercises (id),
  backup_exercise_id uuid not null references public.exercises (id),
  created_at         timestamptz not null default now(),
  primary key (session_id, exercise_id)
);
alter table public.session_swaps enable row level security;
create policy session_swaps_own_rows on public.session_swaps for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
comment on table public.session_swaps is
  'Sessions where a planned exercise was replaced by its backup (nothing logged for the planned one, sets logged for the backup). Written by finish_session. The planned exercise is left out of that session''s score, and it was not skipped: progress it from its own last session.';
comment on column public.session_swaps.user_id is 'Owner. RLS restricts every row to this user.';
comment on column public.session_swaps.session_id is 'The session.';
comment on column public.session_swaps.exercise_id is 'The planned exercise that was not done.';
comment on column public.session_swaps.backup_exercise_id is 'The backup that was done instead.';
comment on column public.session_swaps.created_at is 'When the swap was recorded (at the end of the session).';

-- One exercise as a ready-to-use plan entry with p_sets sets, each starting from what was done last time
-- (the same set number, or the last set there was). Without history the sets have no targets.
create function public.backup_exercise_plan(p_exercise_id uuid, p_sets integer) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'exercise_id', e.id, 'name', e.name, 'load_type', e.load_type,
    'unilateral', e.unilateral, 'dumbbell_pair', e.dumbbell_pair, 'increment_kg', e.increment_kg,
    'sets', (select jsonb_agg(jsonb_build_object(
                      'set_no', g.n, 'target_weight_kg', l.weight_kg, 'target_reps_min', l.reps_result, 'target_reps_max', null,
                      'note', case when g.n = 1 and l.set_no is not null then 'Same as last time' end) order by g.n)
             from generate_series(1, greatest(p_sets, 1)) as g (n)
             left join lateral (select lp.set_no, lp.weight_kg, lp.reps_result
                                from public.last_performance lp
                                where lp.exercise_id = e.id and lp.set_no <= g.n
                                order by lp.set_no desc limit 1) l on true),
    'last', coalesce((select jsonb_agg(jsonb_build_object('set_no', l.set_no, 'weight_kg', l.weight_kg,
                                                           'reps_l', l.reps_l, 'reps_r', l.reps_r,
                                                           'reps_result', l.reps_result) order by l.set_no)
                      from public.last_performance l where l.exercise_id = e.id), '[]'::jsonb))
  from public.exercises e
  where e.id = p_exercise_id and e.deleted_at is null
$$;
comment on function public.backup_exercise_plan(uuid, integer) is
  'One exercise as a plan entry in the shape workout_start uses (exercise fields, sets, last), with the given number of sets. Each set starts from what was done last time (weight, and the reps reached as the minimum); no targets without history. Null if the exercise does not exist.';
revoke execute on function public.backup_exercise_plan(uuid, integer) from public, anon;
grant  execute on function public.backup_exercise_plan(uuid, integer) to authenticated;

-- workout_start: the same as before, plus 'backup' on each exercise (null when it has none).
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
                               from public.last_performance l where l.exercise_id = e.id), '[]'::jsonb),
             -- the backup, with as many sets as this exercise has; not offered if it is already one of the workout's exercises
             'backup', (select public.backup_exercise_plan(x.backup_exercise_id, jsonb_array_length(p.sets))
                        from public.routine_exercises x
                        where x.routine_id = p_routine_id and x.exercise_id = e.id and x.deleted_at is null
                          and x.backup_exercise_id is not null
                          and not exists (select 1 from per_exercise q where q.exercise_id = x.backup_exercise_id))
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
  'Everything needed to start a workout on a routine in one call: exercises in plan order (with their increment_kg, the step for changing weight) with their planned sets (targets, notes), what was done last time, and their backup exercise if they have one (same shape, sets starting from last time; null otherwise). Plan = the winning plan kept in step with routine edits, or the routine''s own exercises if there is none.';

-- The backups of a routine keyed by the exercise they stand in for: {"<exercise id>": {backup plan entry}, ...}.
create function public.routine_backups(p_routine_id uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(e ->> 'exercise_id', e -> 'backup'), '{}'::jsonb)
  from jsonb_array_elements(public.workout_start(p_routine_id) -> 'exercises') e
  where jsonb_typeof(e -> 'backup') = 'object'
$$;
comment on function public.routine_backups(uuid) is
  'The backup exercises of a routine, keyed by the id of the exercise each stands in for, in the same shape workout_start gives them. {} when the routine has none.';
revoke execute on function public.routine_backups(uuid) from public, anon;
grant  execute on function public.routine_backups(uuid) to authenticated;

-- finish_session: as before, and it records which planned exercises were replaced by their backup.
create or replace function public.finish_session(p_session_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_routine_id uuid;
  v_ended      timestamptz;
  v_marked     integer := 0;
  v_rules_plan uuid;
begin
  update public.sessions
     set ended_at = coalesce(ended_at, now())
   where id = p_session_id and deleted_at is null
  returning routine_id, ended_at into v_routine_id, v_ended;
  if not found then
    raise exception 'session % not found', p_session_id;
  end if;

  if v_routine_id is not null then
    update public.planned_sessions
       set status = 'used', used_by_session_id = p_session_id
     where routine_id = v_routine_id and status = 'pending' and created_at <= v_ended;
    get diagnostics v_marked = row_count;

    -- a planned exercise with nothing logged, whose backup has sets in this session, was swapped
    insert into public.session_swaps (user_id, session_id, exercise_id, backup_exercise_id)
    select x.user_id, p_session_id, x.exercise_id, x.backup_exercise_id
    from public.routine_exercises x
    where x.routine_id = v_routine_id and x.deleted_at is null and x.backup_exercise_id is not null
      and not exists (select 1 from public.sets s where s.session_id = p_session_id and s.exercise_id = x.exercise_id and s.deleted_at is null)
      and exists (select 1 from public.sets s where s.session_id = p_session_id and s.exercise_id = x.backup_exercise_id and s.deleted_at is null)
    on conflict do nothing;

    v_rules_plan := public.generate_plan(v_routine_id);
  end if;

  return jsonb_build_object('session_id', p_session_id, 'routine_id', v_routine_id,
                            'plans_marked_used', v_marked, 'rules_plan_id', v_rules_plan);
end;
$$;

comment on function public.finish_session(uuid) is
  'Call when a workout ends: sets ended_at if empty, marks the plans that were pending for the routine as used, records the planned exercises that were replaced by their backup (session_swaps), and generates the new rules plan. Safe to call twice.';

-- The score: a planned exercise that was replaced by its backup is left out, instead of counting as sets not done.
create or replace view public.session_plan_performance with (security_invoker = true) as
with followed as (
  select distinct on (p.used_by_session_id) p.id as plan_id, p.used_by_session_id as session_id
  from public.planned_sessions p
  where p.used_by_session_id is not null
  order by p.used_by_session_id, (p.created_by = 'claude') desc, p.created_at desc
)
select
  f.session_id,
  ss.started_at,
  count(*)        as planned_sets,
  count(r.reps)   as done_sets,
  count(*) filter (
    where r.reps is not null
      and (ps.target_reps_min is null or r.reps >= ps.target_reps_min)
      and (ps.target_weight_kg is null or r.weight_kg is null
           or case when e.load_type = 'assisted' then r.weight_kg <= ps.target_weight_kg
                   else r.weight_kg >= ps.target_weight_kg end)
  )               as met_sets
from followed f
join public.planned_sets ps on ps.planned_session_id = f.plan_id
join public.exercises e on e.id = ps.exercise_id
join public.sessions ss on ss.id = f.session_id and ss.deleted_at is null and ss.ended_at is not null
left join public.exercise_set_results r
  on r.session_id = f.session_id and r.exercise_id = ps.exercise_id and r.set_no = ps.set_no
where not exists (select 1 from public.session_swaps w where w.session_id = f.session_id and w.exercise_id = ps.exercise_id)
group by f.session_id, ss.started_at;

comment on view public.session_plan_performance is
  'Per session that followed a plan: how many planned sets, how many were done, and how many met the plan (planned reps at the planned weight or better). The sets of a planned exercise that was replaced by its backup (session_swaps) are left out. Only sessions logged in the app have a plan.';
