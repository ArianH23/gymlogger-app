-- Balance of the training: one side of the body against the other, per week and per month.
-- Built on the weighted sets of weekly_muscles / monthly_muscles (primary muscle 1, secondary 0.5 per working set).
-- These are plain comparisons; no ratio is called right or wrong here.

-- The four comparisons and which muscles count on each side. A muscle that is on neither side of a comparison is left out of it.
create function public.muscle_balance_defs() returns table (pair text, label text, ord integer, a_label text, b_label text, side text, muscle text)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('push_pull', 'Push / Pull', 1, 'Push', 'Pull', 'a', 'chest'),
    ('push_pull', 'Push / Pull', 1, 'Push', 'Pull', 'a', 'front_delts'),
    ('push_pull', 'Push / Pull', 1, 'Push', 'Pull', 'a', 'triceps'),
    ('push_pull', 'Push / Pull', 1, 'Push', 'Pull', 'b', 'lats'),
    ('push_pull', 'Push / Pull', 1, 'Push', 'Pull', 'b', 'upper_back'),
    ('push_pull', 'Push / Pull', 1, 'Push', 'Pull', 'b', 'rear_delts'),
    ('push_pull', 'Push / Pull', 1, 'Push', 'Pull', 'b', 'biceps'),

    ('front_back', 'Front / Back', 2, 'Front', 'Back', 'a', 'chest'),
    ('front_back', 'Front / Back', 2, 'Front', 'Back', 'a', 'front_delts'),
    ('front_back', 'Front / Back', 2, 'Front', 'Back', 'a', 'biceps'),
    ('front_back', 'Front / Back', 2, 'Front', 'Back', 'a', 'abs'),
    ('front_back', 'Front / Back', 2, 'Front', 'Back', 'a', 'quads'),
    ('front_back', 'Front / Back', 2, 'Front', 'Back', 'b', 'rear_delts'),
    ('front_back', 'Front / Back', 2, 'Front', 'Back', 'b', 'lats'),
    ('front_back', 'Front / Back', 2, 'Front', 'Back', 'b', 'upper_back'),
    ('front_back', 'Front / Back', 2, 'Front', 'Back', 'b', 'lower_back'),
    ('front_back', 'Front / Back', 2, 'Front', 'Back', 'b', 'triceps'),
    ('front_back', 'Front / Back', 2, 'Front', 'Back', 'b', 'glutes'),
    ('front_back', 'Front / Back', 2, 'Front', 'Back', 'b', 'hamstrings'),
    ('front_back', 'Front / Back', 2, 'Front', 'Back', 'b', 'calves'),

    ('upper_lower', 'Upper / Lower', 3, 'Upper', 'Lower', 'a', 'chest'),
    ('upper_lower', 'Upper / Lower', 3, 'Upper', 'Lower', 'a', 'front_delts'),
    ('upper_lower', 'Upper / Lower', 3, 'Upper', 'Lower', 'a', 'side_delts'),
    ('upper_lower', 'Upper / Lower', 3, 'Upper', 'Lower', 'a', 'rear_delts'),
    ('upper_lower', 'Upper / Lower', 3, 'Upper', 'Lower', 'a', 'lats'),
    ('upper_lower', 'Upper / Lower', 3, 'Upper', 'Lower', 'a', 'upper_back'),
    ('upper_lower', 'Upper / Lower', 3, 'Upper', 'Lower', 'a', 'biceps'),
    ('upper_lower', 'Upper / Lower', 3, 'Upper', 'Lower', 'a', 'triceps'),
    ('upper_lower', 'Upper / Lower', 3, 'Upper', 'Lower', 'a', 'forearms'),
    ('upper_lower', 'Upper / Lower', 3, 'Upper', 'Lower', 'b', 'glutes'),
    ('upper_lower', 'Upper / Lower', 3, 'Upper', 'Lower', 'b', 'quads'),
    ('upper_lower', 'Upper / Lower', 3, 'Upper', 'Lower', 'b', 'hamstrings'),
    ('upper_lower', 'Upper / Lower', 3, 'Upper', 'Lower', 'b', 'adductors'),
    ('upper_lower', 'Upper / Lower', 3, 'Upper', 'Lower', 'b', 'calves'),

    ('quads_hams', 'Quads / Hamstrings', 4, 'Quads', 'Hamstrings', 'a', 'quads'),
    ('quads_hams', 'Quads / Hamstrings', 4, 'Quads', 'Hamstrings', 'b', 'hamstrings')
  ) as v (pair, label, ord, a_label, b_label, side, muscle)
