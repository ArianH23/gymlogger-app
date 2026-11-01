-- Tests for pairing a watch with a short code. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'test@example.com');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

create temp table codes (n integer primary key, code text not null);
-- a code that is guaranteed to be different from the given one
create function pg_temp.wrong(p_code text) returns text language sql as $$ select lpad(((p_code::integer + 1) % 1000000)::text, 6, '0') $$;
create function pg_temp.claim(p_code text) returns uuid language sql as $$ select public.claim_watch_pairing(p_code) $$;

insert into codes select 1, (public.create_watch_pairing())->>'code';
select matches((select code from codes where n = 1), '^[0-9]{6}$', 'the code is 6 digits');
select ok((select expires_at from public.watch_pairings limit 1) between now() + interval '9 minutes 50 seconds' and now() + interval '10 minutes 5 seconds',
          'it expires in 10 minutes');
select is((select count(*) from public.watch_pairings where code_hash = (select code from codes where n = 1)), 0::bigint, 'the code itself is not stored');
select is((select code_hash from public.watch_pairings limit 1), public.watch_code_hash((select code from codes where n = 1)), 'only its hash is stored');

select is(pg_temp.claim(pg_temp.wrong((select code from codes where n = 1))), null, 'a wrong code gives nothing');
select is((select attempts from public.watch_pairings where used_at is null), 1, 'and counts as a wrong guess');
select is(pg_temp.claim((select code from codes where n = 1)), '00000000-0000-0000-0000-0000000000a1'::uuid, 'the right code gives the user');
select is(pg_temp.claim((select code from codes where n = 1)), null, 'a code works only once');

-- A new code cancels the previous one.
insert into codes select 2, (public.create_watch_pairing())->>'code';
insert into codes select 3, (public.create_watch_pairing())->>'code';
select is(pg_temp.claim((select code from codes where n = 2)), null, 'a newer code cancels the earlier one');
select is(pg_temp.claim((select code from codes where n = 3)), '00000000-0000-0000-0000-0000000000a1'::uuid, 'the newest code works');

-- Five wrong guesses kill the open code, even for the right code afterwards.
insert into codes select 4, (public.create_watch_pairing())->>'code';
do $$ begin
  for i in 1..5 loop
    perform pg_temp.claim(pg_temp.wrong((select code from codes where n = 4)));
  end loop;
end $$;
select is(pg_temp.claim((select code from codes where n = 4)), null, 'after 5 wrong guesses even the right code is refused');

-- Expiry.
insert into codes select 5, (public.create_watch_pairing())->>'code';
update public.watch_pairings set expires_at = now() - interval '1 second' where used_at is null and cancelled_at is null;
select is(pg_temp.claim((select code from codes where n = 5)), null, 'an expired code is refused');

select is(pg_temp.claim(null), null, 'no code gives nothing');

-- Access: only the service role may claim; making a code needs a signed-in user.
select ok(not has_function_privilege('authenticated', 'public.claim_watch_pairing(text)', 'execute'), 'a signed-in user cannot call claim directly');
select ok(not has_function_privilege('anon', 'public.create_watch_pairing()', 'execute'), 'anonymous callers cannot make codes');
select ok(has_function_privilege('service_role', 'public.claim_watch_pairing(text)', 'execute'), 'the service role can claim');
select set_config('request.jwt.claims', '', true);
select throws_ok($$select public.create_watch_pairing()$$, 'P0001', 'sign in first', 'making a code needs a signed-in user');
select is((select count(*) from pg_policies where tablename = 'watch_pairings'), 1::bigint, 'row level security policy exists');

select * from finish();
rollback;
