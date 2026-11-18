import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import hevy_import as h  # noqa: E402

USER = "11111111-1111-1111-1111-111111111111"
HEADER = ("title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,"
          "set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe\n")


def ex(name, unilateral=False, pair=False, load="weighted"):
    return {"name": name, "equipment": None, "unilateral": unilateral, "dumbbell_pair": pair,
            "load_type": load, "rep_min": 6, "rep_max": 10, "increment_kg": None}


CATALOG = {n: ex(n) for n in ["Bench Press (Dumbbell)", "Squat (Barbell)", "Incline Bench Press (Dumbbell) 30°",
                              "Incline Bench Press (Dumbbell) 45°"]}
CATALOG["Single Arm Lateral Raise (Cable)"] = ex("Single Arm Lateral Raise (Cable)", unilateral=True)


def csv_rows(*rows):
    """rows: (title, start, exercise, weight, reps, note, superset) tuples -> CSV text. set_index is per block."""
    out, counters = [HEADER], {}
    for title, start, exercise, weight, reps, *rest in rows:
        note = rest[0] if rest else ""
        sup = rest[1] if len(rest) > 1 else ""
        i = counters.setdefault((title, start, exercise), 0)
        counters[(title, start, exercise)] += 1
        out.append(f'"{title}","{start}","{start[:-5]}09:30","","{exercise}",{sup},"{note}",{i},normal,{weight},{reps},,,\n')
    return "".join(out)


def build(text, catalog=CATALOG):
    return h.build(text, copy.deepcopy(catalog), USER)


def test_local_time_winter_and_summer():
    assert h.parse_time("30 Oct 2026, 08:04").astimezone(h.ZoneInfo("UTC")).hour == 7    # CET, +1
    assert h.parse_time("30 Jun 2026, 08:04").astimezone(h.ZoneInfo("UTC")).hour == 6    # CEST, +2


def test_left_right_pairing_default_order():
    text = csv_rows(*[("Workout B", "30 Oct 2026, 08:04", "Single Arm Lateral Raise (Cable)", 7.5, r)
                      for r in (11, 10, 9, 8)])
    sets = sorted(build(text)["sets"], key=lambda s: (s["set_no"], s["side"]))
    assert [(s["set_no"], s["side"], s["reps"]) for s in sets] == [(1, "L", 11), (1, "R", 10), (2, "L", 9), (2, "R", 8)]


def test_note_can_flip_which_row_is_left():
    text = csv_rows(*[("Workout B", "30 Oct 2026, 08:04", "Single Arm Lateral Raise (Cable)", 7.5, r, "RLRL")
                      for r in (11, 10, 9, 8)])
    sets = {(s["set_no"], s["side"]): s["reps"] for s in build(text)["sets"]}
    assert sets == {(1, "R"): 11, (1, "L"): 10, (2, "R"): 9, (2, "L"): 8}


def test_odd_left_right_block_is_flagged_not_dropped():
    text = csv_rows(*[("Workout B", "30 Oct 2026, 08:04", "Single Arm Lateral Raise (Cable)", 7.5, r)
                      for r in (11, 10, 9)])
    result = build(text)
    assert len(result["sets"]) == 3
    assert [s["side"] for s in result["sets"]] == ["L", "R", None]
    assert result["report"]["unpaired_rows"] == 1 and result["warnings"]


def test_normal_exercise_gets_sequential_set_numbers_and_no_side():
    text = csv_rows(*[("Workout B", "30 Oct 2026, 08:04", "Bench Press (Dumbbell)", 44, r) for r in (6, 6, 4)])
    sets = build(text)["sets"]
    assert [(s["set_no"], s["side"], s["weight_kg"], s["reps"]) for s in sets] == [(1, None, 44, 6), (2, None, 44, 6), (3, None, 44, 4)]


def test_incline_split_by_angle_note_with_45_default():
    text = csv_rows(
        ("Workout A", "01 Oct 2026, 08:00", "Incline Bench Press (Dumbbell)", 36, 8),
        ("Workout A", "08 Oct 2026, 08:00", "Incline Bench Press (Dumbbell)", 36, 8, "45°, back to 36 kg"),
        ("Workout A", "15 Oct 2026, 08:00", "Incline Bench Press (Dumbbell)", 32, 8, "30"),
    )
    by_session = {s["session_id"]: s["exercise_id"] for s in build(text)["sets"]}
    ids = [by_session[h.det_id("session", "Workout A", d)] for d in
           ("01 Oct 2026, 08:00", "08 Oct 2026, 08:00", "15 Oct 2026, 08:00")]
    assert ids == [h.det_id("exercise", "Incline Bench Press (Dumbbell) 45°")] * 2 + [
        h.det_id("exercise", "Incline Bench Press (Dumbbell) 30°")]


