-- Planning on demand. Finishing a workout no longer asks Claude for a plan: it only writes the automatic rules plan (instant, works
-- offline, so every routine always has a plan). The owner asks Claude for a better one on the day, for one routine, with a button.
-- Claude then sees everything since the last session of every routine, not only that routine's own history.

alter table public.routines add column plan_requested_at timestamptz;
comment on column public.routines.plan_requested_at is
  'When the claude.ai scheduled task was last asked to plan this routine (set by request_routine_plan). Used for the 2-minute cooldown and to show "waiting for Claude".';

comment on column public.sessions.plan_requested_at is
  'No longer used: planning is requested per routine (routines.plan_requested_at), on demand. Kept so old rows are not lost.';

-- finish_session: as before, but without the automatic request to Claude.
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

    v_rules_plan := public.generate_plan(v_routine_id);
  end if;

  return jsonb_build_object('session_id', p_session_id, 'routine_id', v_routine_id,
                            'plans_marked_used', v_marked, 'rules_plan_id', v_rules_plan);
end;
$$;

comment on function public.finish_session(uuid) is
  'Ends a workout: sets ended_at, marks the routine''s pending plans as used and writes the automatic rules plan for the next session. Asking Claude for a plan is a separate, manual step (request_routine_plan). Safe to call twice.';

-- The old per-session request is replaced by the per-routine one below.
drop function public.request_claude_plan(uuid);

-- Asks the claude.ai scheduled task to plan this routine now. security definer because it reads the Vault; it only works on the
-- caller's own routines. A second request within 2 minutes is ignored (double taps, and the task's hourly limit).
create function public.request_routine_plan(p_routine_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_routine record;
  v_url     text;
  v_token   text;
  v_request bigint;
begin
  select r.id, r.name, r.plan_requested_at into v_routine
  from public.routines r
  where r.id = p_routine_id and r.deleted_at is null
    and (auth.uid() is null or r.user_id = auth.uid());
  if not found then
    raise exception 'routine % not found', p_routine_id;
  end if;

  if v_routine.plan_requested_at is not null and v_routine.plan_requested_at > now() - interval '2 minutes' then
    return jsonb_build_object('requested', false, 'reason', 'recent', 'requested_at', v_routine.plan_requested_at);
  end if;

  select decrypted_secret into v_url   from vault.decrypted_secrets where name = 'claude_fire_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'claude_fire_token';
  if v_url is null or v_token is null then
    return jsonb_build_object('requested', false, 'reason', 'not_configured');
  end if;

  select net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'anthropic-beta', 'experimental-cc-routine-2026-04-01',
      'anthropic-version', '2023-06-01',
      'Content-Type', 'application/json'),
    body    := jsonb_build_object('text', 'routine: ' || v_routine.name || E'\nplan it now')
  ) into v_request;

  update public.routines set plan_requested_at = now() where id = p_routine_id;
  return jsonb_build_object('requested', true, 'reason', null, 'requested_at', now(), 'request_id', v_request);
end;
$$;

comment on function public.request_routine_plan(uuid) is
  'The "Plan with Claude" button: asks the claude.ai scheduled task to plan this routine now (HTTP request via pg_net, secrets from Vault). Returns {requested, reason, requested_at}; reason is "recent" (asked less than 2 minutes ago) or "not_configured" (no secrets) when nothing was sent. Raises if the routine is not yours.';

revoke execute on function public.request_routine_plan(uuid) from public, anon;
grant  execute on function public.request_routine_plan(uuid) to authenticated;

-- Where each routine's request stands: waiting for Claude (asked in the last 10 minutes, no Claude plan since), no answer
-- (asked up to 3 hours ago and still no Claude plan), or nothing to show (null).
create view public.routine_plan_status with (security_invoker = true) as
select r.id as routine_id,
       r.user_id,
       r.plan_requested_at,
       case
         when r.plan_requested_at is null then null
         when exists (select 1 from public.planned_sessions p
                      where p.routine_id = r.id and p.created_by = 'claude' and p.created_at > r.plan_requested_at) then null
         when r.plan_requested_at > now() - interval '10 minutes' then 'waiting'
         when r.plan_requested_at > now() - interval '3 hours' then 'no_answer'
       end as state
from public.routines r
where r.deleted_at is null;

comment on view public.routine_plan_status is
  'Per routine: when Claude was last asked for a plan and what is happening: waiting (asked under 10 minutes ago), no_answer (asked up to 3 hours ago, no Claude plan has arrived), or null (nothing pending or the Claude plan is there).';
comment on column public.routine_plan_status.routine_id is 'The routine.';
comment on column public.routine_plan_status.user_id is 'Owner.';
comment on column public.routine_plan_status.plan_requested_at is 'When Claude was last asked to plan this routine.';
comment on column public.routine_plan_status.state is 'waiting, no_answer, or null.';
