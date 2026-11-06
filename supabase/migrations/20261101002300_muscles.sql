-- Which muscles each exercise works, and how much of the work each muscle gets: per session, per week, per month.
-- A working set counts 1 for each primary muscle and 0.5 for each secondary one (warm-ups do not count; a left/right pair is one set).

-- The 16 muscles, with their labels and display order.
create function public.muscle_defs() returns table (muscle text, label text, ord integer)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('chest', 'Chest', 1),
    ('front_delts', 'Front delts', 2),
    ('side_delts', 'Side delts', 3),
    ('rear_delts', 'Rear delts', 4),
    ('lats', 'Lats', 5),
    ('upper_back', 'Upper back', 6),
    ('lower_back', 'Lower back', 7),
    ('biceps', 'Biceps', 8),
    ('triceps', 'Triceps', 9),
    ('forearms', 'Forearms', 10),
    ('abs', 'Abs', 11),
    ('glutes', 'Glutes', 12),
    ('quads', 'Quads', 13),
    ('hamstrings', 'Hamstrings', 14),
    ('adductors', 'Adductors', 15),
    ('calves', 'Calves', 16)
  ) as v (muscle, label, ord)
$$;
comment on function public.muscle_defs() is 'The 16 muscles the app tracks: key, label and display order (front of the body first, then back, then legs).';
revoke execute on function public.muscle_defs() from public, anon;
grant  execute on function public.muscle_defs() to authenticated;

