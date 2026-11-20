-- Replacing an exercise during a workout, and one call at a time per workout.
--
--  * Replace (phone, during a workout) put another exercise in an exercise's place, but the score still counted the replaced one as
--    not done (4 planned, 2 done: "50%") and Claude read it as skipped. The phone now sends which exercise took whose place
--    (sessions.replaced), and finish_session records it in session_swaps exactly like a "Machine taken?" swap: the planned
--    exercise is left out of the score, and what was done instead is listed next to it.
--  * sync_workout takes a lock per workout, so two devices (or two tabs) sending the same workout at the same moment no longer fail
--    with a duplicate-key error (that error made the phone set a good workout aside as "refused").
-- Nothing else changes in the two functions below.

alter table public.sessions add column replaced jsonb not null default '{}'::jsonb;
comment on column public.sessions.replaced is 'Exercises replaced by another during the workout: {old exercise id: the exercise that took its place}. Sent by the phone; finish_session turns the ones that apply into session_swaps.';

create or replace function public.sync_workout(p_workout jsonb) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id       uuid := (p_workout ->> 'id')::uuid;
  v_ended    timestamptz := nullif(p_workout ->> 'ended_at', '')::timestamptz;
  v_live     jsonb := nullif(p_workout -> 'live', 'null'::jsonb);
  v_s        record;
  v_other    uuid;
  v_item     jsonb;
  v_existing record;
  v_exercise uuid;
  v_set_no   integer;
  v_side     text;
  v_logged   timestamptz;
  v_n        integer;
  v_changed  boolean := false; -- sets were added, changed or deleted by this call
  v_replaced jsonb; -- {old exercise id: the exercise that took its place}, from a Replace in the workout
begin
  if v_id is null then
    raise exception 'the workout needs an id';
  end if;

  -- One call at a time per workout: two devices (or two tabs) sending the same workout together used to collide on the
  -- "one row per set position" and "one row per session" rules and one of them failed with a duplicate-key error.
  perform pg_advisory_xact_lock(hashtext(v_id::text));

  -- Exercises replaced by another during the workout (only well-formed ids are kept).
  v_replaced := case when jsonb_typeof(p_workout -> 'replaced') = 'object' then (
      select coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb)
      from jsonb_each_text(p_workout -> 'replaced') as e (k, v)
      where e.k ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and e.v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and e.k <> e.v) end;

  select s.id, s.ended_at, s.deleted_at into v_s from public.sessions s where s.id = v_id;
  if found and v_s.deleted_at is not null then
    return jsonb_build_object('status', 'deleted');
  end if;

  if coalesce((p_workout ->> 'discard')::boolean, false) then
    if found then perform public.delete_session(v_id); end if;
    return jsonb_build_object('status', 'deleted');
  end if;

  if not found then
    -- Only one workout can be open. A device finishing a workout it made offline is not blocked: that is just an upload.
    if v_ended is null then
      select s.id into v_other from public.sessions s where s.ended_at is null and s.deleted_at is null order by s.started_at desc limit 1;
      if v_other is not null then
        return jsonb_build_object('status', 'other_open', 'workout', public.workout_json(v_other));
      end if;
    end if;
    insert into public.sessions (id, routine_id, title, started_at, source, live, live_updated_at)
    values (v_id, nullif(p_workout ->> 'routine_id', '')::uuid, coalesce(nullif(p_workout ->> 'title', ''), 'Workout'),
            least((p_workout ->> 'started_at')::timestamptz, clock_timestamp()), 'app', v_live, case when v_live is not null then now() end);
  elsif v_live is not null and v_s.ended_at is null then
    update public.sessions set live = v_live, live_updated_at = now() where id = v_id;
  end if;

  if v_replaced is not null and v_replaced <> '{}'::jsonb then
    update public.sessions set replaced = replaced || v_replaced where id = v_id and deleted_at is null;
  end if;

  -- Deletes first, so a freed set number can be used again in the same call.
  update public.sets set deleted_at = now()
   where session_id = v_id and deleted_at is null
     and id in (select (j)::uuid from jsonb_array_elements_text(coalesce(p_workout -> 'deleted_set_ids', '[]'::jsonb)) as j);
  get diagnostics v_n = row_count;
  v_changed := v_changed or v_n > 0;

  for v_item in select * from jsonb_array_elements(coalesce(p_workout -> 'sets', '[]'::jsonb)) loop
    v_exercise := (v_item ->> 'exercise_id')::uuid;
    v_set_no   := (v_item ->> 'set_no')::integer;
    v_side     := nullif(v_item ->> 'side', '');
    v_logged   := least(coalesce((v_item ->> 'logged_at')::timestamptz, now()), clock_timestamp()); -- a clock that runs ahead cannot win every later edit

    select x.id, x.logged_at into v_existing
    from public.sets x
    where x.session_id = v_id and x.exercise_id = v_exercise and x.set_no = v_set_no
      and x.side is not distinct from v_side and x.deleted_at is null;

    if found then
      if v_logged > v_existing.logged_at then
        update public.sets
           set weight_kg = (v_item ->> 'weight_kg')::numeric, reps = (v_item ->> 'reps')::integer, logged_at = v_logged
         where id = v_existing.id;
        v_changed := true;
      end if;
    elsif not exists (select 1 from public.sets x where x.id = (v_item ->> 'id')::uuid) then
      -- (a set whose id exists but is not live was deleted: deleted wins)
      insert into public.sets (id, session_id, exercise_id, set_no, side, weight_kg, reps, is_warmup, logged_at)
      values ((v_item ->> 'id')::uuid, v_id, v_exercise, v_set_no, v_side, (v_item ->> 'weight_kg')::numeric,
              (v_item ->> 'reps')::integer, coalesce((v_item ->> 'is_warmup')::boolean, false), v_logged);
      v_changed := true;
    end if;
  end loop;

  if v_ended is not null and (v_s.ended_at is null) then
    update public.sessions
       set ended_at = greatest(least(v_ended, clock_timestamp(), started_at + interval '24 hours'), started_at), -- not in the future, not days long
           feeling = coalesce(nullif(p_workout ->> 'feeling', '')::smallint, feeling),
           live = null, live_updated_at = now()
     where id = v_id;
    perform public.finish_session(v_id);
  end if;

  -- Sets that arrive after the workout was finished (a device that was offline) change what the score and the next plan were
  -- worked out from, so they are worked out again. Safe to repeat.
  if v_changed and v_s.ended_at is not null then
    perform public.finish_session(v_id);
  end if;

  return jsonb_build_object(
    'status', case when exists (select 1 from public.sessions s where s.id = v_id and s.ended_at is not null) then 'finished' else 'ok' end,
    'workout', public.workout_json(v_id));
