-- Tests for suggested backups (suggest_backups). Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'test@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'other@example.com');
insert into public.exercises (id, user_id, name, equipment) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Zz Machine Press', 'machine'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Zz Dumbbell Press', 'dumbbell'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', 'Zz Cable Press', 'cable'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a1', 'Zz Other Machine Press', 'machine'),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000a1', 'Zz Cable Fly', 'cable'),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000a1', 'Zz Row', 'cable'),
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000a1', 'Zz Pushdown', 'cable'),
  ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000a1', 'Zz Untagged', 'cable'),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000a1', 'Zz Deleted Press', 'cable'),
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 'Zz Other Users Press', 'cable'),
  ('00000000-0000-0000-0000-0000000000e0', '00000000-0000-0000-0000-0000000000a1', 'Zz Squat', 'barbell'),
  ('00000000-0000-0000-0000-000000000e11', '00000000-0000-0000-0000-0000000000a1', 'Zz Squat Variant', 'dumbbell'),
  ('00000000-0000-0000-0000-000000000e12', '00000000-0000-0000-0000-0000000000a1', 'Zz Squat Twin', 'machine');
update public.exercises set deleted_at = now() where id = '00000000-0000-0000-0000-0000000000e9';

-- The machine press: chest (primary), triceps (secondary). The presses have the same tags; the fly has chest only;
-- the row works the lats; the pushdown has triceps as its primary (a secondary one in the press: not enough).
insert into public.exercise_muscles (user_id, exercise_id, muscle, role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'chest', 'primary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'triceps', 'secondary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2', 'chest', 'primary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2', 'triceps', 'secondary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e3', 'chest', 'primary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e3', 'triceps', 'secondary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e4', 'chest', 'primary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e4', 'triceps', 'secondary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e5', 'chest', 'primary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e6', 'lats', 'primary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e7', 'triceps', 'primary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e9', 'chest', 'primary'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f1', 'chest', 'primary'),
  -- a squat: quads primary, glutes and hamstrings secondary. The twin has the same tags; the variant has hamstrings as a primary muscle too (a close match, not an exact one).
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e0', 'quads', 'primary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e0', 'glutes', 'secondary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e0', 'hamstrings', 'secondary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000e11', 'quads', 'primary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000e11', 'hamstrings', 'primary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000e11', 'glutes', 'secondary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000e12', 'quads', 'primary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000e12', 'glutes', 'secondary'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000e12', 'hamstrings', 'secondary');

-- The dumbbell press has been done (two sessions, a warm-up-free working set each); the others never.
insert into public.sessions (id, user_id, title, started_at, ended_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'one', '2026-01-01 10:00+00', '2026-01-01 11:00+00'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'two', '2026-01-08 10:00+00', '2026-01-08 11:00+00');
insert into public.sets (user_id, session_id, exercise_id, set_no, weight_kg, reps) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2', 1, 40, 9),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2', 2, 40, 8),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e2', 1, 42, 8),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000e11', 1, 30, 10),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000e11', 1, 32, 10);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

create function pg_temp.names(p_exclude uuid[] default '{}', p_limit integer default 10) returns text[] language sql as $$
  select coalesce(array_agg(name order by ord), '{}') from (
    select name, row_number() over () as ord from public.suggest_backups('00000000-0000-0000-0000-0000000000e1', p_exclude, p_limit)
  ) x
$$;

-- Order: the same muscles first; among equals, the one done before, then a different kind of equipment, then the name. The fly (chest only) is last.
select is(pg_temp.names(), array['Zz Dumbbell Press', 'Zz Cable Press', 'Zz Other Machine Press', 'Zz Cable Fly'],
  'the presses first (done before, then other equipment, then same equipment), the fly last');
select ok(not ('Zz Machine Press' = any (pg_temp.names())), 'the exercise itself is not suggested');
select ok(not ('Zz Row' = any (pg_temp.names())), 'an exercise with no shared primary muscle is not suggested');
select ok(not ('Zz Pushdown' = any (pg_temp.names())), 'a primary muscle that is only secondary in the original does not count');
select ok(not ('Zz Untagged' = any (pg_temp.names())), 'an exercise without muscle tags is not suggested');
select ok(not ('Zz Deleted Press' = any (pg_temp.names())), 'a deleted exercise is not suggested');
select ok(not ('Zz Other Users Press' = any (pg_temp.names())), 'another user''s exercise is not suggested');

select is(pg_temp.names(array['00000000-0000-0000-0000-0000000000e2']::uuid[]), array['Zz Cable Press', 'Zz Other Machine Press', 'Zz Cable Fly'], 'p_exclude leaves exercises out');
select is(cardinality(pg_temp.names('{}', 2)), 2, 'p_limit limits the list');

select is((select similarity from public.suggest_backups('00000000-0000-0000-0000-0000000000e1') where name = 'Zz Dumbbell Press'), 1.00::numeric, 'the same muscles in the same proportion match 1');
select is((select string_agg(name, ', ' order by ord) from (select name, row_number() over () as ord from public.suggest_backups('00000000-0000-0000-0000-0000000000e0')) x), 'Zz Squat Twin, Zz Squat Variant',
  'a close match that was done often comes after an exact match that was never done');
select is((select similarity from public.suggest_backups('00000000-0000-0000-0000-0000000000e0') where name = 'Zz Squat Variant'), 0.95::numeric, 'and it is 0.95, not 1.00');
select is((select similarity from public.suggest_backups('00000000-0000-0000-0000-0000000000e1') where name = 'Zz Cable Fly'), 0.89::numeric, 'chest only against chest and a little triceps matches 0.89');
select is((select times_done from public.suggest_backups('00000000-0000-0000-0000-0000000000e1') where name = 'Zz Dumbbell Press'), 2, 'times_done counts the sessions, not the sets');
select is((select shared_muscles from public.suggest_backups('00000000-0000-0000-0000-0000000000e1') where name = 'Zz Dumbbell Press'), array['Chest'], 'shared_muscles names the shared primary muscles');

-- Another user's exercise id gives nothing (row-level security).
select is((select count(*) from public.suggest_backups('00000000-0000-0000-0000-0000000000f1')), 0::bigint, 'someone else''s exercise has no suggestions');

select * from finish();
rollback;
