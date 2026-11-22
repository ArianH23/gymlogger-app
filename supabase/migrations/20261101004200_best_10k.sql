-- A fastest 10 km next to the fastest 5 km in run_bests: ten full kilometres in a row inside one run, found the same way as the 5 km
-- (a window of ten consecutive full-kilometre splits, so it is the best "kilometre 3 to 12" and not an arbitrary 10 km stretch).
-- Nothing else changes: the view below is the one from the runs migration with the 10 km added.

create or replace view public.run_bests with (security_invoker = true) as
with full_splits as (
  select s.user_id, s.run_id, s.km, s.seconds,
         sum(s.seconds) over (partition by s.run_id order by s.km rows between current row and 4 following) as five_s,
         count(*) over (partition by s.run_id order by s.km rows between current row and 4 following) as five_n,
         max(s.km) over (partition by s.run_id order by s.km rows between current row and 4 following) as five_last,
         sum(s.seconds) over (partition by s.run_id order by s.km rows between current row and 9 following) as ten_s,
         count(*) over (partition by s.run_id order by s.km rows between current row and 9 following) as ten_n,
         max(s.km) over (partition by s.run_id order by s.km rows between current row and 9 following) as ten_last
  from public.run_splits s
  join public.runs r on r.id = s.run_id and r.deleted_at is null
  where s.distance_m >= 999.5
),
candidates as (
  select user_id, 'best_1k'::text as kind, seconds as value, run_id from full_splits
  union all
  select user_id, 'best_5k', five_s, run_id from full_splits where five_n = 5 and five_last = km + 4
  union all
  select user_id, 'best_10k', ten_s, run_id from full_splits where ten_n = 10 and ten_last = km + 9
  union all
  select user_id, 'longest', -distance_m, id from public.runs where deleted_at is null
),
ranked as (
  select c.*, row_number() over (partition by c.user_id, c.kind order by c.value, c.run_id) as rn from candidates c
)
select k.user_id,
       k.kind,
       case when k.kind = 'longest' then -k.value else k.value end as value,
       case when k.kind = 'longest' then 'm' else 's' end as unit,
       k.run_id,
       (r.started_at at time zone 'Europe/Berlin')::date as day
from ranked k
join public.runs r on r.id = k.run_id
where k.rn = 1;

comment on view public.run_bests is 'Your running bests, one row each: best_1k (fastest full kilometre, seconds), best_5k and best_10k (fastest five or ten kilometres in a row inside one run, seconds), longest (metres). With the run and its day. A best only exists once a run is long enough: no best_10k until a run has ten full kilometres.';