$$;
comment on function public.muscle_balance_defs() is
  'The four balance comparisons (push/pull, front/back of the body, upper/lower body, quads/hamstrings) and the muscles on side a and side b of each. A muscle on neither side of a comparison does not count in it (side delts and forearms are neither push nor pull, for example).';
revoke execute on function public.muscle_balance_defs() from public, anon;
grant  execute on function public.muscle_balance_defs() to authenticated;

create view public.weekly_balance with (security_invoker = true) as
select w.user_id,
       w.week_start,
       d.pair, d.label, d.ord, d.a_label, d.b_label,
       coalesce(sum(w.sets) filter (where d.side = 'a'), 0) as a_sets,
       coalesce(sum(w.sets) filter (where d.side = 'b'), 0) as b_sets,
       round(coalesce(sum(w.sets) filter (where d.side = 'a'), 0) / sum(w.sets), 3) as a_share
from public.weekly_muscles w
join public.muscle_balance_defs() d on d.muscle = w.muscle
group by w.user_id, w.week_start, d.pair, d.label, d.ord, d.a_label, d.b_label;
comment on view public.weekly_balance is
  'Per week (Monday start) and comparison: the weighted sets on each side (push against pull, front against back, upper against lower body, quads against hamstrings). One row per comparison that had any sets that week. A plain comparison: no ratio is a target.';
comment on column public.weekly_balance.user_id is 'Owner.';
comment on column public.weekly_balance.week_start is 'Monday of the week.';
comment on column public.weekly_balance.pair is 'Comparison key: push_pull, front_back, upper_lower or quads_hams (see muscle_balance_defs()).';
comment on column public.weekly_balance.label is 'Comparison name for display.';
comment on column public.weekly_balance.ord is 'Display order.';
comment on column public.weekly_balance.a_label is 'Name of side a (the first one in the label).';
comment on column public.weekly_balance.b_label is 'Name of side b.';
comment on column public.weekly_balance.a_sets is 'Weighted sets on side a in the period.';
comment on column public.weekly_balance.b_sets is 'Weighted sets on side b in the period.';
comment on column public.weekly_balance.a_share is 'Side a''s part of the two sides together, 0 to 1 (0.5 = even).';

create view public.monthly_balance with (security_invoker = true) as
select m.user_id,
       m.month_start,
       d.pair, d.label, d.ord, d.a_label, d.b_label,
       coalesce(sum(m.sets) filter (where d.side = 'a'), 0) as a_sets,
       coalesce(sum(m.sets) filter (where d.side = 'b'), 0) as b_sets,
       round(coalesce(sum(m.sets) filter (where d.side = 'a'), 0) / sum(m.sets), 3) as a_share
from public.monthly_muscles m
join public.muscle_balance_defs() d on d.muscle = m.muscle
group by m.user_id, m.month_start, d.pair, d.label, d.ord, d.a_label, d.b_label;
comment on view public.monthly_balance is
  'Per calendar month and comparison: the weighted sets on each side (push against pull, front against back, upper against lower body, quads against hamstrings). One row per comparison that had any sets that month.';
comment on column public.monthly_balance.user_id is 'Owner.';
comment on column public.monthly_balance.month_start is 'First day of the month.';
comment on column public.monthly_balance.pair is 'Comparison key: push_pull, front_back, upper_lower or quads_hams (see muscle_balance_defs()).';
comment on column public.monthly_balance.label is 'Comparison name for display.';
comment on column public.monthly_balance.ord is 'Display order.';
comment on column public.monthly_balance.a_label is 'Name of side a (the first one in the label).';
comment on column public.monthly_balance.b_label is 'Name of side b.';
comment on column public.monthly_balance.a_sets is 'Weighted sets on side a in the period.';
comment on column public.monthly_balance.b_sets is 'Weighted sets on side b in the period.';
comment on column public.monthly_balance.a_share is 'Side a''s part of the two sides together, 0 to 1 (0.5 = even).';
