-- The workout in progress lives in the database, so the phone and the watch share it (start on one, carry on on the other).
-- One function does all the merging: a device sends its whole view of the open workout (sync_workout) and gets the merged
-- truth back, so no client needs its own merge code. Every client rule lives here:
--   * one open workout per user: starting a second one returns the open one instead (status 'other_open');
--   * the same set (exercise + set number + side) logged on two devices is one row: the newer log wins, the row keeps its id;
--   * a deleted set stays deleted, even if another device sends it again;
--   * the plan layout of the open workout (live: the exercise list, added and removed sets) is last-writer-wins;
--   * finishing (ended_at) saves the feeling and runs finish_session; a finished or deleted workout is reported as such.
-- Everything is idempotent, so retrying after a dropped connection is harmless. Stats, plans and "next up" already ignore
-- sessions without ended_at, so a workout in progress never leaks into them.

alter table public.sessions
  add column live            jsonb,
  add column live_updated_at timestamptz;

comment on column public.sessions.live is
  'While the session is open: what the workout screen needs besides the sets (plan: the exercises with targets and last time, extra_sets, removed_sets), so another device can resume it. Cleared when the session is finished.';
comment on column public.sessions.live_updated_at is 'Server time of the last change to live (last writer wins).';

-- The whole state of one session, in the shape sync_workout returns.
create function public.workout_json(p_session_id uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'routine_id', s.routine_id, 'title', s.title, 'started_at', s.started_at,
    'ended_at', s.ended_at, 'feeling', s.feeling, 'live', s.live, 'live_updated_at', s.live_updated_at,
    'sets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'exercise_id', x.exercise_id, 'set_no', x.set_no, 'side', x.side,
        'weight_kg', x.weight_kg, 'reps', x.reps, 'is_warmup', x.is_warmup, 'logged_at', x.logged_at)
        order by x.logged_at, x.id)
      from public.sets x
      where x.session_id = s.id and x.deleted_at is null), '[]'::jsonb))
  from public.sessions s
  where s.id = p_session_id and s.deleted_at is null
$$;
comment on function public.workout_json(uuid) is 'The state of one session as JSON: its fields, live, and its (not deleted) sets. Used by sync_workout and open_workout.';
revoke execute on function public.workout_json(uuid) from public, anon;
grant  execute on function public.workout_json(uuid) to authenticated;

-- The user's open workout (started, not finished, not deleted), or null. Devices ask this to find a workout started elsewhere.
create function public.open_workout() returns jsonb
language sql
stable
set search_path = ''
as $$
  select public.workout_json(s.id)
  from public.sessions s
  where s.ended_at is null and s.deleted_at is null
  order by s.started_at desc
  limit 1
$$;
comment on function public.open_workout() is 'The open workout (as workout_json) or null if there is none.';
revoke execute on function public.open_workout() from public, anon;
grant  execute on function public.open_workout() to authenticated;

-- Send a device's view of a workout, get the merged truth back.
--   p_workout: { id, routine_id, title, started_at,
--                live (optional: only when it changed on this device),
--                sets: [{id, exercise_id, set_no, side, weight_kg, reps, is_warmup, logged_at}] (all its current sets),
--                deleted_set_ids: [uuid] (sets deleted on this device since the last sync),
--                ended_at + feeling (to finish), discard: true (to throw the workout away) }
--   returns:   { status: 'ok' | 'finished' | 'deleted' | 'other_open', workout: workout_json }
create function public.sync_workout(p_workout jsonb) returns jsonb
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
begin
  if v_id is null then
    raise exception 'the workout needs an id';
  end if;

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
            (p_workout ->> 'started_at')::timestamptz, 'app', v_live, case when v_live is not null then now() end);
  elsif v_live is not null and v_s.ended_at is null then
    update public.sessions set live = v_live, live_updated_at = now() where id = v_id;
  end if;

  -- Deletes first, so a freed set number can be used again in the same call.
  update public.sets set deleted_at = now()
   where session_id = v_id and deleted_at is null
     and id in (select (j)::uuid from jsonb_array_elements_text(coalesce(p_workout -> 'deleted_set_ids', '[]'::jsonb)) as j);

  for v_item in select * from jsonb_array_elements(coalesce(p_workout -> 'sets', '[]'::jsonb)) loop
    v_exercise := (v_item ->> 'exercise_id')::uuid;
    v_set_no   := (v_item ->> 'set_no')::integer;
    v_side     := nullif(v_item ->> 'side', '');
    v_logged   := coalesce((v_item ->> 'logged_at')::timestamptz, now());

    select x.id, x.logged_at into v_existing
    from public.sets x
    where x.session_id = v_id and x.exercise_id = v_exercise and x.set_no = v_set_no
      and x.side is not distinct from v_side and x.deleted_at is null;

    if found then
      if v_logged > v_existing.logged_at then
        update public.sets
           set weight_kg = (v_item ->> 'weight_kg')::numeric, reps = (v_item ->> 'reps')::integer, logged_at = v_logged
         where id = v_existing.id;
      end if;
    elsif not exists (select 1 from public.sets x where x.id = (v_item ->> 'id')::uuid) then
      -- (a set whose id exists but is not live was deleted: deleted wins)
      insert into public.sets (id, session_id, exercise_id, set_no, side, weight_kg, reps, is_warmup, logged_at)
      values ((v_item ->> 'id')::uuid, v_id, v_exercise, v_set_no, v_side, (v_item ->> 'weight_kg')::numeric,
              (v_item ->> 'reps')::integer, coalesce((v_item ->> 'is_warmup')::boolean, false), v_logged);
    end if;
  end loop;

  if v_ended is not null and (v_s.ended_at is null) then
    update public.sessions
       set ended_at = greatest(v_ended, started_at),
           feeling = coalesce(nullif(p_workout ->> 'feeling', '')::smallint, feeling),
           live = null, live_updated_at = now()
     where id = v_id;
    perform public.finish_session(v_id);
  end if;

  return jsonb_build_object(
    'status', case when exists (select 1 from public.sessions s where s.id = v_id and s.ended_at is not null) then 'finished' else 'ok' end,
    'workout', public.workout_json(v_id));
end;
$$;

comment on function public.sync_workout(jsonb) is
  'Send a device''s view of a workout (id, routine_id, title, started_at, live if changed, all its sets, deleted_set_ids, and ended_at + feeling to finish or discard:true to throw away) and get {status, workout} back, merged with what other devices did. One open workout per user (status other_open returns the open one). Same set on two devices = one row, newer log wins. Safe to repeat.';
revoke execute on function public.sync_workout(jsonb) from public, anon;
grant  execute on function public.sync_workout(jsonb) to authenticated;
