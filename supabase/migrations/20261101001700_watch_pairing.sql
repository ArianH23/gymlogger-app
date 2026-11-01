-- Pairing the watch without typing a password: the signed-in phone asks for a short code (create_watch_pairing),
-- the watch sends that code to the 'watch-pair' Edge Function, which calls claim_watch_pairing and, if the code is
-- valid, signs the watch in as the same user. All the checking lives here; the Edge Function only turns "this
-- user is allowed" into a login.
--
-- Rules: a code is 6 digits, works once, and expires after 10 minutes. Only its hash is stored. A new code cancels
-- the previous one. Every wrong guess counts against every open code, and a code dies after 5 wrong guesses, so
-- guessing a code is not practical (the price: guessing wrong 5 times also cancels your own code; make a new one).

create table public.watch_pairings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code_hash     text not null,
  attempts      integer not null default 0,
  expires_at    timestamptz not null default now() + interval '10 minutes',
  used_at       timestamptz,
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now()
);
-- At most one open pairing per code, so a claim can never match two people.
create unique index watch_pairings_open_code_uq on public.watch_pairings (code_hash) where used_at is null and cancelled_at is null;

alter table public.watch_pairings enable row level security;
create policy watch_pairings_own_rows on public.watch_pairings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

comment on table public.watch_pairings is
  'Short-lived codes for signing a watch in without typing a password. Only the hash of the code is stored. See create_watch_pairing and claim_watch_pairing.';
comment on column public.watch_pairings.id is 'Row id.';
comment on column public.watch_pairings.user_id is 'Owner. RLS restricts every row to this user.';
comment on column public.watch_pairings.code_hash is 'SHA-256 (hex) of the 6-digit code. The code itself is shown once on the phone and never stored.';
comment on column public.watch_pairings.attempts is 'Wrong guesses made while this code was open. The code stops working at 5.';
comment on column public.watch_pairings.expires_at is 'The code stops working at this time (10 minutes after it was made).';
comment on column public.watch_pairings.used_at is 'Set when a watch used the code. A code works once.';
comment on column public.watch_pairings.cancelled_at is 'Set when a newer code replaced this one.';
comment on column public.watch_pairings.created_at is 'Row creation time (server clock).';

create function public.watch_code_hash(p_code text) returns text
language sql
immutable
set search_path = ''
as $$ select encode(extensions.digest(p_code, 'sha256'), 'hex') $$;
comment on function public.watch_code_hash(text) is 'SHA-256 (hex) of a pairing code.';
revoke execute on function public.watch_code_hash(text) from public, anon, authenticated;

-- Phone: make a code for the signed-in user. Any earlier open code is cancelled.
create function public.create_watch_pairing() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_code    text;
  v_expires timestamptz;
  v_try     integer := 0;
begin
  if v_user is null then
    raise exception 'sign in first';
  end if;

  update public.watch_pairings set cancelled_at = now()
   where user_id = v_user and used_at is null and cancelled_at is null;

  loop
    v_try := v_try + 1;
    v_code := lpad((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint % 1000000)::text, 6, '0');
    begin
      insert into public.watch_pairings (user_id, code_hash)
      values (v_user, public.watch_code_hash(v_code))
      returning expires_at into v_expires;
      exit;
    exception when unique_violation then
      if v_try >= 5 then raise; end if; -- another open code has the same hash: draw again
    end;
  end loop;

  return jsonb_build_object('code', v_code, 'expires_at', v_expires);
end;
$$;
comment on function public.create_watch_pairing() is
  'Phone: makes a 6-digit pairing code for the signed-in user (valid 10 minutes, works once) and cancels any earlier open code. Returns {code, expires_at}. Show the code on the phone and type it on the watch.';
revoke execute on function public.create_watch_pairing() from public, anon;
grant  execute on function public.create_watch_pairing() to authenticated;

-- Edge Function only (service role): check a code sent by a watch. Returns the user id if it is valid and marks
-- it used; returns null otherwise and counts the wrong guess against every open code.
create function public.claim_watch_pairing(p_code text) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  update public.watch_pairings
     set used_at = now()
   where code_hash = public.watch_code_hash(coalesce(p_code, ''))
     and used_at is null and cancelled_at is null
     and expires_at > now() and attempts < 5
  returning user_id into v_user;

  if v_user is null then
    update public.watch_pairings set attempts = attempts + 1
     where used_at is null and cancelled_at is null and expires_at > now();
  end if;
  return v_user;
end;
$$;
comment on function public.claim_watch_pairing(text) is
  'For the watch-pair Edge Function only (service role): returns the user id if the code is open, unexpired and under 5 wrong guesses, and marks it used; otherwise returns null and counts a wrong guess against every open code.';
revoke execute on function public.claim_watch_pairing(text) from public, anon, authenticated;
grant  execute on function public.claim_watch_pairing(text) to service_role;
