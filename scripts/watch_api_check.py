"""Plays the part of the future watch app using only plain HTTP calls, to prove the database contract works for a
client that is not the website. By default it only talks to the LOCAL database.

    python scripts/watch_api_check.py --email local-test@example.com --password local-test-password

The flow is exactly what a watch would do: sign in, list routines, start a workout (one call), log sets with
client-made ids (twice, to prove a retry is harmless), finish, check, then delete the test session.
"""
import argparse
import sys
import uuid
from datetime import datetime, timedelta, timezone

import requests

LOCAL_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"  # the local sandbox's public key


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://127.0.0.1:54321")
    ap.add_argument("--key", default=LOCAL_KEY, help="the publishable key (public by design)")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--allow-real", action="store_true", help="allow running against a hosted project (writes a test session, then deletes it)")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    if "supabase.co" in args.url and not args.allow_real:
        sys.exit("Refusing to touch a hosted project without --allow-real.")

    base = args.url.rstrip("/")
    ok = True

    def check(label, condition, detail=""):
        nonlocal ok
        ok &= bool(condition)
        print(f"  [{'PASS' if condition else 'FAIL'}] {label}{(' - ' + str(detail)) if detail else ''}")

    # 1. sign in with email and password; keep the refresh token for later
    r = requests.post(f"{base}/auth/v1/token", params={"grant_type": "password"}, headers={"apikey": args.key},
                      json={"email": args.email, "password": args.password})
    r.raise_for_status()
    login = r.json()
    check("sign in returns an access token and a refresh token", login.get("access_token") and login.get("refresh_token"))
    headers = {"apikey": args.key, "Authorization": f"Bearer {login['access_token']}", "Content-Type": "application/json"}

    rest = lambda path, **kw: requests.get(f"{base}/rest/v1/{path}", headers=headers, **kw)
    rpc = lambda fn, body: requests.post(f"{base}/rest/v1/rpc/{fn}", headers=headers, json=body)
    upsert = lambda table, rows: requests.post(f"{base}/rest/v1/{table}", params={"on_conflict": "id"}, json=rows,
                                               headers={**headers, "Prefer": "resolution=merge-duplicates,return=minimal"})

    # 2. the routine list, with which one is next
    routines = rest("routine_status", params={"select": "routine_id,name,is_next,last_started_at", "order": "position"}).json()
    nxt = next(x for x in routines if x["is_next"])
    check("routine list shows exactly one 'next' routine", sum(x["is_next"] for x in routines) == 1, nxt["name"])

    # 3. start a workout: ONE call returns everything the screen needs
    start = rpc("workout_start", {"p_routine_id": nxt["routine_id"]}).json()
    exercises = start["exercises"]
    check("workout_start returns the exercises with sets and last time", exercises and exercises[0]["sets"], f"{len(exercises)} exercises, plan by {start['plan_by']}")
    first = exercises[0]

    # 4. log sets with ids made on the client, then send them again (a retry after a dropped connection)
    session_id = str(uuid.uuid4())
    started = datetime.now(timezone.utc) - timedelta(hours=1)
    session = {"id": session_id, "routine_id": nxt["routine_id"], "title": "WATCH API CHECK", "started_at": started.isoformat(),
               "ended_at": (started + timedelta(minutes=45)).isoformat(), "source": "app"}
    sets = [{"id": str(uuid.uuid4()), "session_id": session_id, "exercise_id": first["exercise_id"], "set_no": s["set_no"],
             "side": None, "weight_kg": s["target_weight_kg"] or 20, "reps": s["target_reps_min"] or 10, "is_warmup": False,
             "logged_at": (started + timedelta(minutes=5 + i)).isoformat()} for i, s in enumerate(first["sets"])]
    for attempt in (1, 2):
        a = upsert("sessions", [session])
        b = upsert("sets", sets)
        check(f"upload attempt {attempt} accepted (session + {len(sets)} sets)", a.ok and b.ok, a.text[:80] + b.text[:80])
    count = len(rest("sets", params={"select": "id", "session_id": f"eq.{session_id}"}).json())
    check("sending the same sets twice created no duplicates", count == len(sets), f"{count} rows")

    # 5. finish: marks the plan used and builds the next automatic plan
    fin = rpc("finish_session", {"p_session_id": session_id})
    check("finish_session succeeds", fin.ok, fin.text[:100])
    again = rpc("finish_session", {"p_session_id": session_id})
    check("calling finish_session again is harmless", again.ok)

    # 6. what the next workout start now shows as 'last time'
    after = rpc("workout_start", {"p_routine_id": nxt["routine_id"]}).json()
    last = next(e for e in after["exercises"] if e["exercise_id"] == first["exercise_id"])["last"]
    check("the next workout_start shows this session as last time", last and last[0]["reps_result"] == sets[0]["reps"], f"set 1: {last[0] if last else None}")

    # 7. the session token can be renewed without the password (what the watch keeps on the device)
    rr = requests.post(f"{base}/auth/v1/token", params={"grant_type": "refresh_token"}, headers={"apikey": args.key},
                       json={"refresh_token": login["refresh_token"]})
    check("a refresh token gives a new access token", rr.ok and rr.json().get("access_token"))

    # 8. a client with only the public key and no sign-in sees nothing
    anon = requests.get(f"{base}/rest/v1/sets", params={"select": "id", "limit": "1"}, headers={"apikey": args.key})
    check("without signing in, the sets table is empty to the outside world", anon.ok and anon.json() == [])

    # 9. clean up the test session
    d = rpc("delete_session", {"p_session_id": session_id})
    check("test session deleted again", d.ok)

    print("\nAll checks passed: a client other than the website can run a whole workout." if ok else "\nSome checks FAILED.")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
