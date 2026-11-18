-- sync_workout, with guards against a device whose clock or timing is off (found in testing):
--   * a start time in the future (a phone with a wrong clock) is brought back to now, so no future sessions appear;
--   * a finish time is never in the future and never more than 24 hours after the start (a workout left open for days);
--   * a set logged "in the future" is stored as logged now, so such a device can no longer win every later edit of that set
--     ("the newer log wins"); the clock used is the server's, not the device's;
--   * sets that arrive after the workout was already finished (a device that was offline) make the score and the next plan be
--     worked out again (finish_session, which is safe to repeat), instead of leaving them stale.
-- Nothing else changes: the function below is the one from the live workout migration with those lines different.

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
            least((p_workout ->> 'started_at')::timestamptz, clock_timestamp()), 'app', v_live, case when v_live is not null then now() end);
  elsif v_live is not null and v_s.ended_at is null then
    update public.sessions set live = v_live, live_updated_at = now() where id = v_id;
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
  'Send a device''s view of a workout (id, routine_id, title, started_at, live if changed, all its sets, deleted_set_ids, and ended_at + feeling to finish or discard:true to throw away) and get {status, workout} back, merged with what other devices did. One open workout per user (status other_open returns the open one). Same set on two devices = one row, newer log wins (a log time in the future counts as now). Start and finish times are kept out of the future, and a finish is at most 24 hours after the start. Sets arriving after the finish make the score and plan be worked out again. Safe to repeat.';
