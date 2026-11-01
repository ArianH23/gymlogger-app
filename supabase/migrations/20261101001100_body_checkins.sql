-- Weekly check-ins (bodyweight, waist, sleep, body fat) and a weekly overview that joins them with training.
-- The overview is what Claude reads to judge trends, so every client sees the same numbers.

create table public.body_checkins (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  checked_on     date not null default current_date,
  bodyweight_kg  numeric(5, 2) check (bodyweight_kg between 20 and 400),
  waist_cm       numeric(5, 1) check (waist_cm between 30 and 250),
  sleep_hours    numeric(3, 1) check (sleep_hours between 0 and 24),
  body_fat_pct   numeric(4, 1) check (body_fat_pct between 2 and 60),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
-- One check-in per day: saving again on the same day replaces the earlier numbers.
create unique index body_checkins_day_uq on public.body_checkins (user_id, checked_on) where deleted_at is null;

create trigger body_checkins_set_updated_at before update on public.body_checkins
  for each row execute function public.set_updated_at();
alter table public.body_checkins enable row level security;
create policy body_checkins_own_rows on public.body_checkins for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

comment on table public.body_checkins is
  'Body measurements and recovery notes, one row per day at most (usually weekly). Every number is optional.';
comment on column public.body_checkins.id is 'Client-generated UUID.';
comment on column public.body_checkins.user_id is 'Owner. RLS restricts every row to this user.';
comment on column public.body_checkins.checked_on is 'The day the numbers are for (local date). One row per day.';
comment on column public.body_checkins.bodyweight_kg is 'Bodyweight in kg: a weekly average or a morning weigh-in. Read trends, not single days.';
comment on column public.body_checkins.waist_cm is 'Waist circumference in cm, measured the same way each time.';
comment on column public.body_checkins.sleep_hours is 'Average hours of sleep per night over the period (e.g. 6.5).';
comment on column public.body_checkins.body_fat_pct is 'Body fat estimate in percent (a scale or a guess): rough, use for direction only.';
comment on column public.body_checkins.notes is 'Free text: illness, travel, a bad week.';
comment on column public.body_checkins.created_at is 'Row creation time (server clock).';
comment on column public.body_checkins.updated_at is 'Last change (server clock, set by trigger).';
comment on column public.body_checkins.deleted_at is 'Soft delete marker. Ignore rows where this is not null.';

-- How well each session matched the plan it followed (Claude's plan if there was one, else the automatic one).
-- A set is "met" when you reached the planned reps at the planned weight or heavier (assisted: the same or less help).
create view public.session_plan_performance with (security_invoker = true) as
with followed as (
  select distinct on (p.used_by_session_id) p.id as plan_id, p.used_by_session_id as session_id
  from public.planned_sessions p
  where p.used_by_session_id is not null
  order by p.used_by_session_id, (p.created_by = 'claude') desc, p.created_at desc
)
select
  f.session_id,
  ss.started_at,
  count(*)        as planned_sets,
  count(r.reps)   as done_sets,
  count(*) filter (
    where r.reps is not null
      and (ps.target_reps_min is null or r.reps >= ps.target_reps_min)
      and (ps.target_weight_kg is null or r.weight_kg is null
           or case when e.load_type = 'assisted' then r.weight_kg <= ps.target_weight_kg
                   else r.weight_kg >= ps.target_weight_kg end)
  )               as met_sets
from followed f
join public.planned_sets ps on ps.planned_session_id = f.plan_id
join public.exercises e on e.id = ps.exercise_id
join public.sessions ss on ss.id = f.session_id and ss.deleted_at is null and ss.ended_at is not null
left join public.exercise_set_results r
  on r.session_id = f.session_id and r.exercise_id = ps.exercise_id and r.set_no = ps.set_no
group by f.session_id, ss.started_at;

comment on view public.session_plan_performance is
  'Per session that followed a plan: how many planned sets, how many were done, and how many met the plan (planned reps at the planned weight or better). Only sessions logged in the app have a plan.';
comment on column public.session_plan_performance.session_id is 'The session.';
comment on column public.session_plan_performance.started_at is 'When it started.';
comment on column public.session_plan_performance.planned_sets is 'Sets in the plan that was followed.';
comment on column public.session_plan_performance.done_sets is 'Planned sets that have a logged set with the same exercise and set number.';
comment on column public.session_plan_performance.met_sets is 'Done sets that reached the planned reps at the planned weight or better.';

-- One row per week (Monday start, Europe/Berlin): training, plan performance and the week's check-ins.
create view public.weekly_overview with (security_invoker = true) as
with sess as (
  select ss.user_id, date_trunc('week', ss.started_at at time zone 'Europe/Berlin')::date as week_start, ss.id as session_id
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
body as (
  select c.user_id, date_trunc('week', c.checked_on::timestamp)::date as week_start, count(*) as check_ins,
         round(avg(c.bodyweight_kg), 2) as bodyweight_kg, round(avg(c.waist_cm), 1) as waist_cm,
         round(avg(c.sleep_hours), 1) as sleep_hours, round(avg(c.body_fat_pct), 1) as body_fat_pct
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
  b.body_fat_pct
from weeks w
left join train t on t.user_id = w.user_id and t.week_start = w.week_start
left join perf  pf on pf.user_id = w.user_id and pf.week_start = w.week_start
left join body  b on b.user_id = w.user_id and b.week_start = w.week_start;

comment on view public.weekly_overview is
  'One row per week (Monday, Europe/Berlin): sessions, sets and volume done, plan performance (planned/done/met sets, app-logged sessions only), and the averages of that week''s check-ins.';
comment on column public.weekly_overview.week_start is 'Monday of the week.';
comment on column public.weekly_overview.sessions is 'Finished sessions that week (any routine, free-form too).';
comment on column public.weekly_overview.sets is 'Working sets that week.';
comment on column public.weekly_overview.volume_kg is 'Sum of weight x reps over the week; null if nothing had a weight.';
comment on column public.weekly_overview.planned_sets is 'Sets in the plans followed that week (app-logged sessions only), else null.';
comment on column public.weekly_overview.done_sets is 'Of those, sets that were done.';
comment on column public.weekly_overview.met_sets is 'Of those, sets that reached the planned reps at the planned weight or better.';
comment on column public.weekly_overview.check_ins is 'Number of check-ins that week.';
comment on column public.weekly_overview.bodyweight_kg is 'Average bodyweight of the week''s check-ins.';
comment on column public.weekly_overview.waist_cm is 'Average waist of the week''s check-ins.';
comment on column public.weekly_overview.sleep_hours is 'Average sleep hours of the week''s check-ins.';
comment on column public.weekly_overview.body_fat_pct is 'Average body fat estimate of the week''s check-ins.';