-- The standard tags, by exercise name. New exercises with one of these names are tagged automatically (trigger below).
create function public.exercise_muscle_defaults() returns table (exercise_name text, muscle text, role text)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('Bench Press (Barbell)', 'chest', 'primary'),
    ('Bench Press (Barbell)', 'triceps', 'secondary'),
    ('Bench Press (Barbell)', 'front_delts', 'secondary'),
    ('Bench Press (Dumbbell)', 'chest', 'primary'),
    ('Bench Press (Dumbbell)', 'triceps', 'secondary'),
    ('Bench Press (Dumbbell)', 'front_delts', 'secondary'),
    ('Chest Press (Machine)', 'chest', 'primary'),
    ('Chest Press (Machine)', 'triceps', 'secondary'),
    ('Chest Press (Machine)', 'front_delts', 'secondary'),
    ('Decline Bench Press (Machine)', 'chest', 'primary'),
    ('Decline Bench Press (Machine)', 'triceps', 'secondary'),
    ('Decline Bench Press (Machine)', 'front_delts', 'secondary'),
    ('Iso-Lateral Chest Press (Machine)', 'chest', 'primary'),
    ('Iso-Lateral Chest Press (Machine)', 'triceps', 'secondary'),
    ('Iso-Lateral Chest Press (Machine)', 'front_delts', 'secondary'),
    ('Incline Bench Press (Dumbbell) 30°', 'chest', 'primary'),
    ('Incline Bench Press (Dumbbell) 30°', 'front_delts', 'primary'),
    ('Incline Bench Press (Dumbbell) 30°', 'triceps', 'secondary'),
    ('Incline Bench Press (Dumbbell) 45°', 'chest', 'primary'),
    ('Incline Bench Press (Dumbbell) 45°', 'front_delts', 'primary'),
    ('Incline Bench Press (Dumbbell) 45°', 'triceps', 'secondary'),
    ('Incline Chest Press (Machine)', 'chest', 'primary'),
    ('Incline Chest Press (Machine)', 'front_delts', 'primary'),
    ('Incline Chest Press (Machine)', 'triceps', 'secondary'),
    ('Butterfly (Pec Deck)', 'chest', 'primary'),
    ('Butterfly (Pec Deck)', 'front_delts', 'secondary'),
    ('Push Up', 'chest', 'primary'),
    ('Push Up', 'triceps', 'secondary'),
    ('Push Up', 'front_delts', 'secondary'),
    ('Push Up', 'abs', 'secondary'),
    ('Lat Pulldown (Cable)', 'lats', 'primary'),
    ('Lat Pulldown (Cable)', 'biceps', 'secondary'),
    ('Lat Pulldown (Cable)', 'upper_back', 'secondary'),
    ('Lat Pulldown (Machine)', 'lats', 'primary'),
    ('Lat Pulldown (Machine)', 'biceps', 'secondary'),
    ('Lat Pulldown (Machine)', 'upper_back', 'secondary'),
    ('Chin Up (Assisted)', 'lats', 'primary'),
    ('Chin Up (Assisted)', 'biceps', 'secondary'),
    ('Chin Up (Assisted)', 'upper_back', 'secondary'),
    ('Dumbbell Row', 'lats', 'primary'),
    ('Dumbbell Row', 'upper_back', 'primary'),
    ('Dumbbell Row', 'biceps', 'secondary'),
    ('Dumbbell Row', 'rear_delts', 'secondary'),
    ('Dumbbell Row (Single Arm)', 'lats', 'primary'),
    ('Dumbbell Row (Single Arm)', 'upper_back', 'primary'),
    ('Dumbbell Row (Single Arm)', 'biceps', 'secondary'),
    ('Dumbbell Row (Single Arm)', 'rear_delts', 'secondary'),
    ('Seated Cable Row - Bar Grip', 'lats', 'primary'),
    ('Seated Cable Row - Bar Grip', 'upper_back', 'primary'),
    ('Seated Cable Row - Bar Grip', 'biceps', 'secondary'),
    ('Seated Cable Row - Bar Grip', 'rear_delts', 'secondary'),
    ('Seated Row (Machine)', 'lats', 'primary'),
    ('Seated Row (Machine)', 'upper_back', 'primary'),
    ('Seated Row (Machine)', 'biceps', 'secondary'),
    ('Seated Row (Machine)', 'rear_delts', 'secondary'),
    ('Iso-Lateral High Row (Machine)', 'lats', 'primary'),
    ('Iso-Lateral High Row (Machine)', 'upper_back', 'primary'),
    ('Iso-Lateral High Row (Machine)', 'biceps', 'secondary'),
    ('Iso-Lateral High Row (Machine)', 'rear_delts', 'secondary'),
    ('Chest Supported Incline Row (Dumbbell)', 'lats', 'primary'),
    ('Chest Supported Incline Row (Dumbbell)', 'upper_back', 'primary'),
    ('Chest Supported Incline Row (Dumbbell)', 'biceps', 'secondary'),
    ('Chest Supported Incline Row (Dumbbell)', 'rear_delts', 'secondary'),
    ('Chest Supported Reverse Fly (Dumbbell)', 'rear_delts', 'primary'),
    ('Chest Supported Reverse Fly (Dumbbell)', 'upper_back', 'secondary'),
    ('Reverse Fly Single Arm (Cable)', 'rear_delts', 'primary'),
    ('Reverse Fly Single Arm (Cable)', 'upper_back', 'secondary'),
    ('Lateral Raise (Cable)', 'side_delts', 'primary'),
    ('Lateral Raise (Dumbbell)', 'side_delts', 'primary'),
    ('Lateral Raise (Machine)', 'side_delts', 'primary'),
    ('Seated Lateral Raise (Dumbbell)', 'side_delts', 'primary'),
    ('Single Arm Lateral Raise (Cable)', 'side_delts', 'primary'),
    ('Overhead Press (Barbell)', 'front_delts', 'primary'),
    ('Overhead Press (Barbell)', 'triceps', 'secondary'),
    ('Overhead Press (Barbell)', 'side_delts', 'secondary'),
    ('Shoulder Press (Dumbbell)', 'front_delts', 'primary'),
    ('Shoulder Press (Dumbbell)', 'side_delts', 'primary'),
    ('Shoulder Press (Dumbbell)', 'triceps', 'secondary'),
    ('Seated Shoulder Press (Machine)', 'front_delts', 'primary'),
    ('Seated Shoulder Press (Machine)', 'side_delts', 'primary'),
    ('Seated Shoulder Press (Machine)', 'triceps', 'secondary'),
    ('Bicep Curl (Dumbbell)', 'biceps', 'primary'),
    ('Bicep Curl (Dumbbell)', 'forearms', 'secondary'),
    ('Bicep Curl (Machine)', 'biceps', 'primary'),
    ('Bicep Curl (Machine)', 'forearms', 'secondary'),
    ('Preacher Curl (Machine)', 'biceps', 'primary'),
    ('Preacher Curl (Machine)', 'forearms', 'secondary'),
    ('Seated Incline Curl (Dumbbell)', 'biceps', 'primary'),
    ('Seated Incline Curl (Dumbbell)', 'forearms', 'secondary'),
    ('Concentration Curl', 'biceps', 'primary'),
    ('Concentration Curl', 'forearms', 'secondary'),
    ('Cross Body Hammer Curl', 'biceps', 'primary'),
    ('Cross Body Hammer Curl', 'forearms', 'secondary'),
    ('Hammer Curl (Dumbbell)', 'biceps', 'primary'),
    ('Hammer Curl (Dumbbell)', 'forearms', 'primary'),
    ('Behind the Back Bicep Wrist Curl (Barbell)', 'forearms', 'primary'),
    ('Reversed Seated Wrist Curl', 'forearms', 'primary'),
    ('Triceps Pushdown', 'triceps', 'primary'),
    ('Triceps Rope Pushdown', 'triceps', 'primary'),
    ('Overhead Triceps Extension (Cable)', 'triceps', 'primary'),
    ('Triceps Extension (Dumbbell)', 'triceps', 'primary'),
    ('Triceps Extension (Machine)', 'triceps', 'primary'),
    ('Seated Triceps Press', 'triceps', 'primary'),
    ('Seated Dip Machine', 'triceps', 'primary'),
    ('Seated Dip Machine', 'chest', 'secondary'),
    ('Seated Dip Machine', 'front_delts', 'secondary'),
    ('Muscle Up', 'lats', 'primary'),
    ('Muscle Up', 'triceps', 'primary'),
    ('Muscle Up', 'chest', 'secondary'),
    ('Muscle Up', 'biceps', 'secondary'),
    ('Muscle Up', 'front_delts', 'secondary'),
    ('Squat (Barbell)', 'quads', 'primary'),
    ('Squat (Barbell)', 'glutes', 'primary'),
    ('Squat (Barbell)', 'adductors', 'secondary'),
    ('Squat (Barbell)', 'hamstrings', 'secondary'),
    ('Squat (Bodyweight)', 'quads', 'primary'),
    ('Squat (Bodyweight)', 'glutes', 'primary'),
    ('Squat (Bodyweight)', 'adductors', 'secondary'),
    ('Squat (Bodyweight)', 'hamstrings', 'secondary'),
    ('Goblet Squat', 'quads', 'primary'),
    ('Goblet Squat', 'glutes', 'primary'),
    ('Goblet Squat', 'adductors', 'secondary'),
    ('Goblet Squat', 'hamstrings', 'secondary'),
    ('Walking Lunge', 'quads', 'primary'),
    ('Walking Lunge', 'glutes', 'primary'),
    ('Walking Lunge', 'adductors', 'secondary'),
    ('Walking Lunge', 'hamstrings', 'secondary'),
    ('Walking Lunge (Dumbbell)', 'quads', 'primary'),
    ('Walking Lunge (Dumbbell)', 'glutes', 'primary'),
    ('Walking Lunge (Dumbbell)', 'adductors', 'secondary'),
    ('Walking Lunge (Dumbbell)', 'hamstrings', 'secondary'),
    ('Leg Press Horizontal (Machine)', 'quads', 'primary'),
    ('Leg Press Horizontal (Machine)', 'glutes', 'primary'),
    ('Leg Press Horizontal (Machine)', 'hamstrings', 'secondary'),
    ('Leg Press Horizontal (Machine)', 'adductors', 'secondary'),
    ('Sumo Squat (Barbell)', 'quads', 'primary'),
    ('Sumo Squat (Barbell)', 'glutes', 'primary'),
    ('Sumo Squat (Barbell)', 'adductors', 'primary'),
    ('Leg Extension (Machine)', 'quads', 'primary'),
    ('Lying Leg Curl (Machine)', 'hamstrings', 'primary'),
    ('Seated Leg Curl (Machine)', 'hamstrings', 'primary'),
    ('Romanian Deadlift (Barbell)', 'hamstrings', 'primary'),
    ('Romanian Deadlift (Barbell)', 'glutes', 'primary'),
    ('Romanian Deadlift (Barbell)', 'lower_back', 'secondary'),
    ('Romanian Deadlift (Dumbbell)', 'hamstrings', 'primary'),
    ('Romanian Deadlift (Dumbbell)', 'glutes', 'primary'),
    ('Romanian Deadlift (Dumbbell)', 'lower_back', 'secondary'),
    ('Deadlift (Barbell)', 'glutes', 'primary'),
    ('Deadlift (Barbell)', 'hamstrings', 'primary'),
    ('Deadlift (Barbell)', 'lower_back', 'primary'),
    ('Deadlift (Barbell)', 'quads', 'secondary'),
    ('Deadlift (Barbell)', 'upper_back', 'secondary'),
    ('Deadlift (Barbell)', 'forearms', 'secondary'),
    ('Hip Thrust (Barbell)', 'glutes', 'primary'),
    ('Hip Thrust (Barbell)', 'hamstrings', 'secondary'),
    ('Hip Thrust (Machine)', 'glutes', 'primary'),
    ('Hip Thrust (Machine)', 'hamstrings', 'secondary'),
    ('Glute Kickback (Machine)', 'glutes', 'primary'),
    ('Glute Kickback (Machine)', 'hamstrings', 'secondary'),
    ('Back Extension (Machine)', 'lower_back', 'primary'),
    ('Back Extension (Machine)', 'glutes', 'primary'),
    ('Back Extension (Machine)', 'hamstrings', 'secondary'),
    ('Hip Adduction (Machine)', 'adductors', 'primary'),
    ('Standing Calf Raise', 'calves', 'primary'),
    ('Calf Extension (Machine)', 'calves', 'primary'),
    ('Crunch (Machine)', 'abs', 'primary'),
    ('Reverse Crunch', 'abs', 'primary'),
    ('Sit Up', 'abs', 'primary'),
    ('Leg Raise Parallel Bars', 'abs', 'primary'),
    ('Lying Leg Raise', 'abs', 'primary'),
    ('Torso Rotation', 'abs', 'primary')
  ) as v (exercise_name, muscle, role)
