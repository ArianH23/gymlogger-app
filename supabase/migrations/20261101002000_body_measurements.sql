-- Body measurements: everything a tape measure gives (neck, shoulders, chest, abdomen, hips, and left and right biceps,
-- forearms, thighs and calves, next to the waist that was already there), plus what matters for a lean, muscular goal:
-- resting heart rate, and the daily averages of calories, protein and steps over the period of a check-in.
-- Every number stays optional: an empty field means "not measured", never "the same as last time".
-- Ratios and estimates (shoulders / waist, waist / height, lean mass, body fat from the tape) are views, not stored,
-- so they are always in step with the numbers they come from. Height is stored once, in body_profile.

alter table public.body_checkins
  add column neck_cm        numeric(4, 1) check (neck_cm between 20 and 70),
  add column shoulders_cm   numeric(5, 1) check (shoulders_cm between 70 and 200),
  add column chest_cm       numeric(5, 1) check (chest_cm between 60 and 200),
  add column abdomen_cm     numeric(5, 1) check (abdomen_cm between 40 and 200),
  add column hips_cm        numeric(5, 1) check (hips_cm between 60 and 200),
  add column bicep_l_cm     numeric(4, 1) check (bicep_l_cm between 15 and 70),
  add column bicep_r_cm     numeric(4, 1) check (bicep_r_cm between 15 and 70),
  add column forearm_l_cm   numeric(4, 1) check (forearm_l_cm between 15 and 60),
  add column forearm_r_cm   numeric(4, 1) check (forearm_r_cm between 15 and 60),
  add column thigh_l_cm     numeric(4, 1) check (thigh_l_cm between 30 and 120),
  add column thigh_r_cm     numeric(4, 1) check (thigh_r_cm between 30 and 120),
  add column calf_l_cm      numeric(4, 1) check (calf_l_cm between 20 and 70),
  add column calf_r_cm      numeric(4, 1) check (calf_r_cm between 20 and 70),
  add column resting_hr_bpm smallint check (resting_hr_bpm between 30 and 120),
  add column calories_kcal  integer check (calories_kcal between 500 and 10000),
  add column protein_g      integer check (protein_g between 0 and 500),
  add column steps          integer check (steps between 0 and 100000);

comment on column public.body_checkins.neck_cm is 'Neck circumference in cm, just below the larynx, same spot each time.';
comment on column public.body_checkins.shoulders_cm is 'Shoulder circumference in cm, around the widest part of the shoulders and chest, arms relaxed.';
comment on column public.body_checkins.chest_cm is 'Chest circumference in cm at nipple height, after a normal breath out.';
comment on column public.body_checkins.abdomen_cm is 'Abdomen circumference in cm at the navel (the US Navy body fat formula uses this one). waist_cm is the narrowest point.';
comment on column public.body_checkins.hips_cm is 'Hip circumference in cm at the widest part of the buttocks.';
comment on column public.body_checkins.bicep_l_cm is 'Left upper arm in cm, flexed or relaxed, but the same way every time.';
comment on column public.body_checkins.bicep_r_cm is 'Right upper arm in cm, flexed or relaxed, but the same way every time.';
comment on column public.body_checkins.forearm_l_cm is 'Left forearm in cm at the widest point.';
comment on column public.body_checkins.forearm_r_cm is 'Right forearm in cm at the widest point.';
comment on column public.body_checkins.thigh_l_cm is 'Left thigh in cm at the widest point, standing.';
comment on column public.body_checkins.thigh_r_cm is 'Right thigh in cm at the widest point, standing.';
comment on column public.body_checkins.calf_l_cm is 'Left calf in cm at the widest point, standing.';
comment on column public.body_checkins.calf_r_cm is 'Right calf in cm at the widest point, standing.';
comment on column public.body_checkins.resting_hr_bpm is 'Resting heart rate in beats per minute (the morning average from the watch is fine). Rises with fatigue, illness and poor sleep.';
comment on column public.body_checkins.calories_kcal is 'Average calories eaten per day over the period of the check-in (a weekly average is fine). A photo-based estimate is fine: read it as a range.';
comment on column public.body_checkins.protein_g is 'Average grams of protein per day over the period of the check-in.';
comment on column public.body_checkins.steps is 'Average steps per day over the period of the check-in.';
comment on table public.body_checkins is
  'Body measurements and recovery notes, one row per day at most (usually weekly, with the tape measurements monthly). Every number is optional: an empty value means not measured.';

