"""Plays phone and watch to prove the pairing flow end to end: the phone makes a code, the watch trades it for a login
at the watch-pair Edge Function, and that login works like any other. By default it only talks to the LOCAL database.

    npx supabase functions serve --no-verify-jwt        (in another terminal, once)
    python scripts/watch_pairing_check.py --email local-test@example.com --password local-test-pass-1
"""
import argparse
import sys

import requests

LOCAL_KEY = "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"  # the local sandbox's public key


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://127.0.0.1:54321")
    ap.add_argument("--key", default=LOCAL_KEY, help="the publishable key (public by design)")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--allow-real", action="store_true", help="allow a hosted project (makes pairing codes only; nothing else is written)")
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

    # Phone: signed in with the password.
    r = requests.post(f"{base}/auth/v1/token", params={"grant_type": "password"}, headers={"apikey": args.key},
                      json={"email": args.email, "password": args.password})
    r.raise_for_status()
    phone = {"apikey": args.key, "Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"}
    new_code = lambda: requests.post(f"{base}/rest/v1/rpc/create_watch_pairing", headers=phone, json={}).json()["code"]

    # Watch: no login at all, only the publishable key and a code.
    watch_headers = {"apikey": args.key, "Content-Type": "application/json"}
    pair = lambda code: requests.post(f"{base}/functions/v1/watch-pair", headers=watch_headers, json={"code": code})
    wrong = lambda code: f"{(int(code) + 1) % 1000000:06d}"

    code = new_code()
    check("the phone gets a 6-digit code", len(code) == 6 and code.isdigit(), code)

    r = pair(code)
    session = r.json() if r.ok else {}
    check("the watch trades the code for a login", r.status_code == 200 and session.get("access_token") and session.get("refresh_token"), r.status_code)

    watch_auth = {"apikey": args.key, "Authorization": f"Bearer {session.get('access_token', '')}"}
    rows = requests.get(f"{base}/rest/v1/routine_status", params={"select": "name,is_next"}, headers=watch_auth)
    check("that login reads the same routines as the phone", rows.ok and len(rows.json()) > 0, f"{len(rows.json()) if rows.ok else rows.status_code} routines")
    check("it is the same user", session.get("user", {}).get("email") == args.email, session.get("user", {}).get("email"))

    refreshed = requests.post(f"{base}/auth/v1/token", params={"grant_type": "refresh_token"}, headers={"apikey": args.key},
                              json={"refresh_token": session.get("refresh_token", "")})
    check("the watch can renew its login with the refresh token", refreshed.ok and refreshed.json().get("access_token"), refreshed.status_code)

    check("the same code cannot be used twice", pair(code).status_code == 401)

    code = new_code()
    check("one wrong guess is refused", pair(wrong(code)).status_code == 401)
    check("and the right code still works afterwards", pair(code).status_code == 200)

    code = new_code()
    for _ in range(5):
        pair(wrong(code))
    check("after 5 wrong guesses even the right code is refused", pair(code).status_code == 401)

    check("a malformed code is a 400", pair("12ab56").status_code == 400)
    check("a missing body is a 400", requests.post(f"{base}/functions/v1/watch-pair", headers=watch_headers, data="nope").status_code == 400)
    check("GET is not allowed", requests.get(f"{base}/functions/v1/watch-pair", headers=watch_headers).status_code == 405)

    print("\nALL PASSED" if ok else "\nSOMETHING FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
