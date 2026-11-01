-- finish_session(session_id): what every client calls when a workout ends (phone app, later the watch).
--  1. sets ended_at if it is still empty
--  2. marks the pending plans of that routine, created before the session ended, as 'used'
--  3. generates the new rules plan straight away, as the instant fallback
-- Safe to call again for the same session (a retry after bad signal): ended_at is not moved and the
-- rules plan is simply regenerated.

create function public.finish_session(p_session_id uuid) returns jsonb
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

    v_rules_plan := public.generate_plan(v_routine_id);
  end if;

  return jsonb_build_object('session_id', p_session_id, 'routine_id', v_routine_id,
                            'plans_marked_used', v_marked, 'rules_plan_id', v_rules_plan);
end;
$$;

comment on function public.finish_session(uuid) is
  'Call when a workout ends: sets ended_at if empty, marks the plans that were pending for the routine as used, and generates the new rules plan. Safe to call twice.';

revoke execute on function public.finish_session(uuid) from public, anon;
grant  execute on function public.finish_session(uuid) to authenticated;