end;
$$;

comment on function public.sync_workout(jsonb) is
  'Send a device''s view of a workout (id, routine_id, title, started_at, live if changed, all its sets, deleted_set_ids, replaced = {old exercise id: new one} when exercises were replaced, and ended_at + feeling to finish or discard:true to throw away) and get {status, workout} back, merged with what other devices did. One open workout per user (status other_open returns the open one). Same set on two devices = one row, newer log wins (a log time in the future counts as now). Start and finish times are kept out of the future, and a finish is at most 24 hours after the start. Sets arriving after the finish make the score and plan be worked out again. One call at a time per workout. Safe to repeat.';

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

    -- the same for an exercise replaced by another during the workout (Replace): nothing logged for it, sets logged for the new one
    insert into public.session_swaps (user_id, session_id, exercise_id, backup_exercise_id)
    select s.user_id, s.id, r.key::uuid, r.value::uuid
    from public.sessions s
    cross join lateral jsonb_each_text(s.replaced) as r (key, value)
    where s.id = p_session_id
      and exists (select 1 from public.exercises e where e.id = r.key::uuid and e.user_id = s.user_id)
      and exists (select 1 from public.exercises e where e.id = r.value::uuid and e.user_id = s.user_id)
      and not exists (select 1 from public.sets x where x.session_id = s.id and x.exercise_id = r.key::uuid and x.deleted_at is null)
      and exists (select 1 from public.sets x where x.session_id = s.id and x.exercise_id = r.value::uuid and x.deleted_at is null)
    on conflict do nothing;

    v_rules_plan := public.generate_plan(v_routine_id);
  end if;

  return jsonb_build_object('session_id', p_session_id, 'routine_id', v_routine_id,
                            'plans_marked_used', v_marked, 'rules_plan_id', v_rules_plan);
end;
$$;

comment on function public.finish_session(uuid) is
  'Call when a workout ends: sets ended_at if empty, marks the plans that were pending for the routine as used, records the planned exercises that were replaced by their backup or by another exercise during the workout (session_swaps), and generates the new rules plan. Safe to call twice.';
