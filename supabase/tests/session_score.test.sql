-- Tests for the session score (tiers, session_scores view, feeling) and avg_feeling in weekly_overview.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- Tier thresholds, including both sides of every boundary.
select is(public.session_tier(90),  'great', '90% is great (boundary)');
select is(public.session_tier(89),  'good',  '89% is good');
select is(public.session_tier(70),  'good',  '70% is good (boundary)');
select is(public.session_tier(69),  'average', '69% is average');
select is(public.session_tier(50),  'average', '50% is average (boundary)');
select is(public.session_tier(49),  'weak',  '49% is weak');
select is(public.session_tier(30),  'weak',  '30% is weak (boundary)');
select is(public.session_tier(29),  'poor',  '29% is poor');
select is(public.session_tier(null), null,   'no score gives no tier');

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'test@example.com');
insert into public.exercises (id, user_id, name, load_type) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Zz Score Press', 'weighted');
insert into public.routines (id, user_id, name) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Zz Score Routine');

-- s1: followed a plan of 4 sets, met 3 (75% -> good), felt 4. s2: no plan, felt 2. s3: unfinished. s4: deleted.
-- All on Monday 5 Jan 2026, so they land in one week.
insert into public.sessions (id, user_id, routine_id, title, started_at, ended_at, feeling) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 's1', '2026-01-05 10:00+00', '2026-01-05 11:00+00', 4),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', null, 's2', '2026-01-06 10:00+00', '2026-01-06 11:00+00', 2),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1', null, 's3', '2026-01-07 10:00+00', null, 5);
insert into public.sessions (id, user_id, routine_id, title, started_at, ended_at, feeling, deleted_at) values
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a1', null, 's4', '2026-01-08 10:00+00', '2026-01-08 11:00+00', 1, now());

insert into public.sets (user_id, session_id, exercise_id, set_no, weight_kg, reps) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 1, 40, 8),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 2, 40, 8),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 3, 40, 8),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 4, 40, 5);
insert into public.planned_sessions (id, user_id, routine_id, created_by, status, used_by_session_id, created_at) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'claude', 'used', '00000000-0000-0000-0000-0000000000d1', now() - interval '1 day');
insert into public.planned_sets (user_id, planned_session_id, exercise_id, exercise_position, set_no, target_weight_kg, target_reps_min) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 1, 1, 40, 8),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 1, 2, 40, 8),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 1, 3, 40, 8),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 1, 4, 40, 8);

create function pg_temp.sc(p_id text) returns public.session_scores language sql as $$
  select * from public.session_scores where session_id = p_id::uuid
$$;

select is((pg_temp.sc('00000000-0000-0000-0000-0000000000d1')).met_sets, 3::bigint, 'planned session: 3 of 4 sets met');
select is((pg_temp.sc('00000000-0000-0000-0000-0000000000d1')).met_pct, 75, 'planned session: 75%');
select is((pg_temp.sc('00000000-0000-0000-0000-0000000000d1')).tier, 'good', 'planned session: tier good');
select is((pg_temp.sc('00000000-0000-0000-0000-0000000000d1')).feeling, 4::smallint, 'planned session: feeling kept');
select is((pg_temp.sc('00000000-0000-0000-0000-0000000000d2')).tier, null, 'a session with no plan has no tier');
select is((pg_temp.sc('00000000-0000-0000-0000-0000000000d2')).feeling, 2::smallint, 'but it still shows its feeling');
select is((select count(*) from public.session_scores where session_id in
           ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d4')), 0::bigint,
          'unfinished and deleted sessions have no row');

select throws_ok($$update public.sessions set feeling = 0 where title = 's1'$$, '23514', null, 'feeling 0 is rejected');
select throws_ok($$update public.sessions set feeling = 6 where title = 's1'$$, '23514', null, 'feeling 6 is rejected');

-- Week of 5 Jan: feelings 4 and 2 count (unfinished and deleted ones do not): average 3.0
select is((select avg_feeling from public.weekly_overview
           where user_id = '00000000-0000-0000-0000-0000000000a1' and week_start = '2026-01-05'), 3.0,
          'weekly overview: average feeling of the finished sessions');

select * from finish();
rollback;
