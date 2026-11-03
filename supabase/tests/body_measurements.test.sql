-- Tests for the body measurements: the new check-in columns, body_profile (height), body_metrics, body_latest and the
-- new weekly averages. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'one@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'two@example.com'),
  ('00000000-0000-0000-0000-0000000000a3', 'three@example.com');

-- Height: sensible, and one row per user.
select lives_ok($$insert into public.body_profile (user_id, height_cm) values ('00000000-0000-0000-0000-0000000000a1', 162)$$, 'height can be saved');
select throws_ok($$insert into public.body_profile (user_id, height_cm) values ('00000000-0000-0000-0000-0000000000a2', 50)$$, '23514', null, 'an impossible height (50 cm) is rejected');
select throws_ok($$insert into public.body_profile (user_id, height_cm) values ('00000000-0000-0000-0000-0000000000a1', 181)$$, '23505', null, 'one height row per user');

-- The new columns have sensible limits.
select throws_ok($$insert into public.body_checkins (user_id, checked_on, neck_cm) values ('00000000-0000-0000-0000-0000000000a2', '2025-12-01', 5)$$, '23514', null, 'a 5 cm neck is rejected');
select throws_ok($$insert into public.body_checkins (user_id, checked_on, resting_hr_bpm) values ('00000000-0000-0000-0000-0000000000a2', '2025-12-01', 200)$$, '23514', null, 'a resting heart rate of 200 is rejected');
select throws_ok($$insert into public.body_checkins (user_id, checked_on, calories_kcal) values ('00000000-0000-0000-0000-0000000000a2', '2025-12-01', 100)$$, '23514', null, '100 kcal a day is rejected');

-- User one: a full check-in, a second one in the same week, then two a month later.
insert into public.body_checkins (user_id, checked_on, bodyweight_kg, body_fat_pct, waist_cm, neck_cm, shoulders_cm, abdomen_cm, bicep_l_cm, calories_kcal, protein_g, steps) values
  ('00000000-0000-0000-0000-0000000000a1', '2026-01-05', 90, 20, 85, 38, 120, 90, 36, 2400, 160, 10000);
insert into public.body_checkins (user_id, checked_on, calories_kcal, steps, resting_hr_bpm) values
  ('00000000-0000-0000-0000-0000000000a1', '2026-01-07', 2600, 8000, 55);
insert into public.body_checkins (user_id, checked_on, waist_cm, shoulders_cm) values
  ('00000000-0000-0000-0000-0000000000a1', '2026-02-09', 82, 121),
  ('00000000-0000-0000-0000-0000000000a1', '2026-02-12', 81, null);

create function pg_temp.metric(p_user text, p_day text, p_metric text) returns numeric language sql as $$
  select value from public.body_metrics where user_id = p_user::uuid and checked_on = p_day::date and metric = p_metric
$$;

select is((select count(*) from public.body_metrics where user_id = '00000000-0000-0000-0000-0000000000a1' and checked_on = '2026-01-05'), 14::bigint,
          'a full check-in gives 10 stored numbers and 4 calculated ones');
select is(pg_temp.metric('00000000-0000-0000-0000-0000000000a1', '2026-01-05', 'shoulder_waist_ratio'), 1.41, 'shoulders / waist = 120 / 85 = 1.41');
select is(pg_temp.metric('00000000-0000-0000-0000-0000000000a1', '2026-01-05', 'waist_height_ratio'), 0.525, 'waist / height = 85 / 162 = 0.525');
select is(pg_temp.metric('00000000-0000-0000-0000-0000000000a1', '2026-01-05', 'lean_mass_kg'), 72.0, 'lean mass = 90 kg at 20% = 72 kg');
select is(pg_temp.metric('00000000-0000-0000-0000-0000000000a1', '2026-01-05', 'tape_body_fat_pct'), 23.0, 'body fat from the tape (abdomen 90, neck 38, height 162) = 23.0%');
select is((select count(*) from public.body_metrics where user_id = '00000000-0000-0000-0000-0000000000a1' and metric = 'hips_cm'), 0::bigint, 'an empty field is not a measurement: no row');

-- No height: the ratios that need it are missing, the others are not. A neck wider than the waist gives no tape estimate.
insert into public.body_checkins (user_id, checked_on, shoulders_cm, waist_cm, neck_cm) values ('00000000-0000-0000-0000-0000000000a2', '2026-01-05', 110, 80, 38);
select is((select count(*) from public.body_metrics where user_id = '00000000-0000-0000-0000-0000000000a2' and metric in ('waist_height_ratio', 'tape_body_fat_pct')), 0::bigint,
          'without a height there is no waist / height and no tape estimate');
insert into public.body_profile (user_id, height_cm) values ('00000000-0000-0000-0000-0000000000a3', 162);
insert into public.body_checkins (user_id, checked_on, neck_cm, waist_cm) values ('00000000-0000-0000-0000-0000000000a3', '2026-01-05', 60, 50);
select is((select count(*) from public.body_metrics where user_id = '00000000-0000-0000-0000-0000000000a3' and metric = 'tape_body_fat_pct'), 0::bigint,
          'a neck wider than the waist gives no (nonsense) tape estimate');
insert into public.body_checkins (user_id, checked_on, waist_cm, deleted_at) values ('00000000-0000-0000-0000-0000000000a3', '2026-01-12', 70, now());
select is((select count(*) from public.body_metrics where user_id = '00000000-0000-0000-0000-0000000000a3' and checked_on = '2026-01-12'), 0::bigint, 'a deleted check-in has no rows');

-- Latest against about four weeks earlier (the newest check-in at least 25 days before the latest one).
select is((select latest_value from public.body_latest where user_id = '00000000-0000-0000-0000-0000000000a1' and metric = 'waist_cm'), 81::numeric, 'latest waist is from the newest check-in that has one');
select is((select earlier_on from public.body_latest where user_id = '00000000-0000-0000-0000-0000000000a1' and metric = 'waist_cm'), '2026-01-05'::date,
          'the comparison is the check-in from five weeks earlier, not the one from three days earlier');
select is((select change from public.body_latest where user_id = '00000000-0000-0000-0000-0000000000a1' and metric = 'waist_cm'), -4::numeric, 'waist change = 81 - 85 = -4');
select is((select change_pct from public.body_latest where user_id = '00000000-0000-0000-0000-0000000000a1' and metric = 'waist_cm'), -4.7, 'change in percent = -4 / 85 = -4.7%');
select is((select earlier_value from public.body_latest where user_id = '00000000-0000-0000-0000-0000000000a1' and metric = 'bicep_l_cm'), null, 'a metric measured only once has no earlier value');

-- Weekly averages (week of Monday 5 Jan 2026: two check-ins).
select is((select calories_kcal from public.weekly_overview where user_id = '00000000-0000-0000-0000-0000000000a1' and week_start = '2026-01-05'), 2500::numeric, 'weekly average calories = (2400 + 2600) / 2');
select is((select steps from public.weekly_overview where user_id = '00000000-0000-0000-0000-0000000000a1' and week_start = '2026-01-05'), 9000::numeric, 'weekly average steps = (10000 + 8000) / 2');

select is((select count(*) from pg_policies where tablename = 'body_profile'), 1::bigint, 'row level security policy exists on body_profile');

select * from finish();
rollback;
