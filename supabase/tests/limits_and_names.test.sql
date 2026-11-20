-- Tests for the limits the server enforces and for names that differ only by case. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'test@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'other@example.com');
insert into public.exercises (id, user_id, name) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Zz Limit Press');
insert into public.routines (id, user_id, name) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Zz Limit Routine');
insert into public.sessions (id, user_id, title, started_at, ended_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'limits', '2026-01-01 10:00+00', '2026-01-01 11:00+00');

-- names: the same name ignoring case and surrounding spaces is the same name
select throws_ok($$insert into public.exercises (user_id, name) values ('00000000-0000-0000-0000-0000000000a1', 'zz limit press')$$, '23505', null, 'an exercise name that differs only by case is refused');
select throws_ok($$insert into public.exercises (user_id, name) values ('00000000-0000-0000-0000-0000000000a1', '  Zz Limit Press ')$$, '23505', null, 'so is one with spaces around it');
select throws_ok($$insert into public.routines (user_id, name) values ('00000000-0000-0000-0000-0000000000a1', 'ZZ LIMIT ROUTINE')$$, '23505', null, 'and the same for routines');
select lives_ok($$insert into public.exercises (user_id, name) values ('00000000-0000-0000-0000-0000000000a2', 'zz limit press')$$, 'another user can use the name');
update public.exercises set deleted_at = now() where id = '00000000-0000-0000-0000-0000000000e1';
select lives_ok($$insert into public.exercises (user_id, name) values ('00000000-0000-0000-0000-0000000000a1', 'ZZ LIMIT PRESS')$$, 'a deleted exercise does not hold its name, whatever the case');

-- lengths
select throws_ok($$insert into public.exercises (user_id, name) values ('00000000-0000-0000-0000-0000000000a1', repeat('x', 101))$$, '23514', null, 'an exercise name over 100 characters is refused');
select throws_ok($$insert into public.routines (user_id, name) values ('00000000-0000-0000-0000-0000000000a1', '')$$, '23514', null, 'an empty routine name is refused');
select throws_ok($$update public.sessions set title = repeat('x', 256) where id = '00000000-0000-0000-0000-0000000000d1'$$, '23514', null, 'a session title over 255 characters is refused');

-- sets
select throws_ok($$insert into public.sets (user_id, session_id, exercise_id, set_no, weight_kg, reps) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 1, 40, 501)$$, '23514', null, 'more than 500 reps is refused');
select throws_ok($$insert into public.sets (user_id, session_id, exercise_id, set_no, weight_kg, reps) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 1, 2001, 5)$$, '23514', null, 'more than 2000 kg is refused');
select lives_ok($$insert into public.sets (user_id, session_id, exercise_id, set_no, weight_kg, reps) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 1, 2000, 500)$$, 'the largest allowed set goes in');

-- a live layout that is not an object is ignored
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select public.sync_workout(jsonb_build_object('id', '00000000-0000-0000-0000-0000000000d9'::uuid, 'title', 'live test', 'started_at', now() - interval '1 hour', 'live', '"just text"'::jsonb));
select is((select live from public.sessions where id = '00000000-0000-0000-0000-0000000000d9'), null, 'a live layout that is a string is not stored');
select public.sync_workout(jsonb_build_object('id', '00000000-0000-0000-0000-0000000000d9'::uuid, 'title', 'live test', 'started_at', now() - interval '1 hour', 'live', '{"extra_sets": {"a": 1}}'::jsonb));
select is((select live ->> 'extra_sets' from public.sessions where id = '00000000-0000-0000-0000-0000000000d9'), '{"a": 1}', 'an object layout is');
reset role;

select * from finish();
rollback;
