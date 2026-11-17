-- Suggested backups: for an exercise, the other exercises that work the same muscles, best match first.
-- The routine editor shows them so a backup is one tap, instead of searching the whole list. Nothing is saved here:
-- a suggestion becomes a backup only when it is picked and the routine is saved (routine_exercises.backup_exercise_id).

-- How well an exercise stands in for another: the muscle tags of both are compared (primary = 1, secondary = 0.5, the same
-- weights the muscle views use) and the match is the cosine of the angle between the two: 1 for the same muscles in the same
-- proportion, 0 for nothing in common. A candidate must share at least one primary muscle and match 0.5 or more.
-- Order: the match (to one decimal), then exercises you have done before (their last-time numbers make the swap easy),
-- then a different kind of equipment than the original (if its machine is taken, another machine often is too), then name.
create function public.suggest_backups(p_exercise_id uuid, p_exclude uuid[] default '{}', p_limit integer default 4)
returns table (exercise_id uuid, name text, equipment text, similarity numeric, shared_muscles text[], times_done integer)
language sql
stable
set search_path = ''
as $$
  with src as (
    select m.muscle, m.role, case m.role when 'primary' then 1.0 else 0.5 end as w
    from public.exercise_muscles m
    where m.exercise_id = p_exercise_id
  ),
  src_norm as (select sqrt(sum(w * w)) as n from src),
  src_ex as (select e.equipment from public.exercises e where e.id = p_exercise_id),
  cv as (
    select m.exercise_id, m.muscle, m.role, case m.role when 'primary' then 1.0 else 0.5 end as w
    from public.exercise_muscles m
    join public.exercises e on e.id = m.exercise_id
    where e.deleted_at is null
      and e.id <> p_exercise_id
      and not (e.id = any (coalesce(p_exclude, '{}')))
  ),
  norms as (select exercise_id, sqrt(sum(w * w)) as n from cv group by exercise_id),
  matched as (
    select cv.exercise_id,
           sum(cv.w * src.w) as dot,
           array_agg(d.label order by d.ord) filter (where cv.role = 'primary' and src.role = 'primary') as shared
    from cv
    join src on src.muscle = cv.muscle
    join public.muscle_defs() d on d.muscle = cv.muscle
    group by cv.exercise_id
  ),
  scored as (
    select e.id, e.name, e.equipment, m.shared,
           m.dot / (n.n * (select n from src_norm)) as sim,
           (select count(distinct s.session_id)::integer from public.sets s where s.exercise_id = e.id and s.deleted_at is null) as done
    from matched m
    join norms n on n.exercise_id = m.exercise_id
    join public.exercises e on e.id = m.exercise_id
    where m.shared is not null
  )
  select s.id, s.name, s.equipment, round(s.sim, 2), s.shared, s.done
  from scored s
  where s.sim >= 0.5
  order by round(s.sim, 1) desc,
           (s.done > 0) desc,
           (s.equipment is distinct from (select equipment from src_ex)) desc,
           s.done desc,
           s.name
  limit greatest(coalesce(p_limit, 4), 0)
$$;
comment on function public.suggest_backups(uuid, uuid[], integer) is
  'Exercises that could stand in for p_exercise_id (a backup for when its machine is taken), best first: they share a primary muscle and match the muscle tags of the original by 0.5 or more (cosine of the primary 1 / secondary 0.5 weights). Ties go to exercises already done, then to different equipment. p_exclude: ids to leave out (the routine''s own exercises). Returns exercise_id, name, equipment, similarity (0.5 to 1), shared_muscles (labels of the shared primary muscles) and times_done (sessions it was logged in). Only your own exercises; nothing without muscle tags. Saves nothing.';
revoke execute on function public.suggest_backups(uuid, uuid[], integer) from public, anon;
grant  execute on function public.suggest_backups(uuid, uuid[], integer) to authenticated;
