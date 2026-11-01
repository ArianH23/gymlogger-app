-- Tests for the workout in progress shared between devices (sync_workout, open_workout). Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'test@example.com');
insert into public.exercises (id, user_id, name, rep_min, rep_max, increment_kg) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Zz Live Press', 6, 10, 4),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Zz Live Row', 8, 12, 4);
insert into public.routines (id, user_id, name) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Zz Live Routine');
insert into public.routine_exercises (user_id, routine_id, exercise_id, position, target_sets) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 1, 3);
-- a plan waiting for this routine, made before the workout starts
insert into public.planned_sessions (id, user_id, routine_id, created_by, status, created_at) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'claude', 'pending', now() - interval '3 hours');

-- From here on, act as the signed-in user (row level security applies).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

create function pg_temp.set_json(p_id text, p_exercise text, p_set_no integer, p_weight numeric, p_reps integer, p_minutes_ago integer, p_side text default null)
returns jsonb language sql as $$
  select jsonb_build_object('id', p_id::uuid, 'exercise_id', p_exercise::uuid, 'set_no', p_set_no, 'side', p_side,
                            'weight_kg', p_weight, 'reps', p_reps, 'logged_at', now() - make_interval(mins => p_minutes_ago))
$$;
create function pg_temp.payload(p_id text, p_sets jsonb default '[]', p_deleted jsonb default '[]', p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id::uuid, 'routine_id', '00000000-0000-0000-0000-0000000000b1', 'title', 'Zz Live Routine',
                            'started_at', now() - interval '1 hour', 'sets', p_sets, 'deleted_set_ids', p_deleted) || p_extra
$$;
create function pg_temp.sets_in(p_session text) returns bigint language sql as $$
  select count(*) from public.sets where session_id = p_session::uuid and deleted_at is null
$$;

-- Nothing open yet.
select is(public.open_workout(), null, 'no open workout at first');

