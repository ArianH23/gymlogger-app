-- Tests for the shape model (shape_defaults, body_targets, body_shape) and the wrist and ankle columns.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'one@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'two@example.com');
insert into public.body_profile (user_id, height_cm) values ('00000000-0000-0000-0000-0000000000a1', 162);

-- User one measured shoulders 108, waist 76, neck 38 and a left bicep 29. User two has measurements but no height.
insert into public.body_checkins (user_id, checked_on, shoulders_cm, waist_cm, neck_cm, bicep_l_cm) values
  ('00000000-0000-0000-0000-0000000000a1', '2026-01-05', 108, 76, 38, 29),
  ('00000000-0000-0000-0000-0000000000a2', '2026-01-05', 108, 76, 38, 29);

create function pg_temp.shape(p_metric text) returns public.body_shape language sql as $$
  select * from public.body_shape where user_id = '00000000-0000-0000-0000-0000000000a1' and metric = p_metric
$$;

select is((select count(*) from public.shape_defaults()), 14::bigint, 'the model covers 14 measurements');
select is((pg_temp.shape('shoulders_cm')).target_value, 116.6, 'shoulders target = 0.72 x 162 = 116.6');
select is((pg_temp.shape('shoulders_cm')).gap, 8.6, 'shoulders gap = 8.6 cm to grow');
select is((pg_temp.shape('shoulders_cm')).closeness, 0.926, 'shoulders closeness = 108 / 116.6');
select is((pg_temp.shape('waist_cm')).target_value, 71.3, 'waist target = 0.44 x 162 = 71.3');
select is((pg_temp.shape('waist_cm')).gap, -4.7, 'waist gap is negative: 4.7 cm to shrink');
select is((pg_temp.shape('waist_cm')).closeness, 0.938, 'waist closeness = target / you = 71.3 / 76');
select is((pg_temp.shape('neck_cm')).closeness, 1.000, 'a measurement already past its target is capped at closeness 1');
select is((select count(*) from public.body_shape where user_id = '00000000-0000-0000-0000-0000000000a1'), 4::bigint, 'only measured metrics appear (4 of 14)');
select is((select count(*) from public.body_shape where user_id = '00000000-0000-0000-0000-0000000000a2'), 0::bigint, 'without a height there is no model target, so no rows');

-- Your own target replaces the model for that measurement only.
insert into public.body_targets (user_id, metric, target_value) values ('00000000-0000-0000-0000-0000000000a1', 'waist_cm', 70);
select is((pg_temp.shape('waist_cm')).target_value, 70.0, 'your own target replaces the model');
select ok((pg_temp.shape('waist_cm')).target_is_custom and not (pg_temp.shape('shoulders_cm')).target_is_custom, 'and is flagged as custom, only for that measurement');
select throws_ok($$insert into public.body_targets (user_id, metric, target_value) values ('00000000-0000-0000-0000-0000000000a1', 'neck_cm', 900)$$, '23514', null, 'an impossible target is rejected');

-- Wrist and ankle.
insert into public.body_checkins (user_id, checked_on, wrist_cm, ankle_cm) values ('00000000-0000-0000-0000-0000000000a1', '2026-01-06', 16.0, 21);
select is((select value from public.body_metrics where user_id = '00000000-0000-0000-0000-0000000000a1' and metric = 'wrist_cm'), 16.0, 'wrist appears in body_metrics');
select throws_ok($$insert into public.body_checkins (user_id, checked_on, wrist_cm) values ('00000000-0000-0000-0000-0000000000a2', '2026-01-06', 5)$$, '23514', null, 'a 5 cm wrist is rejected');
select is((select count(*) from pg_policies where tablename = 'body_targets'), 1::bigint, 'row level security policy exists on body_targets');

select * from finish();
rollback;