$$;
comment on function public.exercise_muscle_defaults() is 'The standard muscle tags of the exercise catalog, by exercise name: which muscles each works, as primary or secondary.';
revoke execute on function public.exercise_muscle_defaults() from public, anon;
grant  execute on function public.exercise_muscle_defaults() to authenticated;

create table public.exercise_muscles (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  muscle      text not null check (muscle in ('chest', 'front_delts', 'side_delts', 'rear_delts', 'lats', 'upper_back', 'lower_back', 'biceps', 'triceps', 'forearms', 'abs', 'glutes', 'quads', 'hamstrings', 'adductors', 'calves')),
  role        text not null check (role in ('primary', 'secondary')),
  primary key (exercise_id, muscle)
);
alter table public.exercise_muscles enable row level security;
create policy exercise_muscles_own_rows on public.exercise_muscles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
comment on table public.exercise_muscles is 'The muscles an exercise works. Primary muscles get a full set of credit per working set, secondary ones half.';
comment on column public.exercise_muscles.user_id is 'Owner. RLS restricts every row to this user.';
comment on column public.exercise_muscles.exercise_id is 'The exercise (deleting it removes its tags).';
comment on column public.exercise_muscles.muscle is 'One of the 16 muscles (see muscle_defs()).';
comment on column public.exercise_muscles.role is 'primary (1 per set) or secondary (0.5 per set).';

