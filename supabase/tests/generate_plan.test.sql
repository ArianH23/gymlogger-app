-- Tests for the progression rules. Run with: npx supabase test db
-- Everything runs in a transaction that is rolled back at the end.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'test@example.com');
insert into public.routines (id, user_id, name)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Test routine');

create temp table ex (name text primary key, id uuid not null default gen_random_uuid());
insert into ex (name) values ('new_ex'), ('up_weighted'), ('up_assisted'), ('up_noinc'), ('up_bodyweight'),
                             ('down'), ('down_guard'), ('keep'), ('keep_cap'), ('lr'), ('pyramid'), ('small_down');

create function pg_temp.x(p text) returns uuid language sql as $$ select id from ex where name = p $$;

insert into public.exercises (id, user_id, name, equipment, unilateral, load_type, rep_min, rep_max, increment_kg)
select ex.id, '00000000-0000-0000-0000-0000000000a1', ex.name, v.eq, v.uni, v.lt, v.rmin, v.rmax, v.inc
from ex join (values
  ('new_ex',        'dumbbell',   false, 'weighted',   6, 10, 4.0::numeric),
  ('up_weighted',   'dumbbell',   false, 'weighted',   6, 10, 4.0),
  ('up_assisted',   'machine',    false, 'assisted',   6, 10, 5.0),
  ('up_noinc',      'machine',    false, 'weighted',  10, 15, null),
  ('up_bodyweight', 'bodyweight', false, 'bodyweight', 8, 15, null),
  ('down',          'dumbbell',   false, 'weighted',   6, 10, 4.0),
  ('down_guard',    'dumbbell',   false, 'weighted',   6, 10, 4.0),
  ('keep',          'dumbbell',   false, 'weighted',   6, 10, 4.0),
  ('keep_cap',      'dumbbell',   false, 'weighted',   6, 10, 4.0),
  ('lr',            'cable',      true,  'weighted',  12, 20, 2.5),
  ('pyramid',       'machine',    false, 'weighted',   6, 10, null),
  ('small_down',    'cable',      false, 'weighted',  12, 20, 2.5)
) v (name, eq, uni, lt, rmin, rmax, inc) on v.name = ex.name;

insert into public.routine_exercises (user_id, routine_id, exercise_id, position, target_sets)
select '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', id,
       row_number() over (order by name), 3
from ex;

-- Log sets. Higher p_day = more recent. p_done = false creates an unfinished session.
create function pg_temp.log(p_ex text, p_day integer, p_w numeric, p_reps integer[], p_side text default null,
                            p_done boolean default true, p_warm boolean default false, p_from integer default 1)
returns void language plpgsql as $$
declare
  v_title text := 'day ' || p_day || case when p_done then '' else ' open' end;
  v_s uuid;
begin
  select id into v_s from public.sessions where title = v_title;
  if v_s is null then
    insert into public.sessions (user_id, routine_id, title, started_at, ended_at)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', v_title,
            timestamptz '2026-01-01' + p_day * interval '1 day',
            case when p_done then timestamptz '2026-01-01' + p_day * interval '1 day' + interval '1 hour' end)
    returning id into v_s;
  end if;
  for i in 1..cardinality(p_reps) loop
    insert into public.sets (user_id, session_id, exercise_id, set_no, side, weight_kg, reps, is_warmup)
    values ('00000000-0000-0000-0000-0000000000a1', v_s, pg_temp.x(p_ex), p_from + i - 1, p_side, p_w,
            p_reps[i], p_warm);
  end loop;
end $$;

-- History for each scenario (new_ex has none).
select pg_temp.log('up_weighted',   2, 40,   '{10,10,10}');
select pg_temp.log('up_assisted',   2, 50,   '{10,10,10}');
select pg_temp.log('up_noinc',      2, 36,   '{15,15,15}');
select pg_temp.log('up_bodyweight', 2, null, '{15,15,15}');
select pg_temp.log('down',          1, 44,   '{6,6,4}');
select pg_temp.log('down',          2, 44,   '{6,5,5}');
select pg_temp.log('down_guard',    1, 44,   '{6,6,4}');
select pg_temp.log('down_guard',    2, 40,   '{6,5,5}');
select pg_temp.log('keep',          2, 36,   '{8,8,7}');
select pg_temp.log('keep',          2, 100,  '{5}', null, true, true, 4);   -- warm-up: must be ignored
select pg_temp.log('keep',          3, 50,   '{10,10,10}', null, false);    -- unfinished session: must be ignored
select pg_temp.log('keep_cap',      2, 36,   '{10,10,9}');
select pg_temp.log('lr',            2, 10,   '{20,20,20}', 'L');
select pg_temp.log('lr',            2, 10,   '{20,20,15}', 'R');

select pg_temp.log('pyramid',       2, 50,   '{8,8}');
select pg_temp.log('pyramid',       2, 60,   '{7}', null, true, false, 3);
select pg_temp.log('small_down',    1, 7.5,  '{11,11,10}');
select pg_temp.log('small_down',    2, 7.5,  '{11,10,10}');

-- A pending claude plan that the rules must never replace.
insert into public.planned_sessions (id, user_id, routine_id, created_by, status)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000b1', 'claude', 'pending');

-- Generate twice: the first plan must end up superseded.
do $$ begin
  perform public.generate_plan('00000000-0000-0000-0000-0000000000b1');
  perform public.generate_plan('00000000-0000-0000-0000-0000000000b1');
end $$;

