-- Tests for planning on demand: finish_session no longer asks Claude, request_routine_plan (the button) does, and
-- routine_plan_status says where the request stands. No network is used: pg_net queues the request in
-- net.http_request_queue, which we inspect. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'one@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'two@example.com');
insert into public.routines (id, user_id, name) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Zz Request Routine'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'Zz Other Routine');
insert into public.exercises (id, user_id, name, rep_min, rep_max, increment_kg) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Zz Request Exercise', 6, 10, 4);
insert into public.routine_exercises (user_id, routine_id, exercise_id, position, target_sets)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
        '00000000-0000-0000-0000-0000000000e1', 1, 3);
insert into public.sessions (id, user_id, routine_id, title, started_at, source) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'app 1', now() - interval '1 hour', 'app');
insert into public.sets (user_id, session_id, exercise_id, set_no, weight_kg, reps)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 1, 40, 10);

-- Without the secrets, the button sends nothing and says why.
select is((public.request_routine_plan('00000000-0000-0000-0000-0000000000b1')) ->> 'reason', 'not_configured', 'no secrets: not_configured');
select is((select plan_requested_at from public.routines where id = '00000000-0000-0000-0000-0000000000b1'), null::timestamptz, 'no secrets: nothing marked as requested');

select vault.create_secret('https://example.invalid/v1/claude_code/routines/trig_TEST/fire', 'claude_fire_url');
select vault.create_secret('sk-test-token', 'claude_fire_token');
delete from net.http_request_queue;

-- Finishing a workout does not ask Claude any more, but still writes the automatic plan.
select lives_ok($$select public.finish_session('00000000-0000-0000-0000-0000000000d1')$$, 'finish_session works');
select is((select count(*) from net.http_request_queue where url like 'https://example.invalid/%'), 0::bigint, 'finish_session sends no request to Claude');
select is((select count(*) from public.planned_sessions where routine_id = '00000000-0000-0000-0000-0000000000b1' and created_by = 'rules' and status = 'pending'), 1::bigint, 'the automatic rules plan is still written');
select is((select plan_requested_at from public.routines where id = '00000000-0000-0000-0000-0000000000b1'), null::timestamptz, 'and the routine is not marked as requested');

-- The button.
select is((public.request_routine_plan('00000000-0000-0000-0000-0000000000b1')) ->> 'requested', 'true', 'the button sends a request');
select isnt((select plan_requested_at from public.routines where id = '00000000-0000-0000-0000-0000000000b1'), null::timestamptz, 'the routine is marked as requested');
select is((select count(*) from net.http_request_queue where url like 'https://example.invalid/%'), 1::bigint, 'one request queued');
select is((select headers ->> 'Authorization' from net.http_request_queue where url like 'https://example.invalid/%'), 'Bearer sk-test-token', 'bearer token sent');
select is((select headers ->> 'anthropic-beta' from net.http_request_queue where url like 'https://example.invalid/%'), 'experimental-cc-routine-2026-04-01', 'beta header sent');
select matches((select convert_from(body, 'utf8') from net.http_request_queue where url like 'https://example.invalid/%'), 'routine: Zz Request Routine', 'body names the routine');

-- A second tap right away is ignored; after 2 minutes it goes through.
select is((public.request_routine_plan('00000000-0000-0000-0000-0000000000b1')) ->> 'reason', 'recent', 'a second tap within 2 minutes is ignored');
select is((select count(*) from net.http_request_queue where url like 'https://example.invalid/%'), 1::bigint, 'still one request queued');
update public.routines set plan_requested_at = now() - interval '3 minutes' where id = '00000000-0000-0000-0000-0000000000b1';
select is((public.request_routine_plan('00000000-0000-0000-0000-0000000000b1')) ->> 'requested', 'true', 'after 2 minutes it can be asked again');
select is((select count(*) from net.http_request_queue where url like 'https://example.invalid/%'), 2::bigint, 'two requests queued in total');

select throws_ok($$select public.request_routine_plan('00000000-0000-0000-0000-0000000000ff')$$, 'P0001', null, 'an unknown routine is rejected');

-- Another user cannot ask for plans of my routines.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.request_routine_plan('00000000-0000-0000-0000-0000000000b2')$$, 'P0001', null, 'a routine of another user is rejected');
reset role;
select set_config('request.jwt.claims', '', true);

-- Status: waiting, then no answer, then the Claude plan arrives.
update public.routines set plan_requested_at = now() - interval '1 minute' where id = '00000000-0000-0000-0000-0000000000b1';
select is((select state from public.routine_plan_status where routine_id = '00000000-0000-0000-0000-0000000000b1'), 'waiting', 'asked a minute ago: waiting');
update public.routines set plan_requested_at = now() - interval '30 minutes' where id = '00000000-0000-0000-0000-0000000000b1';
select is((select state from public.routine_plan_status where routine_id = '00000000-0000-0000-0000-0000000000b1'), 'no_answer', 'asked 30 minutes ago with no Claude plan: no_answer');
select is((select state from public.routine_plan_status where routine_id = '00000000-0000-0000-0000-0000000000b2'), null, 'a routine never asked has no state');
select public.submit_plan('Zz Request Routine', '[{"exercise": "Zz Request Exercise", "sets": [{"weight_kg": 44, "reps_min": 6, "reps_max": 10}]}]'::jsonb, 'test');
select is((select state from public.routine_plan_status where routine_id = '00000000-0000-0000-0000-0000000000b1'), null, 'once the Claude plan exists the state is cleared');

select * from finish();
rollback;
