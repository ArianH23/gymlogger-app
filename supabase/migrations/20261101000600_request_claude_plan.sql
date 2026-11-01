-- Automatic planning: when a workout finishes, ask the claude.ai scheduled task to write the next plan.
-- The task's URL and bearer token live in Supabase Vault (secrets named claude_fire_url and
-- claude_fire_token), never in code. If they are missing or the request fails, nothing breaks:
-- finish_session has already generated the rules plan.

create extension if not exists pg_net;

alter table public.sessions add column plan_requested_at timestamptz;
comment on column public.sessions.plan_requested_at is
  'When the claude.ai scheduled task was asked to plan the next session after this one. Set once, so the request is never sent twice for a session.';

-- Sends the request. security definer because it reads the Vault; it only works on the caller's own
-- app sessions, and only once per session.
create function public.request_claude_plan(p_session_id uuid) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
  v_url     text;
  v_token   text;
  v_request bigint;
begin
  select s.id, s.source, s.plan_requested_at, r.name as routine_name
    into v_session
  from public.sessions s
  join public.routines r on r.id = s.routine_id
  where s.id = p_session_id and s.deleted_at is null
    and (auth.uid() is null or s.user_id = auth.uid());
  if not found or v_session.source <> 'app' or v_session.plan_requested_at is not null then
    return null;
  end if;

  select decrypted_secret into v_url   from vault.decrypted_secrets where name = 'claude_fire_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'claude_fire_token';
  if v_url is null or v_token is null then
    raise warning 'claude_fire_url / claude_fire_token not set in Vault: no Claude plan requested';
    return null;
  end if;

  select net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_token,
      'anthropic-beta', 'experimental-cc-routine-2026-04-01',
      'anthropic-version', '2023-06-01',
      'Content-Type', 'application/json'),
    body    := jsonb_build_object('text', 'routine: ' || v_session.routine_name
                                          || E'\nfinished session: ' || p_session_id)
  ) into v_request;

  update public.sessions set plan_requested_at = now() where id = p_session_id;
  return v_request;
end;
$$;

comment on function public.request_claude_plan(uuid) is
  'Asks the claude.ai scheduled task to plan the next session of this session''s routine (HTTP request via pg_net, secrets from Vault). Once per app session; does nothing without a routine or without the secrets.';

revoke execute on function public.request_claude_plan(uuid) from public, anon;
grant  execute on function public.request_claude_plan(uuid) to authenticated;

-- finish_session again, now also asking Claude for a plan. A failure here never fails the finish.
create or replace function public.finish_session(p_session_id uuid) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_routine_id uuid;
  v_ended      timestamptz;
  v_marked     integer := 0;
  v_rules_plan uuid;
  v_request    bigint;
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

    begin
      v_request := public.request_claude_plan(p_session_id);
    exception when others then
      raise warning 'could not request a Claude plan: %', sqlerrm;
    end;
  end if;

  return jsonb_build_object('session_id', p_session_id, 'routine_id', v_routine_id,
                            'plans_marked_used', v_marked, 'rules_plan_id', v_rules_plan,
                            'claude_request_id', v_request);
end;
$$;
