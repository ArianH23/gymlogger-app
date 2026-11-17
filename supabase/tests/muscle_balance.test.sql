-- Tests for the balance comparisons (push/pull, front/back, upper/lower, quads/hamstrings). Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'one@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'two@example.com');

-- Named like the catalog, so the trigger tags them:
--   bench: chest primary, triceps + front delts secondary     row: lats + upper back primary, biceps + rear delts secondary
--   leg extension: quads primary                              lateral raise: side delts primary (neither push nor pull)
insert into public.exercises (id, user_id, name, unilateral) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Bench Press (Barbell)', false),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Seated Row (Machine)', false),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', 'Leg Extension (Machine)', false),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000a1', 'Lateral Raise (Machine)', false),
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000a2', 'Bench Press (Barbell)', false);

insert into public.sessions (id, user_id, title, started_at, ended_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'monday', '2026-01-05 10:00+00', '2026-01-05 11:00+00'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'next week', '2026-01-14 10:00+00', '2026-01-14 11:00+00'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a2', 'other user', '2026-01-05 10:00+00', '2026-01-05 11:00+00');

create function pg_temp.s(p_user text, p_session text, p_ex text, p_no int) returns void language sql as $$
  insert into public.sets (user_id, session_id, exercise_id, set_no, weight_kg, reps)
  values (('00000000-0000-0000-0000-0000000000' || p_user)::uuid, ('00000000-0000-0000-0000-0000000000' || p_session)::uuid,
          ('00000000-0000-0000-0000-0000000000' || p_ex)::uuid, p_no, 40, 8)
$$;

-- Week of 5 Jan: 4 bench (push: chest 4 + triceps 2 + front delts 2 = 8), 2 rows (pull: lats 2 + upper back 2 + biceps 1 + rear delts 1 = 6),
-- 3 leg extensions (quads 3), 2 lateral raises (side delts 2).
select pg_temp.s('a1','d1','e1',1); select pg_temp.s('a1','d1','e1',2); select pg_temp.s('a1','d1','e1',3); select pg_temp.s('a1','d1','e1',4);
select pg_temp.s('a1','d1','e2',1); select pg_temp.s('a1','d1','e2',2);
select pg_temp.s('a1','d1','e3',1); select pg_temp.s('a1','d1','e3',2); select pg_temp.s('a1','d1','e3',3);
select pg_temp.s('a1','d1','e4',1); select pg_temp.s('a1','d1','e4',2);
-- Week of 12 Jan: 2 rows only. The other user: 1 bench.
select pg_temp.s('a1','d2','e2',1); select pg_temp.s('a1','d2','e2',2);
select pg_temp.s('a2','d3','e5',1);

create function pg_temp.wb(p_week date, p_pair text) returns public.weekly_balance language sql as $$
  select * from public.weekly_balance where user_id = '00000000-0000-0000-0000-0000000000a1' and week_start = p_week and pair = p_pair
$$;

select is((select count(*) from public.muscle_balance_defs() d where not exists (select 1 from public.muscle_defs() m where m.muscle = d.muscle)), 0::bigint, 'every muscle in a comparison is one of the 16');
select is((select count(*) from (select pair, muscle from public.muscle_balance_defs() group by pair, muscle having count(*) > 1) x), 0::bigint, 'no muscle is on both sides of a comparison');

select is((pg_temp.wb('2026-01-05', 'push_pull')).a_sets, 8.0, 'push: chest 4 + triceps 2 + front delts 2');
select is((pg_temp.wb('2026-01-05', 'push_pull')).b_sets, 6.0, 'pull: lats 2 + upper back 2 + biceps 1 + rear delts 1 (side delts are on neither side)');
select is((pg_temp.wb('2026-01-05', 'push_pull')).a_share, 0.571, 'push share = 8 of 14');
select is((pg_temp.wb('2026-01-05', 'push_pull')).a_label, 'Push', 'side a is named');

-- front: chest 4 + front delts 2 + biceps 1 + quads 3 = 10; back: rear delts 1 + lats 2 + upper back 2 + triceps 2 = 7
select is((pg_temp.wb('2026-01-05', 'front_back')).a_sets, 10.0, 'front of the body');
select is((pg_temp.wb('2026-01-05', 'front_back')).b_sets, 7.0, 'back of the body');
-- upper: everything but the quads = 8 + 6 + 2 side delts = 16; lower: quads 3
select is((pg_temp.wb('2026-01-05', 'upper_lower')).a_sets, 16.0, 'upper body includes the side delts');
select is((pg_temp.wb('2026-01-05', 'upper_lower')).b_sets, 3.0, 'lower body');
select is((pg_temp.wb('2026-01-05', 'quads_hams')).b_sets, 0::numeric, 'a side with no sets is 0, not missing');

select is((pg_temp.wb('2026-01-12', 'push_pull')).a_share, 0.000, 'a week with pulling only: push share 0');
select is((select count(*) from public.weekly_balance where user_id = '00000000-0000-0000-0000-0000000000a1' and week_start = '2026-01-12' and pair = 'quads_hams'), 0::bigint, 'a comparison with no sets on either side has no row');
select is((select b_sets from public.monthly_balance where user_id = '00000000-0000-0000-0000-0000000000a1' and month_start = '2026-01-01' and pair = 'push_pull'), 12.0, 'January: both weeks add up, pull 6 + 6');
select is((select a_sets from public.weekly_balance where user_id = '00000000-0000-0000-0000-0000000000a2' and week_start = '2026-01-05' and pair = 'push_pull'), 2.0, 'another user is counted separately (1 bench: chest 1 + triceps 0.5 + front delts 0.5)');

select * from finish();
rollback;
