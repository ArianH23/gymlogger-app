-- Correcting past sessions, all-or-nothing: edit_session applies every change in one transaction, and
-- delete_session removes a whole session. Both rebuild the routine's automatic plan afterwards so it never
-- plans from numbers that were just corrected. A pending claude plan is left alone.
-- Nothing is physically deleted: rows get deleted_at, like everywhere else.

create function public.edit_session(
  p_session_id uuid,
  p_title      text    default null,
  p_updates    jsonb   default '[]',   -- [{"id": uuid, "weight_kg": 44, "reps": 8}, ...] full new values for existing sets
  p_deleted    uuid[]  default '{}',   -- ids of sets to remove
  p_added      jsonb   default '[]'    -- [{"exercise_id": uuid, "set_no": 4, "side": null|"L"|"R", "weight_kg": 40, "reps": 8}, ...]
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_session  record;
  v_item     jsonb;
  v_next     timestamptz;
  v_updated  integer := 0;
  v_deleted  integer := 0;
  v_added    integer := 0;
  v_planned  boolean := false;
begin
  select s.id, s.user_id, s.routine_id, s.started_at into v_session
  from public.sessions s
  where s.id = p_session_id and s.deleted_at is null;
  if not found then
    raise exception 'session % not found', p_session_id;
  end if;

  if p_title is not null then
    if length(trim(p_title)) = 0 then
      raise exception 'the title cannot be empty';
    end if;
    update public.sessions set title = trim(p_title) where id = p_session_id;
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) loop
    update public.sets
       set weight_kg = (v_item ->> 'weight_kg')::numeric, reps = (v_item ->> 'reps')::integer
     where id = (v_item ->> 'id')::uuid and session_id = p_session_id and deleted_at is null;
    if found then v_updated := v_updated + 1; end if;
  end loop;

  -- deletes before adds, so a removed set number can be used again
  update public.sets set deleted_at = now()
   where session_id = p_session_id and id = any (coalesce(p_deleted, '{}')) and deleted_at is null;
  get diagnostics v_deleted = row_count;

  select coalesce(max(s.logged_at), v_session.started_at) into v_next from public.sets s where s.session_id = p_session_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_added, '[]'::jsonb)) loop
    v_next := v_next + interval '1 second';
    insert into public.sets (id, user_id, session_id, exercise_id, set_no, side, weight_kg, reps, is_warmup, logged_at)
    values (coalesce((v_item ->> 'id')::uuid, gen_random_uuid()), v_session.user_id, p_session_id,
            (v_item ->> 'exercise_id')::uuid, (v_item ->> 'set_no')::integer, nullif(v_item ->> 'side', ''),
            (v_item ->> 'weight_kg')::numeric, (v_item ->> 'reps')::integer, false, v_next);
    v_added := v_added + 1;
  end loop;

  if v_session.routine_id is not null then
    begin
      perform public.generate_plan(v_session.routine_id);
      v_planned := true;
    exception when others then
      v_planned := false;   -- the edit stands even if the plan cannot be rebuilt (e.g. a routine with no exercises)
    end;
  end if;

  return jsonb_build_object('updated', v_updated, 'deleted', v_deleted, 'added', v_added, 'plan_rebuilt', v_planned);
end;
$$;

comment on function public.edit_session(uuid, text, jsonb, uuid[], jsonb) is
  'Corrects a past session in one transaction: new title, new weight/reps for existing sets, sets to remove, sets to add. Rebuilds the routine''s automatic plan afterwards; a pending claude plan is untouched.';

create function public.delete_session(p_session_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_routine uuid;
  v_sets    integer;
  v_planned boolean := false;
begin
  update public.sessions set deleted_at = now()
   where id = p_session_id and deleted_at is null
  returning routine_id into v_routine;
  if not found then
    raise exception 'session % not found', p_session_id;
  end if;

  update public.sets set deleted_at = now() where session_id = p_session_id and deleted_at is null;
  get diagnostics v_sets = row_count;
  update public.session_exercise_notes set deleted_at = now() where session_id = p_session_id and deleted_at is null;

  if v_routine is not null then
    begin
      perform public.generate_plan(v_routine);
      v_planned := true;
    exception when others then
      v_planned := false;
    end;
  end if;
  return jsonb_build_object('sets_deleted', v_sets, 'plan_rebuilt', v_planned);
end;
$$;

comment on function public.delete_session(uuid) is
  'Removes a session with its sets and notes (soft delete), so it disappears from history, stats and charts. Rebuilds the routine''s automatic plan afterwards.';

revoke execute on function public.edit_session(uuid, text, jsonb, uuid[], jsonb) from public, anon;
grant  execute on function public.edit_session(uuid, text, jsonb, uuid[], jsonb) to authenticated;
revoke execute on function public.delete_session(uuid) from public, anon;
grant  execute on function public.delete_session(uuid) to authenticated;
