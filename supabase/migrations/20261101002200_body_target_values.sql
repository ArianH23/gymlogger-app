-- body_target_values: the target for EVERY measurement (your own if you set one, else the proportions model scaled to your
-- height), whether or not you have measured it yet. The target editor and the figure read this; body_shape (the measured
-- ones against their targets) is now built on it, so there is one definition of "the target".

create view public.body_target_values with (security_invoker = true) as
select p.user_id,
       d.metric,
       d.kind,
       coalesce(t.target_value, round(d.ratio * p.height_cm, 1)) as target_value,
       (t.target_value is not null) as is_custom
from public.body_profile p
cross join public.shape_defaults() d
left join public.body_targets t on t.user_id = p.user_id and t.metric = d.metric
where p.height_cm is not null;

comment on view public.body_target_values is
  'The target in cm for each of the 14 measurements: your own (body_targets) or the proportions model scaled to your height (body_profile). One row per measurement; none until a height is saved.';
comment on column public.body_target_values.user_id is 'Owner.';
comment on column public.body_target_values.metric is 'The measurement, named as in body_checkins.';
comment on column public.body_target_values.kind is 'grow (more is closer) or shrink (less is closer).';
comment on column public.body_target_values.target_value is 'Target in cm.';
comment on column public.body_target_values.is_custom is 'True if you set this target yourself.';

-- Same columns as before, now from the view above.
create or replace view public.body_shape with (security_invoker = true) as
select l.user_id,
       l.metric,
       l.label,
       l.latest_value as current_value,
       l.latest_on,
       v.kind,
       v.target_value,
       v.is_custom    as target_is_custom,
       round(v.target_value - l.latest_value, 1) as gap,
       round(case when v.kind = 'grow' then least(l.latest_value / v.target_value, 1) else least(v.target_value / l.latest_value, 1) end, 3) as closeness
from public.body_latest l
join public.body_target_values v on v.user_id = l.user_id and v.metric = l.metric;
