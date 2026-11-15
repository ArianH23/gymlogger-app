-- Tests for the heart rate of a gym session (submit_session_hr). Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'one@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'two@example.com');
insert into public.sessions (id, user_id, title, started_at) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'mine', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 'not mine', now() - interval '1 hour');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;

-- One reading a second for 10 minutes: 100 bpm for the first half, 140 for the second. Plus two nonsense readings.
select is((public.submit_session_hr('00000000-0000-0000-0000-0000000000d1',
            (select jsonb_agg(jsonb_build_array(s, case when s < 300 then 100 else 140 end)) from generate_series(0, 599) s)
            || '[[10, 0], [20, 400]]'::jsonb)) ->> 'samples', '600', 'the 600 sensible readings are counted, the two impossible ones dropped');
select is((select avg_hr_bpm from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'), 120, 'average 120 bpm');
select is((select max_hr_bpm from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'), 140, 'highest 140 bpm');
select is((select jsonb_array_length(hr_track) from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'), 60, 'one value per 10 seconds: 60 for 10 minutes');
select is((select hr_track -> 0 from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'), '[0, 100]'::jsonb, 'the first value is at 0 s');
select is((select hr_track -> 59 from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'), '[590, 140]'::jsonb, 'the last value is at 590 s');

-- Sending again replaces it; readings in any order are fine.
select is((public.submit_session_hr('00000000-0000-0000-0000-0000000000d1', '[[25, 152], [5, 150], [3, 148]]')) ->> 'max_hr_bpm', '152', 'sending again works');
select is((select hr_track from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'), '[[0, 149], [20, 152]]'::jsonb, 'and replaces the earlier heart rate, in time order');

-- Nothing usable leaves what was there.
select is((public.submit_session_hr('00000000-0000-0000-0000-0000000000d1', '[[5, 999], ["x", 80], 7]')) ->> 'samples', '0', 'no usable reading: 0 samples');
select is((select max_hr_bpm from public.sessions where id = '00000000-0000-0000-0000-0000000000d1'), 152, 'and the heart rate that was there stays');

select throws_ok($$select public.submit_session_hr('00000000-0000-0000-0000-0000000000d2', '[[5, 120]]')$$, 'P0001', null, 'another user''s session is rejected');
select throws_ok($$select public.submit_session_hr('00000000-0000-0000-0000-0000000000ff', '[[5, 120]]')$$, 'P0001', null, 'an unknown session is rejected');
select throws_ok($$select public.submit_session_hr('00000000-0000-0000-0000-0000000000d1', '{"a": 1}')$$, 'P0001', null, 'samples must be an array');

select * from finish();
rollback;
