-- A deleted routine or exercise no longer holds on to its name, and an exercise can be deleted.
--
-- Deleting is soft (deleted_at), but the name stayed unique across deleted rows too: after deleting "Workout C" you could not
-- create another "Workout C", with no routine on screen to explain why. The name is now unique only among the rows that are
-- not deleted (the same rule body_checkins and progress_photos already follow). Everything that looks a name up already
-- skips deleted rows (submit_plan, the lists); the Hevy importer was changed to match (it no longer upserts on the name).

alter table public.routines drop constraint routines_user_id_name_key;
create unique index routines_name_uq on public.routines (user_id, name) where deleted_at is null;
comment on column public.routines.name is 'Routine name, unique per user among the routines that are not deleted.';

alter table public.exercises drop constraint exercises_user_id_name_key;
create unique index exercises_name_uq on public.exercises (user_id, name) where deleted_at is null;
comment on column public.exercises.name is 'Exercise name, unique per user among the exercises that are not deleted (Hevy-style, e.g. "Bench Press (Dumbbell)").';

-- Deleting an exercise: a soft delete, so its sets stay in the history. Refused while a routine still uses it, as the exercise
-- or as the backup of another (the workout would offer something that is gone); the message names the routine.
create function public.delete_exercise(p_exercise_id uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_routine text;
begin
  if not exists (select 1 from public.exercises e where e.id = p_exercise_id and e.deleted_at is null) then
    raise exception 'exercise not found';
  end if;

  select r.name into v_routine
  from public.routine_exercises x
  join public.routines r on r.id = x.routine_id
  where x.deleted_at is null and r.deleted_at is null
    and (x.exercise_id = p_exercise_id or x.backup_exercise_id = p_exercise_id)
  order by r.name
  limit 1;
  if v_routine is not null then
    raise exception 'it is used in the routine "%": take it out there first', v_routine;
  end if;

  update public.exercises set deleted_at = now() where id = p_exercise_id;
end
$$;
comment on function public.delete_exercise(uuid) is
  'Soft-deletes one of your exercises (its logged sets stay in the history, and its name can be used again). Raises ''exercise not found'' if it is not yours or already deleted, and refuses with the routine''s name while a routine uses it, as an exercise or as a backup.';
revoke execute on function public.delete_exercise(uuid) from public, anon;
grant  execute on function public.delete_exercise(uuid) to authenticated;