-- Tag the exercises that already exist, and every new one whose name is in the catalog.
insert into public.exercise_muscles (user_id, exercise_id, muscle, role)
select e.user_id, e.id, d.muscle, d.role
from public.exercises e
join public.exercise_muscle_defaults() d on d.exercise_name = e.name;

create function public.tag_new_exercise() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.exercise_muscles (user_id, exercise_id, muscle, role)
  select new.user_id, new.id, d.muscle, d.role from public.exercise_muscle_defaults() d where d.exercise_name = new.name;
  return new;
end
$$;
revoke execute on function public.tag_new_exercise() from public, anon, authenticated;
create trigger exercises_tag_muscles after insert on public.exercises
  for each row execute function public.tag_new_exercise();

-- Per finished session and muscle: the sets it got (primary 1, secondary 0.5) and its share of the whole session.
create view public.session_muscles with (security_invoker = true) as
select m.user_id,
       r.session_id,
       r.started_at,
       m.muscle,
       d.label,
       d.ord,
       sum(case when m.role = 'primary' then 1 else 0.5 end) as sets,
       round(sum(case when m.role = 'primary' then 1 else 0.5 end) / sum(sum(case when m.role = 'primary' then 1 else 0.5 end)) over (partition by r.session_id), 3) as share
from public.exercise_set_results r
join public.exercise_muscles m on m.exercise_id = r.exercise_id
join public.muscle_defs() d on d.muscle = m.muscle
group by m.user_id, r.session_id, r.started_at, m.muscle, d.label, d.ord;
comment on view public.session_muscles is 'For each finished session, the sets each muscle got (primary muscle 1 per working set, secondary 0.5) and its share of the session total. Muscles not trained in a session have no row.';
comment on column public.session_muscles.user_id is 'Owner.';
comment on column public.session_muscles.session_id is 'The session.';
comment on column public.session_muscles.started_at is 'When the session started.';
comment on column public.session_muscles.muscle is 'Muscle key (see muscle_defs()).';
comment on column public.session_muscles.label is 'Muscle name for display.';
comment on column public.session_muscles.ord is 'Display order.';
comment on column public.session_muscles.sets is 'Weighted sets: primary 1, secondary 0.5 per working set.';
comment on column public.session_muscles.share is 'This muscle''s part of the session total, 0 to 1.';