-- Starting a workout creates the session, with its live state.
select is(public.sync_workout(pg_temp.payload('00000000-0000-0000-0000-0000000000d1', '[]', '[]', '{"live": {"extra_sets": {"x": 1}}}')) ->> 'status', 'ok', 'starting returns ok');
select is((select ended_at from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'), null, 'the session is open (no ended_at)');
select is((select live -> 'extra_sets' ->> 'x' from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'), '1', 'live state is saved');
select is(public.open_workout() ->> 'id', '00000000-0000-0000-0000-0000000000d1', 'open_workout finds it');

-- Only one open workout: another device starting a different one gets the open one back.
select is(public.sync_workout(pg_temp.payload('00000000-0000-0000-0000-0000000000d2')) ->> 'status', 'other_open', 'a second start is refused: other_open');
select is(public.sync_workout(pg_temp.payload('00000000-0000-0000-0000-0000000000d2')) -> 'workout' ->> 'id', '00000000-0000-0000-0000-0000000000d1', 'and it returns the open workout');
select is((select count(*) from public.sessions where id = '00000000-0000-0000-0000-0000000000d2'), 0::bigint, 'the second workout was not created');

-- Sets, and sending them again changes nothing.
select is(jsonb_array_length(public.sync_workout(pg_temp.payload('00000000-0000-0000-0000-0000000000d1', jsonb_build_array(
            pg_temp.set_json('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 1, 40, 8, 30),
            pg_temp.set_json('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1', 2, 40, 7, 20)))) -> 'workout' -> 'sets'),
          2, 'two sets are saved and returned');
select public.sync_workout(pg_temp.payload('00000000-0000-0000-0000-0000000000d1', jsonb_build_array(
  pg_temp.set_json('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 1, 40, 8, 30),
  pg_temp.set_json('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1', 2, 40, 7, 20))));
select is(pg_temp.sets_in('00000000-0000-0000-0000-0000000000d1'), 2::bigint, 'sending the same sets again creates no duplicates (still 2 rows)');

-- The same set from another device (different id): newer log wins, the row keeps its id.
select public.sync_workout(pg_temp.payload('00000000-0000-0000-0000-0000000000d1', jsonb_build_array(
  pg_temp.set_json('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000e1', 1, 44, 9, 10))));
select is((select reps from public.sets where session_id = '00000000-0000-0000-0000-0000000000d1' and set_no = 1 and deleted_at is null), 9, 'a newer log of the same set wins');
select is((select id from public.sets where session_id = '00000000-0000-0000-0000-0000000000d1' and set_no = 1 and deleted_at is null), '00000000-0000-0000-0000-0000000000f1'::uuid, 'and the row keeps its original id');
select is(pg_temp.sets_in('00000000-0000-0000-0000-0000000000d1'), 2::bigint, 'still 2 rows');
select public.sync_workout(pg_temp.payload('00000000-0000-0000-0000-0000000000d1', jsonb_build_array(
  pg_temp.set_json('00000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-0000000000e1', 1, 20, 3, 50))));
select is((select reps from public.sets where session_id = '00000000-0000-0000-0000-0000000000d1' and set_no = 1 and deleted_at is null), 9, 'an older log of the same set is ignored');

-- Deleting: gone, and not brought back by a device that still has it.
select public.sync_workout(pg_temp.payload('00000000-0000-0000-0000-0000000000d1', '[]', '["00000000-0000-0000-0000-0000000000f2"]'));
select is(pg_temp.sets_in('00000000-0000-0000-0000-0000000000d1'), 1::bigint, 'a deleted set is removed');
select public.sync_workout(pg_temp.payload('00000000-0000-0000-0000-0000000000d1', jsonb_build_array(
  pg_temp.set_json('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e1', 2, 40, 7, 20))));
select is(pg_temp.sets_in('00000000-0000-0000-0000-0000000000d1'), 1::bigint, 'a device that still has the deleted set does not bring it back');
select public.sync_workout(pg_temp.payload('00000000-0000-0000-0000-0000000000d1', jsonb_build_array(
  pg_temp.set_json('00000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-0000000000e1', 2, 38, 8, 5))));
select is(pg_temp.sets_in('00000000-0000-0000-0000-0000000000d1'), 2::bigint, 'the freed set number can be logged again (new id)');

-- Live state: last writer wins, and it is left alone when not sent.
select public.sync_workout(pg_temp.payload('00000000-0000-0000-0000-0000000000d1'));
select is((select live -> 'extra_sets' ->> 'x' from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'), '1', 'live is untouched when a device does not send it');
select public.sync_workout(pg_temp.payload('00000000-0000-0000-0000-0000000000d1', '[]', '[]', '{"live": {"extra_sets": {"x": 2}}}'));
select is((select live -> 'extra_sets' ->> 'x' from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'), '2', 'live is replaced when a device sends it');

-- A workout in progress never shows up as "last time" or "last done".
select is((select count(*) from public.last_performance where exercise_id = '00000000-0000-0000-0000-0000000000e1'), 0::bigint, 'an open workout is not "last time"');
select is((select last_started_at from public.routine_status where routine_id = '00000000-0000-0000-0000-0000000000b1'), null, 'and does not count as the routine being done');

-- Finishing: ended, feeling saved, live cleared, the waiting plan used. Repeating it changes nothing.
select is(public.sync_workout(pg_temp.payload('00000000-0000-0000-0000-0000000000d1') || jsonb_build_object('ended_at', now(), 'feeling', 4)) ->> 'status', 'finished', 'finishing returns finished');
select is((select feeling from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'), 4::smallint, 'the feeling is saved');
select is((select live from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'), null, 'live is cleared');
select is((select status from public.planned_sessions where id = '00000000-0000-0000-0000-0000000000c1'), 'used', 'the waiting plan was marked used (finish_session ran)');
select is(public.open_workout(), null, 'nothing is open afterwards');

-- A workout made offline can be uploaded finished even while another one is open; and a workout can be thrown away.
select public.sync_workout(pg_temp.payload('00000000-0000-0000-0000-0000000000d3'));
select is(public.sync_workout(pg_temp.payload('00000000-0000-0000-0000-0000000000d4') || jsonb_build_object('ended_at', now())) ->> 'status', 'finished', 'uploading a finished offline workout is not blocked by an open one');
select is(public.sync_workout(pg_temp.payload('00000000-0000-0000-0000-0000000000d3') || '{"discard": true}') ->> 'status', 'deleted', 'discarding returns deleted');
select is(public.sync_workout(pg_temp.payload('00000000-0000-0000-0000-0000000000d3')) ->> 'status', 'deleted', 'a discarded workout stays deleted');

reset role;
select ok(not has_function_privilege('anon', 'public.sync_workout(jsonb)', 'execute'), 'anonymous callers cannot sync');

select * from finish();
rollback;
