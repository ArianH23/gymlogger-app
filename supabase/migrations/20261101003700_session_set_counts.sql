-- How many sets each finished session had, counted the way the app counts them everywhere else: working sets only (no
-- warm-ups), a left/right pair as one set. The History list used to count rows, so a session with left/right exercises showed
-- more sets than its own page (16 against 14).
create view public.session_set_counts with (security_invoker = true) as
select r.session_id,
       count(*)::integer as working_sets
from public.exercise_set_results r
group by r.session_id;

comment on view public.session_set_counts is 'Per finished session: its working sets (no warm-ups, a left/right pair counted once). Sessions with no sets have no row.';
comment on column public.session_set_counts.session_id is 'The session.';
comment on column public.session_set_counts.working_sets is 'Working sets in the session.';
