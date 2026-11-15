-- A calendar of workouts, the week streak and the rest days. Days and weeks are in local time and weeks start on Monday, as in
-- weekly_overview. Every finished session counts, including the imported Hevy history.

-- One row per finished session with its calendar day: what the month calendar shows.
create view public.workout_calendar with (security_invoker = true) as
select s.user_id,
       (s.started_at at time zone 'Europe/Berlin')::date as day,
       s.id as session_id,
       s.title,
       s.started_at
from public.sessions s
where s.ended_at is not null and s.deleted_at is null;

comment on view public.workout_calendar is
  'One row per finished session with the calendar day it was done (local time). Several sessions on one day give several rows.';
comment on column public.workout_calendar.user_id is 'Owner.';
comment on column public.workout_calendar.day is 'The day the session started, in local time.';
comment on column public.workout_calendar.session_id is 'The session.';
comment on column public.workout_calendar.title is 'Session title.';
comment on column public.workout_calendar.started_at is 'When it started.';

-- The streak: weeks in a row with at least one workout. It is still alive during the current week (it only breaks once a whole
-- week has passed with no workout), so it counts the run of weeks that ends this week or last week.
create view public.training_streak with (security_invoker = true) as
with weeks as (
  select distinct user_id, date_trunc('week', day::timestamp)::date as wk
  from public.workout_calendar
),
runs as (
  -- consecutive weeks share the same "run" value: the week minus 7 days per position
  select user_id, wk, wk - (7 * row_number() over (partition by user_id order by wk))::integer as run
  from weeks
),
islands as (
  select user_id, run, count(*)::integer as weeks, max(wk) as last_wk
  from runs
  group by user_id, run
),
today as (
  select (now() at time zone 'Europe/Berlin')::date as d,
         date_trunc('week', now() at time zone 'Europe/Berlin')::date as wk
),
last as (
  select c.user_id,
         max(c.day) as last_day,
         (count(*) filter (where c.day >= (select wk from today)))::integer as this_week
  from public.workout_calendar c
  group by c.user_id
)
select l.user_id,
       coalesce((select i.weeks from islands i where i.user_id = l.user_id and i.last_wk >= t.wk - 7), 0) as week_streak,
       (select max(i.weeks) from islands i where i.user_id = l.user_id) as best_week_streak,
       l.last_day as last_session_day,
       t.d - l.last_day as rest_days,
       l.this_week as sessions_this_week
from last l
cross join today t;

comment on view public.training_streak is
  'Per user: the current week streak (weeks in a row with at least one finished workout, Monday to Sunday in local time; still alive during the current week), the best streak ever, the day of the last session, the rest days since it, and the sessions this week. No row until there is a finished session.';
comment on column public.training_streak.user_id is 'Owner.';
comment on column public.training_streak.week_streak is 'Weeks in a row with a workout, ending this week or last week. 0 once a whole week was missed.';
comment on column public.training_streak.best_week_streak is 'The longest run of weeks with a workout.';
comment on column public.training_streak.last_session_day is 'The day of the latest finished session.';
comment on column public.training_streak.rest_days is 'Days since the last session (0 = trained today).';
comment on column public.training_streak.sessions_this_week is 'Finished sessions since Monday.';
