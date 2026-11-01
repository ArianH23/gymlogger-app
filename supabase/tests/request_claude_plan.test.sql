-- Tests for the automatic "ask Claude for a plan" request. No network is used: pg_net queues the request
-- in net.http_request_queue, which we inspect. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'test@example.com');
insert into public.routines (id, user_id, name) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Zz Request Routine');
insert into public.exercises (id, user_id, name, rep_min, rep_max, increment_kg) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Zz Request Exercise', 6, 10, 4);
insert into public.routine_exercises (user_id, routine_id, exercise_id, position, target_sets)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
        '00000000-0000-0000-0000-0000000000e1', 1, 3);
insert into public.sessions (id, user_id, routine_id, title, started_at, source) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'app 1', now() - interval '1 hour', 'app'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'app 2', now() - interval '1 hour', 'app'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'imported', now() - interval '1 hour', 'hevy_import');
insert into public.sets (user_id, session_id, exercise_id, set_no, weight_kg, reps)
select '00000000-0000-0000-0000-0000000000a1', id, '00000000-0000-0000-0000-0000000000e1', 1, 40, 10 from public.sessions;

-- Without the secrets: finishing still works, and nothing is requested.
select lives_ok($$select public.finish_session('00000000-0000-0000-0000-0000000000d1')$$,
                'finish_session works without Vault secrets');
select is((select plan_requested_at from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'), null::timestamptz,
          'no secrets: nothing marked as requested');

-- With the secrets.
select vault.create_secret('https://example.invalid/v1/claude_code/routines/trig_TEST/fire', 'claude_fire_url');
select vault.create_secret('sk-test-token', 'claude_fire_token');
delete from net.http_request_queue;

select lives_ok($$select public.finish_session('00000000-0000-0000-0000-0000000000d2')$$, 'finish_session with secrets');
select isnt((select plan_requested_at from public.sessions where id = '00000000-0000-0000-0000-0000000000d2'), null::timestamptz,
            'session marked as requested');
select is((select count(*) from net.http_request_queue where url like 'https://example.invalid/%'), 1::bigint, 'one request queued');
select is((select headers ->> 'Authorization' from net.http_request_queue where url like 'https://example.invalid/%'),
          'Bearer sk-test-token', 'bearer token sent');
select is((select headers ->> 'anthropic-beta' from net.http_request_queue where url like 'https://example.invalid/%'),
          'experimental-cc-routine-2026-04-01', 'beta header sent');
select matches((select convert_from(body, 'utf8') from net.http_request_queue where url like 'https://example.invalid/%'),
               'routine: Zz Request Routine', 'body names the routine');

-- Calling again does not send a second request; imported sessions never send one.
select public.finish_session('00000000-0000-0000-0000-0000000000d2');
select public.finish_session('00000000-0000-0000-0000-0000000000d3');
select is((select count(*) from net.http_request_queue where url like 'https://example.invalid/%'), 1::bigint,
          'still one request: no repeat, none for imported sessions');
select is((select plan_requested_at from public.sessions where id = '00000000-0000-0000-0000-0000000000d3'), null::timestamptz,
          'imported session never requested');

select * from finish();
rollback;