-- Height, once. Used by the ratios below.
create table public.body_profile (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  height_cm  numeric(4, 1) check (height_cm between 100 and 250),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger body_profile_set_updated_at before update on public.body_profile
  for each row execute function public.set_updated_at();
alter table public.body_profile enable row level security;
create policy body_profile_own_row on public.body_profile for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
comment on table public.body_profile is 'One row per user with things that hardly change: height. Used for the ratios in body_metrics.';
comment on column public.body_profile.user_id is 'Owner (also the key: one row per user). RLS restricts the row to this user.';
comment on column public.body_profile.height_cm is 'Height in cm.';
comment on column public.body_profile.created_at is 'Row creation time (server clock).';
comment on column public.body_profile.updated_at is 'Last change (server clock, set by trigger).';

-- Every measurement as one row each (long format): the stored numbers and the calculated ones. Charts and Claude read this.
-- Calculated: shoulders / waist, waist / height, lean mass, and a body fat estimate from the tape (US Navy formula for men:
-- 495 / (1.0324 - 0.19077 log10(abdomen - neck) + 0.15456 log10(height)) - 450, in cm; it uses the abdomen, or the waist when
-- there is no abdomen number). The tape estimate is rough (a few percentage points either way): read the trend, not the number.
create view public.body_metrics with (security_invoker = true) as
with defs (col, label, unit, grp, ord) as (
  values
    ('bodyweight_kg',  'Bodyweight',        'kg',    'Body',          1),
    ('body_fat_pct',   'Body fat',          '%',     'Body',          2),
    ('waist_cm',       'Waist',             'cm',    'Circumference', 10),
    ('neck_cm',        'Neck',              'cm',    'Circumference', 11),
    ('shoulders_cm',   'Shoulders',         'cm',    'Circumference', 12),
    ('chest_cm',       'Chest',             'cm',    'Circumference', 13),
    ('abdomen_cm',     'Abdomen',           'cm',    'Circumference', 14),
    ('hips_cm',        'Hips',              'cm',    'Circumference', 15),
    ('bicep_l_cm',     'Left bicep',        'cm',    'Circumference', 16),
    ('bicep_r_cm',     'Right bicep',       'cm',    'Circumference', 17),
    ('forearm_l_cm',   'Left forearm',      'cm',    'Circumference', 18),
    ('forearm_r_cm',   'Right forearm',     'cm',    'Circumference', 19),
    ('thigh_l_cm',     'Left thigh',        'cm',    'Circumference', 20),
    ('thigh_r_cm',     'Right thigh',       'cm',    'Circumference', 21),
    ('calf_l_cm',      'Left calf',         'cm',    'Circumference', 22),
    ('calf_r_cm',      'Right calf',        'cm',    'Circumference', 23),
    ('sleep_hours',    'Sleep',             'h',     'Recovery',      30),
    ('resting_hr_bpm', 'Resting heart rate', 'bpm',  'Recovery',      31),
    ('calories_kcal',  'Calories',          'kcal',  'Nutrition',     40),
    ('protein_g',      'Protein',           'g',     'Nutrition',     41),
    ('steps',          'Steps',             'steps', 'Nutrition',     42)
),
stored as (
  select c.user_id, c.checked_on, d.col as metric, d.label, d.unit, d.grp, d.ord,
         (to_jsonb(c) ->> d.col)::numeric as value
  from public.body_checkins c
  cross join defs d
  where c.deleted_at is null
),
calculated as (
  select c.user_id, c.checked_on, x.metric, x.label, x.unit, 'Calculated'::text as grp, x.ord, x.value
  from public.body_checkins c
  left join public.body_profile p on p.user_id = c.user_id
  cross join lateral (
    values
      ('shoulder_waist_ratio', 'Shoulders / waist', 'x', 50, round(c.shoulders_cm / nullif(c.waist_cm, 0), 2)),
      ('waist_height_ratio',   'Waist / height',    'x', 51, round(c.waist_cm / nullif(p.height_cm, 0), 3)),
      ('lean_mass_kg',         'Lean mass',         'kg', 52, round(c.bodyweight_kg * (1 - c.body_fat_pct / 100), 1)),
      ('tape_body_fat_pct',    'Body fat (tape estimate)', '%', 53,
        case when coalesce(c.abdomen_cm, c.waist_cm) > c.neck_cm and p.height_cm is not null
             then round(495 / (1.0324 - 0.19077 * log10(coalesce(c.abdomen_cm, c.waist_cm) - c.neck_cm) + 0.15456 * log10(p.height_cm)) - 450, 1)
        end)
  ) as x (metric, label, unit, ord, value)
  where c.deleted_at is null
)
select user_id, checked_on, metric, label, unit, grp, ord, value from stored where value is not null
union all
select user_id, checked_on, metric, label, unit, grp, ord, value from calculated where value is not null and (metric <> 'tape_body_fat_pct' or value between 2 and 60);

comment on view public.body_metrics is
  'Every body number as one row (user, day, metric, label, unit, group, order, value): the stored measurements plus the calculated ones (shoulders / waist, waist / height, lean mass, body fat from the tape). The tape estimate is rough.';
comment on column public.body_metrics.user_id is 'Owner.';
comment on column public.body_metrics.checked_on is 'The day of the check-in.';
comment on column public.body_metrics.metric is 'Machine name, e.g. waist_cm or shoulder_waist_ratio.';
comment on column public.body_metrics.label is 'Name to show, e.g. "Left bicep".';
comment on column public.body_metrics.unit is 'Unit to show after the number.';
comment on column public.body_metrics.grp is 'Body, Circumference, Recovery, Nutrition or Calculated.';
comment on column public.body_metrics.ord is 'Display order.';
comment on column public.body_metrics.value is 'The number.';

-- For each metric: the latest value and the one from about four weeks earlier (the newest check-in at least 25 days before the latest).
create view public.body_latest with (security_invoker = true) as
select l.user_id, l.metric, l.label, l.unit, l.grp, l.ord,
       l.value      as latest_value,
       l.checked_on as latest_on,
       p.value      as earlier_value,
       p.checked_on as earlier_on,
       round(l.value - p.value, 3) as change,
       case when p.value <> 0 then round(100 * (l.value - p.value) / p.value, 1) end as change_pct
from (
  select distinct on (m.user_id, m.metric) m.*
  from public.body_metrics m
  order by m.user_id, m.metric, m.checked_on desc
) l
left join lateral (
  select m2.value, m2.checked_on
  from public.body_metrics m2
  where m2.user_id = l.user_id and m2.metric = l.metric and m2.checked_on <= l.checked_on - 25
  order by m2.checked_on desc
  limit 1
) p on true;

comment on view public.body_latest is
  'Per metric: the latest value (and its day), the value from about four weeks earlier (newest check-in at least 25 days before the latest, if any), and the change in units and in percent. Null earlier/change means there is no check-in that old yet.';
comment on column public.body_latest.latest_value is 'Latest value of this metric.';
comment on column public.body_latest.latest_on is 'Day of the latest value.';
comment on column public.body_latest.earlier_value is 'Value about four weeks before, or null.';
comment on column public.body_latest.earlier_on is 'Day of that earlier value, or null.';
comment on column public.body_latest.change is 'latest_value minus earlier_value, or null.';
comment on column public.body_latest.change_pct is 'Change in percent of the earlier value, or null.';

-- The weekly overview also carries the new weekly averages (appended at the end: nothing else moves).
create or replace view public.weekly_overview with (security_invoker = true) as
with sess as (
  select ss.user_id, date_trunc('week', ss.started_at at time zone 'Europe/Berlin')::date as week_start, ss.id as session_id, ss.feeling
  from public.sessions ss
  where ss.deleted_at is null and ss.ended_at is not null
),
train as (
  select s.user_id, s.week_start, count(distinct s.session_id) as sessions,
         coalesce(sum(st.sets), 0)::bigint as sets, sum(st.session_volume_kg) as volume_kg
  from sess s
  left join public.exercise_session_stats st on st.session_id = s.session_id
  group by s.user_id, s.week_start
),
perf as (
  select s.user_id, s.week_start, sum(p.planned_sets)::bigint as planned_sets, sum(p.done_sets)::bigint as done_sets, sum(p.met_sets)::bigint as met_sets
  from sess s
  join public.session_plan_performance p on p.session_id = s.session_id
  group by s.user_id, s.week_start
),
feel as (
  select s.user_id, s.week_start, round(avg(s.feeling), 1) as avg_feeling
  from sess s
  group by s.user_id, s.week_start
),
body as (
  select c.user_id, date_trunc('week', c.checked_on::timestamp)::date as week_start, count(*) as check_ins,
         round(avg(c.bodyweight_kg), 2) as bodyweight_kg, round(avg(c.waist_cm), 1) as waist_cm,
         round(avg(c.sleep_hours), 1) as sleep_hours, round(avg(c.body_fat_pct), 1) as body_fat_pct,
         round(avg(c.resting_hr_bpm), 0) as resting_hr_bpm, round(avg(c.calories_kcal), 0) as calories_kcal,
         round(avg(c.protein_g), 0) as protein_g, round(avg(c.steps), 0) as steps
  from public.body_checkins c
  where c.deleted_at is null
  group by c.user_id, date_trunc('week', c.checked_on::timestamp)::date
),
weeks as (
  select user_id, week_start from train
  union
  select user_id, week_start from body
)
select
  w.user_id,
  w.week_start,
  coalesce(t.sessions, 0)  as sessions,
  coalesce(t.sets, 0)      as sets,
  t.volume_kg,
  pf.planned_sets,
  pf.done_sets,
  pf.met_sets,
  coalesce(b.check_ins, 0) as check_ins,
  b.bodyweight_kg,
  b.waist_cm,
  b.sleep_hours,
  b.body_fat_pct,
  f.avg_feeling,
  b.resting_hr_bpm,
  b.calories_kcal,
  b.protein_g,
  b.steps
from weeks w
left join train t on t.user_id = w.user_id and t.week_start = w.week_start
left join perf  pf on pf.user_id = w.user_id and pf.week_start = w.week_start
left join body  b on b.user_id = w.user_id and b.week_start = w.week_start
left join feel  f on f.user_id = w.user_id and f.week_start = w.week_start;

comment on column public.weekly_overview.resting_hr_bpm is 'Average resting heart rate of that week''s check-ins.';
comment on column public.weekly_overview.calories_kcal is 'Average calories per day of that week''s check-ins.';
comment on column public.weekly_overview.protein_g is 'Average protein grams per day of that week''s check-ins.';
comment on column public.weekly_overview.steps is 'Average steps per day of that week''s check-ins.';
