-- Row Level Security: a logged-in user can read and write only rows whose user_id is their own.
-- The anon role gets no policy, so it sees nothing. The service role (local importer) bypasses RLS.
-- (select auth.uid()) is evaluated once per query instead of once per row.

do $$
declare t text;
begin
  foreach t in array array['exercises', 'routines', 'routine_exercises', 'sessions', 'sets',
                           'session_exercise_notes', 'planned_sessions', 'planned_sets']
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))',
      t || '_own_rows', t);
  end loop;
end;
$$;
