-- Tests for routine_status (which routine is next). Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'test@example.com');
insert into public.routines (id, user_id, name, position) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Zz R1', 0),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'Zz R2', 1),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a1', 'Zz R3', 2);

create function pg_temp.sess(p_id text, p_routine text, p_day text, p_finished boolean default true) returns void language sql as $$
  insert into public.sessions (id, user_id, routine_id, title, started_at, ended_at)
  values (('00000000-0000-0000-0000-0000000000' || p_id)::uuid, '00000000-0000-0000-0000-0000000000a1',
          case when p_routine is null then null else ('00000000-0000-0000-0000-0000000000' || p_routine)::uuid end,
          'x', ('2026-01-' || p_day || ' 10:00+00')::timestamptz,
          case when p_finished then ('2026-01-' || p_day || ' 11:00+00')::timestamptz end)
$$;

create function pg_temp.next_name() returns text language sql as $$
  select name from public.routine_status where is_next and user_id = '00000000-0000-0000-0000-0000000000a1'
$$;

-- Nothing done yet: ties go by position.
select is(pg_temp.next_name(), 'Zz R1', 'nothing done: the first routine by position is next');

-- R1 on the 10th, R2 on the 5th, R3 never.
select pg_temp.sess('d1', 'b1', '10');
select pg_temp.sess('d2', 'b2', '05');
select is(pg_temp.next_name(), 'Zz R3', 'a routine never done comes first');

-- R3 on the 12th: now R2 (the 5th) is the one done longest ago.
select pg_temp.sess('d3', 'b3', '12');
select is(pg_temp.next_name(), 'Zz R2', 'the routine done longest ago is next');

-- An unfinished session of R2 and a routine-less session must not change anything.
select pg_temp.sess('d4', 'b2', '20', false);
select pg_temp.sess('d5', null, '21');
select is(pg_temp.next_name(), 'Zz R2', 'unfinished and routine-less sessions are ignored');

-- R2 done on the 15th: R1 (the 10th) is next now.
select pg_temp.sess('d6', 'b2', '15');
select is(pg_temp.next_name(), 'Zz R1', 'after doing R2, the next one moves on');

select is((select count(*) from public.routine_status where is_next and user_id = '00000000-0000-0000-0000-0000000000a1'), 1::bigint,
          'exactly one routine is next');
select is((select last_started_at::date from public.routine_status where routine_id = '00000000-0000-0000-0000-0000000000b2'), '2026-01-15'::date,
          'last session date is the latest finished one');
select is((select last_session_id from public.routine_status where routine_id = '00000000-0000-0000-0000-0000000000b2'),
          '00000000-0000-0000-0000-0000000000d6'::uuid, 'last session id');

-- A deleted routine disappears and can never be next.
update public.routines set deleted_at = now() where id = '00000000-0000-0000-0000-0000000000b1';
select is(pg_temp.next_name(), 'Zz R3', 'a deleted routine is skipped (R3 done on the 12th, R2 on the 15th)');

select * from finish();
rollback;