def test_cardio_is_skipped_and_cardio_only_sessions_are_not_created():
    text = csv_rows(
        ("Cycling ECI", "01 Oct 2026, 08:00", "Cycling", "", ""),
        ("Morning workout", "02 Oct 2026, 08:00", "Cycling", "", ""),
        ("Morning workout", "02 Oct 2026, 08:00", "Squat (Barbell)", 50, 10),
    )
    result = build(text)
    assert [s["title"] for s in result["sessions"]] == ["Morning workout"]
    assert result["report"]["skipped_rows"] == 2 and result["report"]["sessions_skipped_no_sets"] == 1


@pytest.mark.parametrize("title,letter", [
    ("Workout A", "A"), ("Workout B Midtown", "B"), ("Workout A simplified", "A"), ("Shortened Workout B", "B"),
    ("Workout A (Gym version)", "A"), ("Workout B Downtown", "B"), ("Morning workout ☀️", None),
    ("Random workout with a friend", None)])
def test_routine_linking(title, letter):
    session = build(csv_rows((title, "01 Oct 2026, 08:00", "Squat (Barbell)", 50, 10)))["sessions"][0]
    assert session["routine_id"] == (h.det_id("routine", f"Workout {letter}") if letter else None)


def test_routine_is_built_from_most_recent_exact_titled_session():
    text = csv_rows(
        ("Workout A", "01 Oct 2026, 08:00", "Squat (Barbell)", 50, 10),
        ("Workout A", "20 Oct 2026, 08:00", "Bench Press (Dumbbell)", 44, 6, "", "7"),
        ("Workout A", "20 Oct 2026, 08:00", "Bench Press (Dumbbell)", 44, 6, "", "7"),
        ("Workout A", "20 Oct 2026, 08:00", "Squat (Barbell)", 60, 8, "", "7"),
        ("Workout A Midtown", "28 Oct 2026, 08:00", "Squat (Barbell)", 60, 8),     # variant: not a routine source
    )
    result = build(text)
    assert [r["name"] for r in result["routines"]] == ["Workout A"]
    rx = result["routine_exercises"]
    assert [(r["exercise_id"], r["position"], r["target_sets"], r["superset_group"]) for r in rx] == [
        (h.det_id("exercise", "Bench Press (Dumbbell)"), 1, 2, 1), (h.det_id("exercise", "Squat (Barbell)"), 2, 1, 1)]


def test_exercise_notes_are_kept_and_empty_rows_dropped():
    text = csv_rows(
        ("Workout A", "01 Oct 2026, 08:00", "Squat (Barbell)", 50, 10, "Back to 108"),
        ("Workout A", "01 Oct 2026, 08:00", "Squat (Barbell)", "", ""),
    )
    result = build(text)
    assert [n["note"] for n in result["session_exercise_notes"]] == ["Back to 108"]
    assert len(result["sets"]) == 1 and result["report"]["empty_rows_dropped"] == 1


def test_unknown_exercise_is_added_with_a_warning():
    result = build(csv_rows(("Workout A", "01 Oct 2026, 08:00", "Brand New Lift", 10, 10)))
    assert any("Brand New Lift" in w for w in result["warnings"])
    assert "Brand New Lift" in {e["name"] for e in result["exercises"]}


def test_ids_are_deterministic_and_depend_on_title_and_start():
    text = csv_rows(("Workout A", "01 Oct 2026, 08:00", "Squat (Barbell)", 50, 10))
    assert build(text) == build(text)
    other = csv_rows(("Workout A", "01 Oct 2026, 08:01", "Squat (Barbell)", 50, 10))
    assert build(text)["sessions"][0]["id"] != build(other)["sessions"][0]["id"]


class FakeClient:
    """In-memory stand-in for Supabase that honours upsert semantics."""

    def __init__(self, existing_exercises=()):
        self.tables = {"exercises": list(existing_exercises)}

    def upsert(self, table, rows, on_conflict, ignore_duplicates=False):
        keys = on_conflict.split(",")
        store = self.tables.setdefault(table, [])
        for row in rows:
            match = next((r for r in store if all(r[k] == row[k] for k in keys)), None)
            if match is None:
                store.append(dict(row))
            elif not ignore_duplicates:
                match.update(row)

    def select(self, table, columns, **filters):
        rows = [dict(r) for r in self.tables[table]]
        if filters.get("deleted_at") == "is.null":
            rows = [r for r in rows if r.get("deleted_at") is None]
        return rows


SAMPLE = csv_rows(
    ("Workout A", "01 Oct 2026, 08:00", "Squat (Barbell)", 50, 10, "note"),
    ("Workout A", "01 Oct 2026, 08:00", "Single Arm Lateral Raise (Cable)", 7.5, 12),
    ("Workout A", "01 Oct 2026, 08:00", "Single Arm Lateral Raise (Cable)", 7.5, 11),
    ("Morning workout", "02 Oct 2026, 08:00", "Bench Press (Dumbbell)", 40, 8),
)


def test_import_twice_creates_no_duplicates():
    client = FakeClient()
    for _ in range(2):
        h.upload(build(SAMPLE), client, USER)
        counts = {t: len(rows) for t, rows in client.tables.items()}
    assert counts == {"exercises": 5, "routines": 1, "sessions": 2, "routine_exercises": 2, "sets": 4,
                      "session_exercise_notes": 1}


