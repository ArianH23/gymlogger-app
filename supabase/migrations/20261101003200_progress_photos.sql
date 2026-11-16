-- Progress photos: a dated front, side and back photo, to compare over time. The goal is a look, and a tape measure only
-- approximates it.
--   * the image files live in a private storage bucket, each user's under a folder named after their user id
--   * progress_photos has one row per photo: the day, the pose and where the file is
-- The photos are private: only their owner can read, add or delete them. Nothing here is public.

create table public.progress_photos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  taken_on    date not null default current_date,
  pose        text not null check (pose in ('front', 'side', 'back')),
  path        text not null,
  width       integer check (width > 0),
  height      integer check (height > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  -- the file is always inside the owner's own folder
  constraint progress_photos_path_in_own_folder check (path like user_id::text || '/%')
);
-- One photo per day and pose: a new one for the same day and pose replaces the earlier one (the app removes the old first).
create unique index progress_photos_day_pose_uq on public.progress_photos (user_id, taken_on, pose) where deleted_at is null;

create trigger progress_photos_set_updated_at before update on public.progress_photos
  for each row execute function public.set_updated_at();
alter table public.progress_photos enable row level security;
create policy progress_photos_own_rows on public.progress_photos for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

comment on table public.progress_photos is
  'Progress photos: one row per photo (day, pose, file). The image itself is in the private storage bucket progress-photos. For the owner''s eyes: compare the same pose across dates.';
comment on column public.progress_photos.id is 'Client-generated UUID (also the file name).';
comment on column public.progress_photos.user_id is 'Owner. RLS restricts every row to this user.';
comment on column public.progress_photos.taken_on is 'The day the photo was taken (local date).';
comment on column public.progress_photos.pose is 'front, side or back.';
comment on column public.progress_photos.path is 'Where the file is in the bucket progress-photos: <user id>/<photo id>.jpg.';
comment on column public.progress_photos.width is 'Image width in pixels (after the app made it smaller).';
comment on column public.progress_photos.height is 'Image height in pixels.';
comment on column public.progress_photos.created_at is 'Row creation time (server clock).';
comment on column public.progress_photos.updated_at is 'Last change (server clock, set by trigger).';
comment on column public.progress_photos.deleted_at is 'Soft delete marker. Ignore rows where this is not null.';

-- The bucket: private, JPEG only, 5 MB a file at most. (Skipped where file storage is not set up, as in the test database of CI.)
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('progress-photos', 'progress-photos', false, 5242880, array['image/jpeg'])
    on conflict (id) do nothing;
  end if;
end
$$;

-- The files: each signed-in user can read, add and delete only what is inside their own folder of this bucket.
create policy progress_photos_read_own on storage.objects for select to authenticated
  using (bucket_id = 'progress-photos' and name like (select auth.uid())::text || '/%');
create policy progress_photos_add_own on storage.objects for insert to authenticated
  with check (bucket_id = 'progress-photos' and name like (select auth.uid())::text || '/%');
create policy progress_photos_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'progress-photos' and name like (select auth.uid())::text || '/%');
