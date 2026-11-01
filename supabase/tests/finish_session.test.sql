-- Tests for finish_session. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'test@example.com');
insert into public.routines (id, user_id, name) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Zz Finish Routine');
insert into public.exercises (id, user_id, name, rep_min, rep_max, increment_kg) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Zz Finish Exercise', 6, 10, 4);
insert into public.routine_exercises (user_id, routine_id, exercise_id, position, target_sets)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1',
        '00000000-0000-0000-0000-0000000000e1', 1, 3);

-- An unfinished session of the routine, with one set.
insert into public.sessions (id, user_id, routine_id, title, started_at)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000b1', 'Zz Finish Routine', now() - interval '1 hour');
insert into public.sets (user_id, session_id, exercise_id, set_no, weight_kg, reps)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000e1', 1, 40, 10);

-- Pending plans from before the session (one claude, one rules) and one made later.
insert into public.planned_sessions (id, user_id, routine_id, created_by, status, created_at) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'claude', 'pending', now() - interval '2 hours'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'rules',  'pending', now() - interval '2 hours'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'claude', 'pending', now() + interval '1 hour');

create temp table result (r jsonb);
insert into result select public.finish_session('00000000-0000-0000-0000-0000000000d1');

select isnt((select ended_at from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'), null::timestamptz,
            'ended_at is set');
select is((select r ->> 'plans_marked_used' from result), '2', 'two earlier pending plans marked used');
select is((select status from public.planned_sessions where id = '00000000-0000-0000-0000-0000000000c1'), 'used', 'claude plan used');
select is((select used_by_session_id from public.planned_sessions where id = '00000000-0000-0000-0000-0000000000c2'),
          '00000000-0000-0000-0000-0000000000d1'::uuid, 'plan remembers which session used it');
select is((select status from public.planned_sessions where id = '00000000-0000-0000-0000-0000000000c3'), 'pending',
          'a plan created after the session ended stays pending');
select is((select count(*) from public.planned_sessions where routine_id = '00000000-0000-0000-0000-0000000000b1'
                                                          and created_by = 'rules' and status = 'pending'), 1::bigint,
          'a fresh rules plan was generated');
select is((select target_weight_kg from public.planned_sets where planned_session_id = (select (r ->> 'rules_plan_id')::uuid from result)
                                                           and set_no = 1), 44::numeric,
          'the new plan uses the finished session (40 kg x 10 -> 44 kg)');

-- Calling it again must not move ended_at nor break anything.
create temp table first_end as select ended_at from public.sessions where id = '00000000-0000-0000-0000-0000000000d1';
select pg_sleep(0.01);
select lives_ok($$select public.finish_session('00000000-0000-0000-0000-0000000000d1')$$, 'second call works');
select is((select ended_at from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'), (select ended_at from first_end),
          'second call keeps the original ended_at');
select is((select count(*) from public.planned_sessions where routine_id = '00000000-0000-0000-0000-0000000000b1'
                                                          and created_by = 'rules' and status = 'pending'), 1::bigint,
          'still exactly one pending rules plan');

-- A session with no routine just ends.
insert into public.sessions (id, user_id, title, started_at)
values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'Free session', now() - interval '1 hour');
select is((select public.finish_session('00000000-0000-0000-0000-0000000000d2') ->> 'rules_plan_id'), null, 'no routine, no plan');
select isnt((select ended_at from public.sessions where id = '00000000-0000-0000-0000-0000000000d2'), null::timestamptz,
            'free session is ended');

select throws_ilike($$select public.finish_session('00000000-0000-0000-0000-00000000dead')$$, '%not found%',
                    'unknown session raises');

select * from finish();
rollback;