-- Per week (Monday, local time as in weekly_overview) and per month: the same sets, summed.
create view public.weekly_muscles with (security_invoker = true) as
select user_id,
       date_trunc('week', started_at at time zone 'Europe/Berlin')::date as week_start,
       muscle, label, ord,
       sum(sets) as sets,
       round(sum(sets) / sum(sum(sets)) over (partition by user_id, date_trunc('week', started_at at time zone 'Europe/Berlin')::date), 3) as share,
       count(distinct session_id) as sessions
from public.session_muscles
group by user_id, date_trunc('week', started_at at time zone 'Europe/Berlin')::date, muscle, label, ord;
comment on view public.weekly_muscles is 'Weighted sets per muscle per week (Monday start): primary 1, secondary 0.5 per working set. Compare with the research range of roughly 10 or more direct sets per muscle per week.';
comment on column public.weekly_muscles.user_id is 'Owner.';
comment on column public.weekly_muscles.week_start is 'Monday of the week.';
comment on column public.weekly_muscles.muscle is 'Muscle key (see muscle_defs()).';
comment on column public.weekly_muscles.label is 'Muscle name for display.';
comment on column public.weekly_muscles.ord is 'Display order.';
comment on column public.weekly_muscles.sets is 'Weighted sets in the period.';
comment on column public.weekly_muscles.share is 'This muscle''s part of the period total, 0 to 1.';
comment on column public.weekly_muscles.sessions is 'Sessions in the period that trained this muscle.';

create view public.monthly_muscles with (security_invoker = true) as
select user_id,
       date_trunc('month', started_at at time zone 'Europe/Berlin')::date as month_start,
       muscle, label, ord,
       sum(sets) as sets,
       round(sum(sets) / sum(sum(sets)) over (partition by user_id, date_trunc('month', started_at at time zone 'Europe/Berlin')::date), 3) as share,
       count(distinct session_id) as sessions
from public.session_muscles
group by user_id, date_trunc('month', started_at at time zone 'Europe/Berlin')::date, muscle, label, ord;
comment on view public.monthly_muscles is 'Weighted sets per muscle per calendar month: primary 1, secondary 0.5 per working set.';
comment on column public.monthly_muscles.user_id is 'Owner.';
comment on column public.monthly_muscles.month_start is 'First day of the month.';
comment on column public.monthly_muscles.muscle is 'Muscle key (see muscle_defs()).';
comment on column public.monthly_muscles.label is 'Muscle name for display.';
comment on column public.monthly_muscles.ord is 'Display order.';
comment on column public.monthly_muscles.sets is 'Weighted sets in the period.';
comment on column public.monthly_muscles.share is 'This muscle''s part of the period total, 0 to 1.';
comment on column public.monthly_muscles.sessions is 'Sessions in the period that trained this muscle.';
