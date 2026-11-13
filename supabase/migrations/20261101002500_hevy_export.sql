-- Export your workouts as a CSV that Hevy can import. Hevy only imports files in the format of the Strong app (it cannot read its own
-- export), so this writes that format: one row per set, 12 columns, comma separated, weights in kg, local time.
-- The format is not documented by Hevy; it follows third-party documentation, so test it with a small file first.

-- Hevy has one incline dumbbell bench and one dumbbell row; this catalog splits them (see the importer). Back to Hevy's names.
create function public.hevy_exercise_name(p_name text) returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_name like 'Incline Bench Press (Dumbbell) %' then 'Incline Bench Press (Dumbbell)'
           when p_name = 'Dumbbell Row (Single Arm)' then 'Dumbbell Row'
           else p_name
         end
$$;
comment on function public.hevy_exercise_name(text) is
  'The name Hevy uses for an exercise: the incline bench angles (30°, 45°) and the single-arm dumbbell row go back to Hevy''s one incline bench and one dumbbell row; every other name is unchanged.';
revoke execute on function public.hevy_exercise_name(text) from public, anon;
grant  execute on function public.hevy_exercise_name(text) to authenticated;

-- One CSV field: quoted (with "" for a quote) only when it has a comma, a quote or a line break (RFC 4180).
create function public.csv_field(p_value text) returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value ~ '[",\r\n]' then '"' || replace(p_value, '"', '""') || '"' else coalesce(p_value, '') end
$$;
comment on function public.csv_field(text) is 'Quotes a value for a CSV file only when it contains a comma, a quote or a line break.';
revoke execute on function public.csv_field(text) from public, anon;
grant  execute on function public.csv_field(text) to authenticated;

-- The rows of the export, one per set: finished sessions, working sets only (the format has no warm-up type), in the order they were done.
create view public.hevy_export_rows with (security_invoker = true) as
with sets_in_order as (
  select ss.user_id,
         ss.id as session_id,
         ss.source,
         ss.started_at,
         ss.ended_at,
         ss.title,
         ss.notes as session_notes,
         public.hevy_exercise_name(e.name) as exercise_name,
         e.name as catalog_name,
         st.side,
         st.set_no,
         st.weight_kg,
         st.reps,
         n.note as exercise_note,
         min(st.logged_at) over (partition by ss.id, st.exercise_id) as exercise_first_logged
  from public.sessions ss
  join public.sets st on st.session_id = ss.id and st.deleted_at is null and not st.is_warmup
  join public.exercises e on e.id = st.exercise_id
  left join public.session_exercise_notes n on n.session_id = ss.id and n.exercise_id = st.exercise_id and n.deleted_at is null
  where ss.ended_at is not null and ss.deleted_at is null
    and not (st.weight_kg is null and st.reps is null)
),
numbered as (
  select s.*,
         row_number() over (partition by session_id, exercise_name
                            order by exercise_first_logged, catalog_name, set_no, side nulls first) as set_order,
         round(extract(epoch from (ended_at - started_at)) / 60)::integer as minutes
  from sets_in_order s
)
select user_id,
       session_id,
       source,
       started_at,
       exercise_first_logged,
       to_char(started_at at time zone 'Europe/Berlin', 'YYYY-MM-DD HH24:MI:SS') as date,
       title as workout_name,
       case when minutes between 1 and 1439
            then case when minutes >= 60 then (minutes / 60)::text || 'h' || case when minutes % 60 > 0 then ' ' || (minutes % 60)::text || 'm' else '' end
                      else minutes::text || 'm' end
            else '0m' end as duration,
       exercise_name,
       set_order,
       trim_scale(coalesce(weight_kg, 0))::text as weight,
       coalesce(reps, 0)::text as reps,
       '0' as distance,
       '0' as seconds,
       concat_ws(' · ',
                 side,
                 case when set_order = 1 then exercise_note end,
                 case when set_order = 1 and catalog_name like '% 30°' then '30°' end) as notes,
       coalesce(session_notes, '') as workout_notes
from numbered;

comment on view public.hevy_export_rows is
  'The rows of the Hevy (Strong format) export, one per working set of a finished session: date (local time), workout name, duration, Hevy exercise name, set order (1..n per exercise), weight in kg, reps, notes. Left/right sets are separate rows with the side in notes; the exercise note and the incline angle go on the first row of the exercise.';
comment on column public.hevy_export_rows.user_id is 'Owner.';
comment on column public.hevy_export_rows.session_id is 'The session.';
comment on column public.hevy_export_rows.source is 'app (logged here) or hevy_import (came from the Hevy history).';
comment on column public.hevy_export_rows.started_at is 'When the session started (for ordering).';
comment on column public.hevy_export_rows.exercise_first_logged is 'When the exercise was first logged in the session (for ordering).';
comment on column public.hevy_export_rows.date is 'Session start, YYYY-MM-DD HH:MM:SS, local time.';
comment on column public.hevy_export_rows.workout_name is 'Session title.';
comment on column public.hevy_export_rows.duration is 'Session length as 45m, 1h or 2h 38m.';
comment on column public.hevy_export_rows.exercise_name is 'Exercise name as Hevy knows it.';
comment on column public.hevy_export_rows.set_order is 'Counts 1, 2, 3... within the exercise in that session (left and right sets each count).';
comment on column public.hevy_export_rows.weight is 'Weight in kg as stored (0 for bodyweight).';
comment on column public.hevy_export_rows.reps is 'Reps (0 if none).';
comment on column public.hevy_export_rows.distance is 'Always 0: strength sets only.';
comment on column public.hevy_export_rows.seconds is 'Always 0: strength sets only.';
comment on column public.hevy_export_rows.notes is 'Side (L or R), the exercise note and the incline angle, on the rows where they apply.';
comment on column public.hevy_export_rows.workout_notes is 'The session notes, repeated on every row.';

-- The whole file as text. p_only_app true: only workouts logged in this app; false: everything, including the imported Hevy history
-- (which Hevy already has, so importing it back would duplicate it).
create function public.export_hevy_csv(p_only_app boolean default true) returns text
language sql
stable
set search_path = ''
as $$
  select 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE' || E'\n' ||
         coalesce(string_agg(
           concat_ws(',', r.date, public.csv_field(r.workout_name), r.duration, public.csv_field(r.exercise_name), r.set_order::text,
                     r.weight, r.reps, r.distance, r.seconds, public.csv_field(r.notes), public.csv_field(r.workout_notes), ''),
           E'\n' order by r.started_at, r.session_id, r.exercise_first_logged, r.exercise_name, r.set_order), '')
  from public.hevy_export_rows r
  where not p_only_app or r.source = 'app'
$$;
comment on function public.export_hevy_csv(boolean) is
  'Your workouts as a CSV file in the format Hevy imports (the Strong export format: 12 columns, one row per set, kg). With p_only_app true (default) only workouts logged in this app; false also includes the imported Hevy history. Warm-ups are left out.';
revoke execute on function public.export_hevy_csv(boolean) from public, anon;
grant  execute on function public.export_hevy_csv(boolean) to authenticated;
