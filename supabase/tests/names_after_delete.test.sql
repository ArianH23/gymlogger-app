-- Tests for names that can be used again after a delete, and delete_exercise. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'test@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'other@example.com');
insert into public.exercises (id, user_id, name) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Zz Used'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Zz Backup'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', 'Zz Free'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a1', 'Zz In Deleted Routine'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 'Zz Not Mine');
insert into public.routines (id, user_id, name) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Zz Routine'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'Zz Gone Routine');
insert into public.routine_exercises (user_id, routine_id, exercise_id, position, target_sets, backup_exercise_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 1, 3, '00000000-0000-0000-0000-0000000000e2'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e4', 1, 3, null);
update public.routines set deleted_at = now() where id = '00000000-0000-0000-0000-0000000000b2';
insert into public.sessions (id, user_id, title, started_at, ended_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'old', '2026-01-01 10:00+00', '2026-01-01 11:00+00');
insert into public.sets (user_id, session_id, exercise_id, set_no, weight_kg, reps) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e3', 1, 40, 9);

-- Names: unique among the live ones only.
select throws_ok($$insert into public.routines (user_id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Zz Routine')$$, '23505', null, 'two live routines cannot share a name');
select lives_ok($$insert into public.routines (user_id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Zz Gone Routine')$$, 'a deleted routine''s name can be used again');
select throws_ok($$insert into public.exercises (user_id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Zz Free')$$, '23505', null, 'two live exercises cannot share a name');
select lives_ok($$insert into public.routines (user_id, name) values ('00000000-0000-0000-0000-0000000000a2', 'Zz Routine')$$, 'another user can use the same name');
select throws_ok($$update public.routines set deleted_at = null where id = '00000000-0000-0000-0000-0000000000b2'$$, '23505', null, 'bringing the deleted routine back is refused while its name is taken');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

-- delete_exercise
select throws_like($$select public.delete_exercise('00000000-0000-0000-0000-0000000000e1')$$, '%used in the routine "Zz Routine"%', 'an exercise in a routine is refused, naming the routine');
select throws_like($$select public.delete_exercise('00000000-0000-0000-0000-0000000000e2')$$, '%used in the routine "Zz Routine"%', 'so is one that is only a backup');
select lives_ok($$select public.delete_exercise('00000000-0000-0000-0000-0000000000e4')$$, 'an exercise left only in a deleted routine can be deleted');
select lives_ok($$select public.delete_exercise('00000000-0000-0000-0000-0000000000e3')$$, 'an exercise no routine uses can be deleted');
select isnt((select deleted_at from public.exercises where id = '00000000-0000-0000-0000-0000000000e3'), null, 'it is a soft delete: the row is marked');
select is((select count(*) from public.sets where exercise_id = '00000000-0000-0000-0000-0000000000e3'), 1::bigint, 'and its logged sets stay in the history');
select lives_ok($$insert into public.exercises (user_id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Zz Free')$$, 'its name can be used again');
select throws_like($$select public.delete_exercise('00000000-0000-0000-0000-0000000000e3')$$, '%exercise not found%', 'deleting it a second time says it is not found (the new one has another id)');
select throws_like($$select public.delete_exercise('00000000-0000-0000-0000-0000000000f1')$$, '%exercise not found%', 'someone else''s exercise is not found');

reset role;
set local role anon;
select throws_ok($$select public.delete_exercise('00000000-0000-0000-0000-0000000000e3')$$, '42501', null, 'anonymous callers cannot delete exercises');
reset role;

select * from finish();
rollback;
