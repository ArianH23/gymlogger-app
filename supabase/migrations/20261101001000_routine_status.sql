-- routine_status: for each routine, when it was last done and whether it is the one to do next.
-- "Next" is the routine done longest ago (a routine never done comes first; ties go by routine order), so it
-- corrects itself when you skip or double up. Only finished sessions linked to the routine count: variants
-- such as "Workout B Midtown" are linked to B, free-form and empty workouts have no routine and are ignored.

create view public.routine_status with (security_invoker = true) as
select
  r.id          as routine_id,
  r.user_id,
  r.name,
  r.position,
  ls.session_id as last_session_id,
  ls.started_at as last_started_at,
  (row_number() over (partition by r.user_id
                      order by ls.started_at asc nulls first, r.position asc, r.name asc) = 1) as is_next
from public.routines r
left join lateral (
  select s.id as session_id, s.started_at
  from public.sessions s
  where s.routine_id = r.id and s.deleted_at is null and s.ended_at is not null
  order by s.started_at desc
  limit 1
) ls on true
where r.deleted_at is null;

comment on view public.routine_status is
  'One row per routine: its latest finished session and is_next = the routine done longest ago (never-done first, ties by position). Exactly one routine per user is next.';
comment on column public.routine_status.routine_id is 'Routine.';
comment on column public.routine_status.user_id is 'Owner.';
comment on column public.routine_status.name is 'Routine name.';
comment on column public.routine_status.position is 'Display order of the routine.';
comment on column public.routine_status.last_session_id is 'Latest finished session of this routine, or null if never done.';
comment on column public.routine_status.last_started_at is 'When that session started, or null.';
comment on column public.routine_status.is_next is 'true for the single routine to do next.';
