"""Load a Hevy CSV export into Supabase.

Usage (from the importer/ folder):
    python hevy_import.py --user-id <auth user uuid>            # dry run: prints counts only
    python hevy_import.py --user-id <auth user uuid> --apply    # writes to Supabase

Reads SUPABASE_URL and SUPABASE_SERVICE_KEY from importer/.env (git-ignored) or the environment.
The service-role key is only ever used here, never in the app.
Re-running is safe: every id is derived from the data, and every write is an upsert.
"""
import argparse
import csv
import io
import os
import re
import sys
import uuid
from collections import Counter, OrderedDict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

NAMESPACE = uuid.UUID("6f1b1c0e-5a1d-4a43-9d57-0c1a6f3a2b11")
LOCAL_TZ = ZoneInfo("Europe/Berlin")
MONTHS = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}

# Exercises with distance/duration instead of weight and reps: not imported (decided with the user).
SKIPPED_EXERCISES = {"Cycling", "Running", "Swimming", "Padel", "Volleyball", "Walking", "HIIT", "Hiking",
                     "Dead Hang"}
INCLINE_HEVY_NAME = "Incline Bench Press (Dumbbell)"
# Dumbbell Row was done with two dumbbells (pair total, 3 rows) until Feb 2026, then one dumbbell per side.
ROW_HEVY_NAME = "Dumbbell Row"
SINGLE_ARM_ROW_FROM = datetime(2026, 2, 19, tzinfo=LOCAL_TZ)
ROUTINE_TITLE = re.compile(r"^(?:Shortened\s+)?Workout\s+([ABC])\b")
EXACT_ROUTINE_TITLE = re.compile(r"^Workout ([ABC])$")


def det_id(*parts):
    """Deterministic UUID: the same input always gives the same id, so re-imports upsert, never duplicate."""
    return str(uuid.uuid5(NAMESPACE, "|".join(str(p) for p in parts)))


def parse_time(text):
    """'30 Oct 2026, 08:04' (local time) -> timezone-aware datetime."""
    m = re.fullmatch(r"\s*(\d{1,2}) (\w{3}) (\d{4}), (\d{1,2}):(\d{2})\s*", text)
    if not m:
        raise ValueError(f"unrecognised time: {text!r}")
    day, mon, year, hour, minute = m.groups()
    return datetime(int(year), MONTHS[mon], int(day), int(hour), int(minute), tzinfo=LOCAL_TZ)


