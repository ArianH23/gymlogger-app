-- Tests for the workout calendar and the week streak. Dates are built from "now", so the test passes on any day.
-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'one@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'two@example.com'),
  ('00000000-0000-0000-0000-0000000000a3', 'three@example.com'),
  ('00000000-0000-0000-0000-0000000000a4', 'four@example.com'),
  ('00000000-0000-0000-0000-0000000000a5', 'five@example.com');

-- Monday 00:01 (local time) of the week n weeks ago.
create function pg_temp.wk(n integer) returns timestamptz language sql as $$
  select ((date_trunc('week', now() at time zone 'Europe/Berlin')::date - 7 * n) + time '00:01') at time zone 'Europe/Berlin'
$$;
create function pg_temp.sess(p_user text, p_start timestamptz, p_finished boolean default true, p_deleted boolean default false)
returns void language sql as $$
  insert into public.sessions (user_id, title, started_at, ended_at, deleted_at)
  values (('00000000-0000-0000-0000-0000000000' || p_user)::uuid, 'w', p_start,
          case when p_finished then p_start + interval '50 minutes' end, case when p_deleted then now() end)
$$;

-- User one: this week, last week, two weeks ago (a run of 3), a gap, then weeks 4 to 8 ago (a run of 5).
-- An unfinished and a deleted session this week must not count.
select pg_temp.sess('a1', pg_temp.wk(n)) from unnest(array[0, 1, 2, 4, 5, 6, 7, 8]) as n;
select pg_temp.sess('a1', pg_temp.wk(0) + interval '1 minute', false);
select pg_temp.sess('a1', pg_temp.wk(0) + interval '2 minutes', true, true);
-- User two: one session three weeks ago. User three: only last week.
select pg_temp.sess('a2', pg_temp.wk(3));
select pg_temp.sess('a3', pg_temp.wk(1));
-- User four: three sessions in one old week, one of them late in the evening UTC (already the next day in local time).
select pg_temp.sess('a4', '2026-01-05 23:30+00');
select pg_temp.sess('a4', '2026-01-06 10:00+00');
select pg_temp.sess('a4', '2026-01-08 10:00+00');

create function pg_temp.streak(p_user text) returns public.training_streak language sql as $$
  select * from public.training_streak where user_id = ('00000000-0000-0000-0000-0000000000' || p_user)::uuid
$$;

select is((pg_temp.streak('a1')).week_streak, 3, 'three weeks in a row up to this week');
select is((pg_temp.streak('a1')).best_week_streak, 5, 'the best streak is the older run of five');
select is((pg_temp.streak('a1')).sessions_this_week, 1, 'one session this week: unfinished and deleted ones do not count');
select is((pg_temp.streak('a1')).last_session_day, date_trunc('week', now() at time zone 'Europe/Berlin')::date, 'the last session was this Monday');
select is((pg_temp.streak('a1')).rest_days, (now() at time zone 'Europe/Berlin')::date - date_trunc('week', now() at time zone 'Europe/Berlin')::date, 'rest days = days since that Monday');
select is((select count(*) from public.workout_calendar where user_id = '00000000-0000-0000-0000-0000000000a1'), 8::bigint, 'the calendar has the 8 finished sessions');

select is((pg_temp.streak('a2')).week_streak, 0, 'a missed whole week breaks the streak');
select is((pg_temp.streak('a2')).best_week_streak, 1, 'but the best streak remembers the one week');
select is((pg_temp.streak('a2')).rest_days, (now() at time zone 'Europe/Berlin')::date - (date_trunc('week', now() at time zone 'Europe/Berlin')::date - 21), 'rest days since three weeks ago');

select is((pg_temp.streak('a3')).week_streak, 1, 'nothing yet this week: last week keeps the streak alive');
select is((pg_temp.streak('a3')).sessions_this_week, 0, 'and this week counts zero');

select is((select day from public.workout_calendar where user_id = '00000000-0000-0000-0000-0000000000a4' order by started_at limit 1), '2026-01-06'::date, 'a session late in the evening UTC falls on the next day in local time');
select is((pg_temp.streak('a4')).best_week_streak, 1, 'several sessions in one week count as one week');
select is((select count(*) from public.training_streak where user_id = '00000000-0000-0000-0000-0000000000a5'), 0::bigint, 'no sessions: no streak row');

select * from finish();
rollback;
