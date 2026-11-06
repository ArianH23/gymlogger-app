-- The shape model: how far each measurement is from a target, and wrist and ankle (the frame) as two more tape numbers.
--
-- The target is a proportions model, not official numbers: the wide-shouldered, lean, strong look of the goal, as
-- classical athletic proportions of the owner's height (shoulders 72% of height, chest 60%, waist 44%, abdomen 46%, hips 52%,
-- neck 22%, biceps and calves 22%, forearms 17%, thighs 34%). shape_defaults() holds the model and body_shape applies it to the
-- latest measurements and the height; body_targets lets the owner override any single target. Closeness is 0 to 1: for
-- measurements to grow it is you / target, for waist, abdomen and hips (to shrink) it is target / you, never above 1.

alter table public.body_checkins
  add column wrist_cm numeric(4, 1) check (wrist_cm between 10 and 30),
  add column ankle_cm numeric(4, 1) check (ankle_cm between 15 and 40);
comment on column public.body_checkins.wrist_cm is 'Wrist circumference in cm, just above the wrist bone. A frame size: it hardly changes, so one measurement is enough.';
comment on column public.body_checkins.ankle_cm is 'Ankle circumference in cm, just above the ankle bone. A frame size: it hardly changes.';

-- body_metrics learns the two new numbers (same view, two more rows in its list)
create or replace view public.body_metrics with (security_invoker = true) as
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
    ('wrist_cm',       'Wrist',             'cm',    'Circumference', 24),
    ('ankle_cm',       'Ankle',             'cm',    'Circumference', 25),
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


-- Your own targets: a row replaces the model's number for that one measurement (delete the row to go back to the model).
create table public.body_targets (
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  metric       text not null check (metric in ('shoulders_cm', 'chest_cm', 'waist_cm', 'abdomen_cm', 'hips_cm', 'neck_cm',
                                               'bicep_l_cm', 'bicep_r_cm', 'forearm_l_cm', 'forearm_r_cm',
                                               'thigh_l_cm', 'thigh_r_cm', 'calf_l_cm', 'calf_r_cm')),
  target_value numeric(5, 1) not null check (target_value between 5 and 250),
  updated_at   timestamptz not null default now(),
  primary key (user_id, metric)
);
create trigger body_targets_set_updated_at before update on public.body_targets
  for each row execute function public.set_updated_at();
alter table public.body_targets enable row level security;
create policy body_targets_own_rows on public.body_targets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
comment on table public.body_targets is 'Targets the owner set by hand for single measurements. They replace the proportions model in body_shape; deleting a row restores the model.';
comment on column public.body_targets.user_id is 'Owner (part of the key). RLS restricts every row to this user.';
comment on column public.body_targets.metric is 'The measurement, named as in body_checkins (e.g. waist_cm, bicep_l_cm).';
comment on column public.body_targets.target_value is 'The target in cm.';
comment on column public.body_targets.updated_at is 'Last change (server clock, set by trigger).';

-- The proportions model: each measurement as a share of height, and whether you want it to grow or shrink.
create function public.shape_defaults() returns table (metric text, ratio numeric, kind text)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('shoulders_cm', 0.72,   'grow'),
    ('chest_cm',     0.60,   'grow'),
    ('waist_cm',     0.44,   'shrink'),
    ('abdomen_cm',   0.46,   'shrink'),
    ('hips_cm',      0.52,   'shrink'),
    ('neck_cm',      0.22,   'grow'),
    ('bicep_l_cm',   0.2222, 'grow'),
    ('bicep_r_cm',   0.2222, 'grow'),
    ('forearm_l_cm', 0.1722, 'grow'),
    ('forearm_r_cm', 0.1722, 'grow'),
    ('thigh_l_cm',   0.3444, 'grow'),
    ('thigh_r_cm',   0.3444, 'grow'),
    ('calf_l_cm',    0.2222, 'grow'),
    ('calf_r_cm',    0.2222, 'grow')
  ) as v (metric, ratio, kind)
$$;
comment on function public.shape_defaults() is
  'The proportions model behind the shape target: for each measurement its share of height (e.g. shoulders 0.72 x height) and whether it should grow or shrink. Not official numbers for any character: a model of a wide-shouldered, lean, strong build.';
revoke execute on function public.shape_defaults() from public, anon;
grant  execute on function public.shape_defaults() to authenticated;

-- Each measured circumference against its target. Needs the height (body_profile) unless you set a target yourself.
create view public.body_shape with (security_invoker = true) as
select l.user_id,
       l.metric,
       l.label,
       l.latest_value  as current_value,
       l.latest_on,
       d.kind,
       x.target        as target_value,
       (t.target_value is not null) as target_is_custom,
       round(x.target - l.latest_value, 1) as gap,
       round(case when d.kind = 'grow' then least(l.latest_value / x.target, 1) else least(x.target / l.latest_value, 1) end, 3) as closeness
from public.body_latest l
join public.shape_defaults() d on d.metric = l.metric
left join public.body_profile p on p.user_id = l.user_id
left join public.body_targets t on t.user_id = l.user_id and t.metric = l.metric
cross join lateral (select coalesce(t.target_value, round(d.ratio * p.height_cm, 1)) as target) x
where x.target is not null;

comment on view public.body_shape is
  'Each measured circumference against its target (your own if you set one, else the proportions model scaled to your height): current and target in cm, the gap (target minus current; negative = to shrink), and closeness from 0 to 1 (1 = reached). Rows exist only for measured metrics with a known target.';
comment on column public.body_shape.user_id is 'Owner.';
comment on column public.body_shape.metric is 'The measurement, named as in body_checkins.';
comment on column public.body_shape.label is 'Name to show.';
comment on column public.body_shape.current_value is 'Latest measured value in cm.';
comment on column public.body_shape.latest_on is 'Day of that measurement.';
comment on column public.body_shape.kind is 'grow (more is closer) or shrink (less is closer).';
comment on column public.body_shape.target_value is 'Target in cm.';
comment on column public.body_shape.target_is_custom is 'True if you set this target yourself.';
comment on column public.body_shape.gap is 'target_value minus current_value, in cm.';
comment on column public.body_shape.closeness is '0 to 1: how much of the way to the target (1 = reached).';
