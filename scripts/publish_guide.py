"""Publishes Claude's standing instructions to the database, so the chat project and the scheduled task only
need a one-line pointer (`select claude_instructions()`) and never a pasted copy.

    python scripts/publish_guide.py --user-id <auth user uuid> --env-file importer/.env.cloud            # dry run
    python scripts/publish_guide.py --user-id <auth user uuid> --env-file importer/.env.cloud --apply    # publish

Publishes CLAUDE_GUIDE.md as 'planning-guide' and docs/goal.md as 'owner-goal'. goal.md stays out of git.
The env file holds SUPABASE_URL and SUPABASE_SERVICE_KEY (never committed).
"""
import argparse
import os
import sys
from pathlib import Path

import requests

root = Path(__file__).resolve().parent.parent


def load_env(path):
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--user-id", required=True)
    ap.add_argument("--env-file", required=True)
    ap.add_argument("--apply", action="store_true", help="write to the database (default is a dry run)")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    docs = {
        "planning-guide": (root / "CLAUDE_GUIDE.md").read_text(encoding="utf-8"),
        "owner-goal": (root / "docs" / "goal.md").read_text(encoding="utf-8").strip(),
    }
    for name, body in docs.items():
        print(f"{name}: {len(body)} characters")
    if not args.apply:
        print("\nDry run: nothing was written. Add --apply to publish.")
        return

    load_env(args.env_file)
    url, key = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1", os.environ["SUPABASE_SERVICE_KEY"]
    headers = {"apikey": key, "Content-Type": "application/json"}
    if not key.startswith("sb_"):
        headers["Authorization"] = f"Bearer {key}"
    print(f"\nPublishing to {os.environ['SUPABASE_URL']} ...")
    rows = [{"user_id": args.user_id, "name": n, "body": b} for n, b in docs.items()]
    r = requests.post(f"{url}/documents", params={"on_conflict": "user_id,name"}, json=rows,
                      headers={**headers, "Prefer": "resolution=merge-duplicates,return=minimal"})
    r.raise_for_status()
    check = requests.post(f"{url}/rpc/claude_instructions", json={"p_include_goal": True}, headers=headers)
    check.raise_for_status()
    print(f"Published. claude_instructions(true) now returns {len(check.json())} characters.")


if __name__ == "__main__":
    main()