def test_reimport_keeps_edits_made_to_an_existing_exercise_and_uses_its_id():
    mine = {"id": "99999999-9999-9999-9999-999999999999", "user_id": USER, **ex("Squat (Barbell)")}
    mine["increment_kg"] = 2.5
    client = FakeClient([mine])
    h.upload(build(SAMPLE), client, USER)
    squat = [e for e in client.tables["exercises"] if e["name"] == "Squat (Barbell)"]
    assert len(squat) == 1 and squat[0]["increment_kg"] == 2.5
    squat_sets = [s for s in client.tables["sets"] if s["reps"] == 10]
    assert [s["exercise_id"] for s in squat_sets] == [mine["id"]]


def test_a_deleted_exercise_with_the_same_name_is_not_reused():
    # the name is unique only among exercises that are not deleted, so a deleted one and a live one can share it
    gone = {"id": "88888888-8888-8888-8888-888888888888", "user_id": USER, "deleted_at": "2026-01-01T00:00:00Z", **ex("Squat (Barbell)")}
    live = {"id": "99999999-9999-9999-9999-999999999999", "user_id": USER, **ex("Squat (Barbell)")}
    client = FakeClient([gone, live])
    h.upload(build(SAMPLE), client, USER)
    squat_sets = [s for s in client.tables["sets"] if s["reps"] == 10]
    assert [s["exercise_id"] for s in squat_sets] == [live["id"]]
    assert len([e for e in client.tables["exercises"] if e["name"] == "Squat (Barbell)"]) == 2  # nothing was added


def test_an_exercise_deleted_after_an_import_comes_back_with_its_own_id():
    built = build(SAMPLE)
    squat = next(e for e in built["exercises"] if e["name"] == "Squat (Barbell)")
    client = FakeClient([{**squat, "deleted_at": "2026-01-01T00:00:00Z"}])
    h.upload(build(SAMPLE), client, USER)
    rows = [e for e in client.tables["exercises"] if e["name"] == "Squat (Barbell)"]
    assert len(rows) == 1 and rows[0]["deleted_at"] is None


def test_dumbbell_row_is_two_dumbbells_before_feb_2026_and_single_arm_after():
    catalog = dict(CATALOG)
    catalog["Dumbbell Row"] = ex("Dumbbell Row", pair=True)
    catalog["Dumbbell Row (Single Arm)"] = ex("Dumbbell Row (Single Arm)", unilateral=True)
    text = csv_rows(
        *[("Workout C", "09 Feb 2026, 08:00", "Dumbbell Row", 52, 12) for _ in range(3)],
        *[("Workout C", "19 Feb 2026, 08:00", "Dumbbell Row", 26, 12) for _ in range(6)],
    )
    sets = build(text, catalog)["sets"]
    old = [s for s in sets if s["exercise_id"] == h.det_id("exercise", "Dumbbell Row")]
    new = [s for s in sets if s["exercise_id"] == h.det_id("exercise", "Dumbbell Row (Single Arm)")]
    assert len(old) == 3 and all(s["side"] is None for s in old)
    assert len(new) == 6 and {s["side"] for s in new} == {"L", "R"}


def test_superset_group_with_a_single_exercise_is_dropped():
    text = csv_rows(
        ("Workout A", "01 Oct 2026, 08:00", "Squat (Barbell)", 50, 10, "", "5"),           # partner was cardio, skipped
        ("Workout A", "01 Oct 2026, 08:00", "Cycling", "", "", "", "5"),
        ("Workout A", "01 Oct 2026, 08:00", "Bench Press (Dumbbell)", 40, 8, "", "6"),
        ("Workout A", "01 Oct 2026, 08:00", "Incline Bench Press (Dumbbell)", 30, 8, "", "6"),
    )
    groups = {r["exercise_id"]: r["superset_group"] for r in build(text)["routine_exercises"]}
    assert groups[h.det_id("exercise", "Squat (Barbell)")] is None
    assert groups[h.det_id("exercise", "Bench Press (Dumbbell)")] == groups[h.det_id("exercise", "Incline Bench Press (Dumbbell) 45°")] == 2


def test_logged_at_follows_file_order_so_exercise_order_is_kept():
    text = csv_rows(
        ("Workout A", "01 Oct 2026, 08:00", "Squat (Barbell)", 50, 10),
        ("Workout A", "01 Oct 2026, 08:00", "Squat (Barbell)", 50, 9),
        ("Workout A", "01 Oct 2026, 08:00", "Bench Press (Dumbbell)", 40, 8),
    )
    sets = build(text)["sets"]
    times = [s["logged_at"] for s in sets]
    assert times == sorted(times) and len(set(times)) == 3
    assert [s["exercise_id"] for s in sorted(sets, key=lambda s: s["logged_at"])][0] == h.det_id("exercise", "Squat (Barbell)")