create function pg_temp.pset(p_name text, k integer) returns public.planned_sets language sql as $$
  select ps.* from public.planned_sets ps
  join public.planned_sessions p on p.id = ps.planned_session_id
  where p.created_by = 'rules' and p.status = 'pending' and ps.exercise_id = pg_temp.x(p_name) and ps.set_no = k
$$;
create function pg_temp.mins(p_name text) returns integer[] language sql as $$
  select array_agg(ps.target_reps_min order by ps.set_no) from public.planned_sets ps
  join public.planned_sessions p on p.id = ps.planned_session_id
  where p.created_by = 'rules' and p.status = 'pending' and ps.exercise_id = pg_temp.x(p_name)
$$;

-- No history
select is((pg_temp.pset('new_ex', 1)).target_weight_kg, null::numeric, 'no history: no weight target');
select alike((pg_temp.pset('new_ex', 1)).note, 'Establish load%', 'no history: establish-load note');
select is((pg_temp.pset('new_ex', 1)).target_reps_max, 10, 'no history: rep range from the exercise');

-- Rule 1: all sets reached rep_max
select is((pg_temp.pset('up_weighted', 1)).target_weight_kg, 44::numeric, 'rule 1: weight + increment');
select is((pg_temp.pset('up_weighted', 1)).target_reps_min, 6, 'rule 1: reps reset to rep_min');
select is((pg_temp.pset('up_assisted', 1)).target_weight_kg, 45::numeric, 'rule 1 assisted: assistance goes DOWN');
select is((pg_temp.pset('up_noinc', 1)).target_weight_kg, 36::numeric, 'rule 1, no increment: weight kept');
select alike((pg_temp.pset('up_noinc', 1)).note, '%increment not set%', 'rule 1, no increment: says so');
select is((pg_temp.pset('up_bodyweight', 1)).target_weight_kg, null::numeric, 'bodyweight: no weight target');
select is((pg_temp.pset('up_bodyweight', 1)).target_reps_min, 15, 'bodyweight at rep_max: stays at the top');

-- Rule 2: below rep_min in each of the last 2 sessions
select is((pg_temp.pset('down', 1)).target_weight_kg, 40::numeric, 'rule 2: ~10% lighter, rounded to increment (44 -> 40)');
select is((pg_temp.pset('down_guard', 1)).target_weight_kg, 40::numeric, 'rule 2 guard: weights differ, no second deload');
select is((pg_temp.pset('down_guard', 1)).target_reps_min, 7, 'rule 2 guard: falls to rule 3 (6 + 1)');

-- Rule 3: same weight, last reps + 1 per set
select is((pg_temp.pset('keep', 1)).target_weight_kg, 36::numeric, 'rule 3: same weight (warm-up and open session ignored)');
select is(pg_temp.mins('keep'), array[9, 9, 8], 'rule 3: last reps + 1 per set');
select is(pg_temp.mins('keep_cap'), array[10, 10, 10], 'rule 3: capped at rep_max');

-- Sets at different weights keep their own weight
select is(array[(pg_temp.pset('pyramid', 1)).target_weight_kg, (pg_temp.pset('pyramid', 2)).target_weight_kg,
                (pg_temp.pset('pyramid', 3)).target_weight_kg], array[50, 50, 60]::numeric[],
          'mixed weights: each set keeps its own weight');
select is(pg_temp.mins('pyramid'), array[9, 9, 8], 'mixed weights: reps +1 per set');

-- Rule 2 when 10% is smaller than one step
select is((pg_temp.pset('small_down', 1)).target_weight_kg, 7.5::numeric, 'small deload: weight held, not forced down a step');
select alike((pg_temp.pset('small_down', 1)).note, '%less than one step%', 'small deload: note explains it');

-- Left/right: the lower side decides
select is(pg_temp.mins('lr'), array[20, 20, 16], 'left/right: lower of L and R drives the target');

-- Plan bookkeeping
select is((select count(*) from public.planned_sets ps join public.planned_sessions p on p.id = ps.planned_session_id
           where p.routine_id = '00000000-0000-0000-0000-0000000000b1' and p.created_by = 'rules' and p.status = 'pending'), 36::bigint, '12 exercises x target_sets 3');
select is((select count(*) from public.planned_sessions where routine_id = '00000000-0000-0000-0000-0000000000b1' and created_by = 'rules' and status = 'pending'), 1::bigint,
          'only one pending rules plan');
select is((select count(*) from public.planned_sessions where routine_id = '00000000-0000-0000-0000-0000000000b1' and created_by = 'rules' and status = 'superseded'), 1::bigint,
          'older rules plan superseded');
select is((select status from public.planned_sessions where id = '00000000-0000-0000-0000-0000000000c1'), 'pending',
          'claude plan untouched by generate_plan');
select is((select id from public.current_plan where routine_id = '00000000-0000-0000-0000-0000000000b1'),
          '00000000-0000-0000-0000-0000000000c1'::uuid, 'current_plan: claude plan wins over rules plan');

-- last_performance view
select is((select reps_result from public.last_performance where exercise_name = 'lr' and set_no = 3), 15,
          'last_performance: L/R merged to the lower reps');
select is((select count(*) from public.last_performance where exercise_name = 'keep'), 3::bigint,
          'last_performance: no warm-ups, no unfinished sessions');

select throws_ok($$select public.generate_plan('00000000-0000-0000-0000-00000000dead')$$, 'P0001',
                 'routine 00000000-0000-0000-0000-00000000dead not found', 'unknown routine raises an error');

select * from finish();
rollback;
