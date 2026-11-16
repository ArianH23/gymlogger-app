-- Tests for progress photos (the table and who may touch the files). Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'one@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'two@example.com');

insert into public.progress_photos (id, user_id, taken_on, pose, path) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '2026-01-05', 'front', '00000000-0000-0000-0000-0000000000a1/f1.jpg'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', '2026-01-05', 'back', '00000000-0000-0000-0000-0000000000a1/f2.jpg'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a2', '2026-01-05', 'front', '00000000-0000-0000-0000-0000000000a2/f3.jpg');

select throws_ok($$insert into public.progress_photos (user_id, taken_on, pose, path) values ('00000000-0000-0000-0000-0000000000a1', '2026-01-06', 'upside down', '00000000-0000-0000-0000-0000000000a1/x.jpg')$$,
                 '23514', null, 'an unknown pose is rejected');
select throws_ok($$insert into public.progress_photos (user_id, taken_on, pose, path) values ('00000000-0000-0000-0000-0000000000a1', '2026-01-06', 'front', '00000000-0000-0000-0000-0000000000a2/x.jpg')$$,
                 '23514', null, 'a file outside the owner''s own folder is rejected');
select throws_ok($$insert into public.progress_photos (user_id, taken_on, pose, path) values ('00000000-0000-0000-0000-0000000000a1', '2026-01-05', 'front', '00000000-0000-0000-0000-0000000000a1/again.jpg')$$,
                 '23505', null, 'a second photo for the same day and pose is rejected');
update public.progress_photos set deleted_at = now() where id = '00000000-0000-0000-0000-0000000000f1';
select lives_ok($$insert into public.progress_photos (user_id, taken_on, pose, path) values ('00000000-0000-0000-0000-0000000000a1', '2026-01-05', 'front', '00000000-0000-0000-0000-0000000000a1/again.jpg')$$,
                'once the earlier one is deleted, the day and pose are free again');

select is((select count(*) from pg_policies where schemaname = 'public' and tablename = 'progress_photos'), 1::bigint, 'row level security policy exists on progress_photos');
select is((select relrowsecurity from pg_class where oid = 'public.progress_photos'::regclass), true, 'row level security is on');
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'progress_photos_%'), 3::bigint,
          'the files have three policies: read, add and delete');
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'progress_photos_%' and roles <> '{authenticated}'), 0::bigint,
          'and none of them is open to people who are not signed in');
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'progress_photos_%'
            and coalesce(qual, with_check) not like '%progress-photos%'), 0::bigint, 'each one is limited to the progress-photos bucket');

-- The bucket is private (checked only where file storage is set up: CI runs the database without it).
select case when exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types')
  then is((select public from storage.buckets where id = 'progress-photos'), false, 'the bucket is private')
  else pass('file storage is not set up here: bucket not checked')
end;

-- as the first user: only their own rows, and they cannot write a row for someone else
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.progress_photos where user_id = '00000000-0000-0000-0000-0000000000a2'), 0::bigint, 'another user''s photos are not visible');
select is((select count(*) from public.progress_photos where deleted_at is null), 2::bigint, 'your own are (the back one and the new front one)');
select throws_ok($$insert into public.progress_photos (user_id, taken_on, pose, path) values ('00000000-0000-0000-0000-0000000000a2', '2026-01-07', 'front', '00000000-0000-0000-0000-0000000000a2/y.jpg')$$,
                 '42501', null, 'you cannot add a photo row for another user');
reset role;

select * from finish();
rollback;