def read_catalog(path):
    """exercises.csv -> {name: row dict ready for the exercises table (without ids)}."""
    def num(v, cast):
        return cast(v) if v not in ("", None) else None
    catalog = {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            catalog[r["name"]] = {
                "name": r["name"], "equipment": r["equipment"] or None,
                "unilateral": r["unilateral"] == "true", "dumbbell_pair": r["dumbbell_pair"] == "true",
                "load_type": r["load_type"], "rep_min": num(r["rep_min"], int),
                "rep_max": num(r["rep_max"], int), "increment_kg": num(r["increment_kg"], float),
            }
    return catalog


def _num(text, cast):
    text = (text or "").strip()
    return cast(text) if text else None


def exercise_name_for(row, started):
    """Hevy has one incline bench and one dumbbell row; the catalog splits them (see the constants above).
    Incline: the note says the angle (45 by default). Row: the date says which version."""
    name = row["exercise_title"]
    if name == ROW_HEVY_NAME and started >= SINGLE_ARM_ROW_FROM:
        return name + " (Single Arm)"
    if name == INCLINE_HEVY_NAME:
        return name + (" 30°" if re.search(r"\b30\b", row["exercise_notes"]) else " 45°")
    return name


def pair_sides(rows, note):
    """Left/right exercise: consecutive rows are (L, R) of one set. A note like 'RLRL' flips the order.
    Returns ([(set_no, side, row)], leftover_row_count)."""
    note = note.strip().upper()
    order = note if re.fullmatch(r"[LR]+", note) else ""
    out = []
    for j in range(len(rows) // 2):
        sides = ("L", "R")
        if order[2 * j: 2 * j + 2] in ("LR", "RL"):
            sides = tuple(order[2 * j: 2 * j + 2])
        out.append((j + 1, sides[0], rows[2 * j]))
        out.append((j + 1, sides[1], rows[2 * j + 1]))
    leftover = len(rows) % 2
    if leftover:
        out.append((len(rows) // 2 + 1, None, rows[-1]))
    return out, leftover


def build(csv_text, catalog, user_id):
    """Pure function: Hevy CSV text -> rows for every table plus a report. No database access."""
    rows = list(csv.DictReader(io.StringIO(csv_text.lstrip("﻿"))))
    catalog = dict(catalog)
    report = Counter()
    warnings = []

    # Group rows: session (title + start) -> exercise -> rows in file order.
    sessions_raw = OrderedDict()
    for r in rows:
        key = (r["title"], r["start_time"])
        sessions_raw.setdefault(key, OrderedDict()).setdefault(r["exercise_title"], []).append(r)

    ex_rows, sessions, sets, notes = {}, [], [], []
    routine_source = {}   # routine letter -> (started_at, session id, per-exercise info)

    for (title, start_text), by_exercise in sessions_raw.items():
        started = parse_time(start_text)
        end_text = next(iter(by_exercise.values()))[0]["end_time"]
        ended = parse_time(end_text) if end_text.strip() else started
        session_id = det_id("session", title, start_text)
        m = ROUTINE_TITLE.match(title)
        routine_id = det_id("routine", f"Workout {m.group(1)}") if m else None

        superset_ids = {}
        session_exercises = []   # (exercise_name, n_sets, superset_group) in order
        n_session_sets = 0
        for hevy_name, block in by_exercise.items():
            if hevy_name in SKIPPED_EXERCISES:
                report["skipped_rows"] += len(block)
                continue
            name = exercise_name_for(block[0], started)
            if name not in catalog:
                catalog[name] = {"name": name, "equipment": None, "unilateral": False, "dumbbell_pair": False,
                                 "load_type": "weighted", "rep_min": None, "rep_max": None, "increment_kg": None}
                warnings.append(f"exercise not in catalog, added with defaults: {name}")
            ex_id = det_id("exercise", name)
            ex_rows[name] = ex_id
            note = next((r["exercise_notes"].strip() for r in block if r["exercise_notes"].strip()), "")

            if catalog[name]["unilateral"]:
                numbered, leftover = pair_sides(block, note)
                if leftover:
                    report["unpaired_rows"] += 1
                    warnings.append(f"{title} {start_text}: {name} has an odd number of rows ({len(block)}); "
                                    f"last row imported with no side")
            else:
                numbered = [(i + 1, None, r) for i, r in enumerate(block)]

            n_added = 0
            for set_no, side, r in numbered:
                weight, reps = _num(r["weight_kg"], float), _num(r["reps"], int)
                if weight is None and reps is None:
                    report["empty_rows_dropped"] += 1
                    continue
                sets.append({
                    "id": det_id("set", session_id, name, set_no, side), "user_id": user_id,
                    "session_id": session_id, "exercise_id": ex_id, "set_no": set_no, "side": side,
                    "weight_kg": weight, "reps": reps, "is_warmup": r["set_type"].strip() == "warmup",
                    "logged_at": started.isoformat(),
                })
                n_added += 1
            if n_added == 0:
                continue
            n_session_sets += n_added
            if note:
                notes.append({"id": det_id("note", session_id, ex_id), "user_id": user_id,
                              "session_id": session_id, "exercise_id": ex_id, "note": note})
            sup = block[0]["superset_id"].strip()
            group = superset_ids.setdefault(sup, len(superset_ids) + 1) if sup else None
            n_working_sets = len({s["set_no"] for s in sets[-n_added:]})
            session_exercises.append((name, n_working_sets, group))

        group_sizes = Counter(g for _, _, g in session_exercises if g)
        session_exercises = [(n, c, g if group_sizes[g] > 1 else None) for n, c, g in session_exercises]

        if n_session_sets == 0:
            report["sessions_skipped_no_sets"] += 1
            continue
        sessions.append({
            "id": session_id, "user_id": user_id, "routine_id": routine_id, "title": title,
            "started_at": started.isoformat(), "ended_at": ended.isoformat(),
            "notes": next(iter(by_exercise.values()))[0]["description"].strip() or None,
            "source": "hevy_import",
        })
        report["sessions_linked" if routine_id else "sessions_unlinked"] += 1
        em = EXACT_ROUTINE_TITLE.match(title)
        if em and (em.group(1) not in routine_source or started > routine_source[em.group(1)][0]):
            routine_source[em.group(1)] = (started, session_exercises)

    routines, routine_exercises = [], []
    for position, letter in enumerate(sorted(routine_source)):
        name = f"Workout {letter}"
        routine_id = det_id("routine", name)
        routines.append({"id": routine_id, "user_id": user_id, "name": name, "position": position})
        for pos, (ex_name, n_sets, group) in enumerate(routine_source[letter][1]):
            ex_id = det_id("exercise", ex_name)
            routine_exercises.append({
                "id": det_id("routine_exercise", routine_id, ex_id), "user_id": user_id,
                "routine_id": routine_id, "exercise_id": ex_id, "position": pos + 1,
                "target_sets": n_sets, "superset_group": group, "priority": 1,
            })

    exercises = [{"id": det_id("exercise", n), "user_id": user_id, **catalog[n]} for n in sorted(catalog)]
    for s in sets:
        report["sets_left_right"] += s["side"] is not None
    report["sessions"], report["sets"] = len(sessions), len(sets)
    return {"exercises": exercises, "routines": routines, "routine_exercises": routine_exercises,
            "sessions": sessions, "sets": sets, "session_exercise_notes": notes,
            "report": report, "warnings": warnings}


# ----------------------------------------------------------------------------- uploading
class RestClient:
    """Minimal PostgREST client (service-role key)."""

    def __init__(self, url, key):
        import requests
        self.base, self.http = url.rstrip("/") + "/rest/v1", requests.Session()
        self.http.headers.update({"apikey": key, "Authorization": f"Bearer {key}"})

    def upsert(self, table, rows, on_conflict, ignore_duplicates=False):
        prefer = ("resolution=ignore-duplicates" if ignore_duplicates else "resolution=merge-duplicates")
        for i in range(0, len(rows), 500):
            r = self.http.post(f"{self.base}/{table}", params={"on_conflict": on_conflict},
                               json=rows[i:i + 500], headers={"Prefer": prefer + ",return=minimal"})
            if not r.ok:
                raise RuntimeError(f"{table}: {r.status_code} {r.text}")

    def select(self, table, columns, **filters):
        r = self.http.get(f"{self.base}/{table}", params={"select": columns, **{k: f"eq.{v}" for k, v in filters.items()}})
        r.raise_for_status()
        return r.json()


def upload(result, client, user_id):
    """Write everything with upserts. Exercises already in the database (same name) are kept as they are,
    so edits you made to increments or rep ranges survive a re-import."""
    client.upsert("exercises", result["exercises"], "user_id,name", ignore_duplicates=True)
    db_ids = {e["name"]: e["id"] for e in client.select("exercises", "id,name", user_id=user_id)}
    remap = {e["id"]: db_ids[e["name"]] for e in result["exercises"]}
    for table in ("routine_exercises", "sets", "session_exercise_notes"):
        for row in result[table]:
            row["exercise_id"] = remap[row["exercise_id"]]
    client.upsert("routines", result["routines"], "id")
    client.upsert("sessions", result["sessions"], "id")
    client.upsert("routine_exercises", result["routine_exercises"], "routine_id,exercise_id")
    client.upsert("sets", result["sets"], "id")
    client.upsert("session_exercise_notes", result["session_exercise_notes"], "id")


def load_env(path):
    if Path(path).exists():
        for line in Path(path).read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def print_report(result):
    rep = result["report"]
    print(f"sessions: {rep['sessions']}  (linked to Workout A/B/C: {rep['sessions_linked']}, "
          f"no routine: {rep['sessions_unlinked']})")
    print(f"sets: {rep['sets']}  (left/right rows: {rep['sets_left_right']})")
    print(f"exercises in catalog: {len(result['exercises'])}   routines: {len(result['routines'])}   "
          f"routine_exercises: {len(result['routine_exercises'])}   exercise notes: {len(result['session_exercise_notes'])}")
    print(f"skipped cardio/sport rows: {rep['skipped_rows']}   sessions with nothing left: {rep['sessions_skipped_no_sets']}"
          f"   rows with no weight and no reps: {rep['empty_rows_dropped']}")
    for w in result["warnings"]:
        print("WARNING:", w)


def main():
    here = Path(__file__).parent
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--csv", default=here.parent / "data" / "workout_data.csv")
    ap.add_argument("--catalog", default=here / "exercises.csv")
    ap.add_argument("--user-id", default="00000000-0000-0000-0000-000000000000")
    ap.add_argument("--apply", action="store_true", help="write to Supabase (default is a dry run)")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    result = build(Path(args.csv).read_text(encoding="utf-8-sig"), read_catalog(args.catalog), args.user_id)
    print_report(result)
    if not args.apply:
        print("\nDry run: nothing was written. Add --apply to import.")
        return
    load_env(here / ".env")
    if args.user_id.startswith("00000000"):
        sys.exit("--apply needs your real --user-id (the id of your Supabase auth user)")
    upload(result, RestClient(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"]), args.user_id)
    print("\nImport finished.")


if __name__ == "__main__":
    main()
