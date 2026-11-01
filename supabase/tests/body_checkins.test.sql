-- Tests for body check-ins, plan performance and the weekly overview. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'test@example.com');
insert into public.exercises (id, user_id, name, load_type) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Zz Perf Press', 'weighted'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Zz Perf Chin', 'assisted');
insert into public.routines (id, user_id, name) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Zz Perf Routine');

-- A finished session on Monday 5 Jan 2026 with 3 sets: press 40x8, press 40x5, chin 45 assist x8.
insert into public.sessions (id, user_id, routine_id, title, started_at, ended_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 's1', '2026-01-05 10:00+00', '2026-01-05 11:00+00');
insert into public.sets (user_id, session_id, exercise_id, set_no, weight_kg, reps) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 1, 40, 8),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 2, 40, 5),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e2', 1, 45, 8);

-- Two plans were used by that session: a claude plan (the one followed) and a rules plan that must be ignored.
insert into public.planned_sessions (id, user_id, routine_id, created_by, status, used_by_session_id, created_at) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'claude', 'used', '00000000-0000-0000-0000-0000000000d1', now() - interval '1 day'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'rules',  'used', '00000000-0000-0000-0000-0000000000d1', now() - interval '1 day');
insert into public.planned_sets (user_id, planned_session_id, exercise_id, exercise_position, set_no, target_weight_kg, target_reps_min) values
  -- claude plan: press set 1 met, press set 2 missed (5 < 8), press set 3 never done, chin met (45 <= 50 assistance)
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 1, 1, 40, 8),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 1, 2, 40, 8),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e1', 1, 3, 40, 8),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e2', 2, 1, 50, 8),
  -- rules plan: impossible targets, must not count
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e1', 1, 1, 100, 20);

select is((select planned_sets from public.session_plan_performance where session_id = '00000000-0000-0000-0000-0000000000d1'), 4::bigint,
          'only the plan that was followed (claude) counts: 4 planned sets');
select is((select done_sets from public.session_plan_performance where session_id = '00000000-0000-0000-0000-0000000000d1'), 3::bigint, '3 of them were done');
select is((select met_sets from public.session_plan_performance where session_id = '00000000-0000-0000-0000-0000000000d1'), 2::bigint,
          '2 met: set 1 (8 reps at 40) and the assisted chin-up (45 is less help than 50)');

-- Check-ins: two in the week of 5 Jan, one the week before.
insert into public.body_checkins (user_id, checked_on, bodyweight_kg, waist_cm, sleep_hours, body_fat_pct, notes) values
  ('00000000-0000-0000-0000-0000000000a1', '2026-01-06', 70.0, 76.0, 6.0, 18.0, 'start'),
  ('00000000-0000-0000-0000-0000000000a1', '2026-01-08', 71.0, null, 7.0, null, null),
  ('00000000-0000-0000-0000-0000000000a1', '2025-12-30', 72.0, 77.0, null, null, null);

create function pg_temp.wk(p_week text) returns public.weekly_overview language sql as $$
  select * from public.weekly_overview where user_id = '00000000-0000-0000-0000-0000000000a1' and week_start = p_week::date
$$;

select is((pg_temp.wk('2026-01-05')).sessions, 1::bigint, 'weekly overview: one session that week');
select is((pg_temp.wk('2026-01-05')).sets, 3::bigint, 'weekly overview: 3 working sets');
select is((pg_temp.wk('2026-01-05')).volume_kg, 880::numeric, 'weekly overview: volume = 40x8 + 40x5 + 45x8 = 880');
select is((pg_temp.wk('2026-01-05')).bodyweight_kg, 70.50, 'weekly overview: average bodyweight of the week');
select is((pg_temp.wk('2026-01-05')).waist_cm, 76.0, 'weekly overview: averages skip missing values');
select is((pg_temp.wk('2026-01-05')).sleep_hours, 6.5, 'weekly overview: average sleep');
select is((pg_temp.wk('2026-01-05')).met_sets, 2::bigint, 'weekly overview: plan performance carried in');
select is((pg_temp.wk('2025-12-29')).sessions, 0::bigint, 'a week with only a check-in still appears, with 0 sessions');
select is((pg_temp.wk('2025-12-29')).bodyweight_kg, 72.00, 'and shows its bodyweight');

-- One check-in per day, and sensible limits.
select throws_ok($$insert into public.body_checkins (user_id, checked_on, bodyweight_kg) values ('00000000-0000-0000-0000-0000000000a1', '2026-01-06', 80)$$,
                 '23505', null, 'a second check-in on the same day is rejected');
select throws_ok($$insert into public.body_checkins (user_id, checked_on, bodyweight_kg) values ('00000000-0000-0000-0000-0000000000a1', '2026-02-01', 8)$$,
                 '23514', null, 'an impossible bodyweight (8 kg) is rejected');
update public.body_checkins set deleted_at = now() where checked_on = '2026-01-08';
select is((pg_temp.wk('2026-01-05')).bodyweight_kg, 70.00, 'a deleted check-in no longer counts');
select is((select count(*) from pg_policies where tablename = 'body_checkins'), 1::bigint, 'row level security policy exists');

select * from finish();
rollback;
