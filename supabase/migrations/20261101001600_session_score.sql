-- How well each session went: a computed score (share of the planned sets that were met) turned into a tier
-- by ONE function, plus an optional 1-5 "how did it feel" tap saved with the session. Clients (phone, watch)
-- only display the tier; Claude reads the same numbers.

alter table public.sessions
  add column feeling smallint check (feeling between 1 and 5);
comment on column public.sessions.feeling is
  'Optional 1-5 rating of how the session felt, tapped at the end (1 = awful, 3 = normal, 5 = great). Null if not given. Independent of the plan score: it is a cross-check.';

-- The tier thresholds live here and nowhere else.
create function public.session_tier(p_met_pct numeric) returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_met_pct is null then null
    when p_met_pct >= 90 then 'great'
    when p_met_pct >= 70 then 'good'
    when p_met_pct >= 50 then 'average'
    when p_met_pct >= 30 then 'weak'
    else 'poor'
  end
$$;
comment on function public.session_tier(numeric) is
  'Maps the percentage of planned sets that were met to a tier: great (90 and up), good (70-89), average (50-69), weak (30-49), poor (under 30). Null in, null out.';
revoke execute on function public.session_tier(numeric) from public, anon;
grant  execute on function public.session_tier(numeric) to authenticated;

-- One row per finished session. Sessions without a followed plan (Hevy imports, free-form days) have no score,
-- but still show their feeling if one was given.
create view public.session_scores with (security_invoker = true) as
select
  s.id        as session_id,
  s.user_id,
  s.started_at,
  p.planned_sets,
  p.done_sets,
  p.met_sets,
  round(100.0 * p.met_sets / nullif(p.planned_sets, 0))::integer as met_pct,
  public.session_tier(round(100.0 * p.met_sets / nullif(p.planned_sets, 0))) as tier,
  s.feeling
from public.sessions s
left join public.session_plan_performance p on p.session_id = s.id
where s.deleted_at is null and s.ended_at is not null;

comment on view public.session_scores is
  'One row per finished session: planned/done/met sets, the percentage of planned sets met, its tier (great/good/average/weak/poor) and the optional 1-5 feeling. The score is null for sessions that followed no plan (older imported ones, free-form days).';
comment on column public.session_scores.session_id is 'The session.';
comment on column public.session_scores.user_id is 'Owner.';
comment on column public.session_scores.started_at is 'When it started.';
comment on column public.session_scores.planned_sets is 'Sets in the plan that was followed; null if none.';
comment on column public.session_scores.done_sets is 'Planned sets that were logged.';
comment on column public.session_scores.met_sets is 'Done sets that reached the planned reps at the planned weight or better.';
comment on column public.session_scores.met_pct is 'met_sets as a whole percentage of planned_sets (sets never done count as not met); null without a plan.';
comment on column public.session_scores.tier is 'great (90+), good (70-89), average (50-69), weak (30-49) or poor (under 30), from met_pct; null without a plan.';
comment on column public.session_scores.feeling is 'How the session felt, 1-5, if the owner tapped one.';

-- weekly_overview gains the average feeling of the week's sessions (new column last, nothing else changes).
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
  b.body_fat_pct,
  f.avg_feeling
from weeks w
left join train t on t.user_id = w.user_id and t.week_start = w.week_start
left join perf  pf on pf.user_id = w.user_id and pf.week_start = w.week_start
left join body  b on b.user_id = w.user_id and b.week_start = w.week_start
left join feel  f on f.user_id = w.user_id and f.week_start = w.week_start;

comment on column public.weekly_overview.avg_feeling is 'Average of the 1-5 feeling ratings of that week''s sessions (only those where one was given), else null.';
