"""Draws docs/schema.svg: the tables, views and functions of the database. Run:  python scripts/draw_schema.py
Then render a PNG with a headless browser (see README) or just open the SVG."""
from pathlib import Path
from xml.sax.saxutils import escape as esc

W, LH, HEAD = 340, 19, 34
CAT, LOG, PLAN, BODY, DOC, WATCH = (
    ("#1f4e79", "#dbe9f7"), ("#1e6b3a", "#dcf1e3"), ("#9a4f00", "#fde9d0"), ("#6b3fa0", "#ece1f7"), ("#555555", "#e8e8e8"),
    ("#0b6e6e", "#d9f1f1"))
STAMPS = "user_id · timestamps · deleted_at"

# name: (x, y, palette, columns, footer)
T = {
    "routine_exercises": (30, 60, CAT, ["id  PK", "routine_id  → routines", "exercise_id  → exercises", "position", "target_sets",
                                         "superset_group", "priority  (1 = never skip)"], STAMPS),
    "exercises": (30, 330, CAT, ["id  PK", "name  (unique)", "equipment", "unilateral  (L/R rows)", "dumbbell_pair  (weight = pair total)",
                                 "load_type  weighted/bodyweight/assisted", "rep_min", "rep_max", "increment_kg  (can be empty)"], STAMPS),
    "session_exercise_notes": (30, 640, LOG, ["id  PK", "session_id  → sessions", "exercise_id  → exercises", "note"], STAMPS),
    "routines": (440, 60, CAT, ["id  PK", "name  (Workout A/B/C...)", "position", "plan_requested_at  (last Claude request)"], STAMPS),
    "sessions": (440, 250, LOG, ["id  PK", "routine_id  → routines  (can be empty)", "title", "started_at", "ended_at", "notes",
                                  "source  app / hevy_import", "feeling  1-5 (optional)", "live  (the open workout's layout)",
                                  "live_updated_at"], STAMPS),
    "sets": (440, 540, LOG, ["id  PK", "session_id  → sessions", "exercise_id  → exercises", "set_no", "side  L / R / empty",
                              "weight_kg  (pair total / assistance)", "reps", "is_warmup", "logged_at"], STAMPS),
    "planned_sessions": (850, 200, PLAN, ["id  PK", "routine_id  → routines", "created_by  rules / claude", "status  pending/used/superseded",
                                           "notes", "used_by_session_id  → sessions"], "user_id · timestamps"),
    "planned_sets": (850, 520, PLAN, ["id  PK", "planned_session_id  → planned_sessions", "exercise_id  → exercises", "exercise_position",
                                       "set_no", "target_weight_kg", "target_reps_min", "target_reps_max", "note"], "user_id · timestamps"),
    "body_checkins": (1260, 60, BODY, ["id  PK", "checked_on  (one per day)", "bodyweight_kg · body_fat_pct", "waist_cm + 14 tape measurements:",
                                        "  neck, shoulders, chest, abdomen, hips,", "  wrist, ankle, left/right bicep, forearm,", "  thigh, calf",
                                        "sleep_hours · resting_hr_bpm", "calories_kcal · protein_g · steps  (daily averages)",
                                        "notes"], STAMPS),
    "documents": (1260, 330, DOC, ["id  PK", "name  planning-guide / owner-goal", "body  (the text Claude reads)"], "user_id · timestamps"),
    "body_profile": (1260, 700, BODY, ["user_id  PK  (one row per user)", "height_cm  (for the ratios)"], "created_at · updated_at"),
    "body_targets": (1260, 820, BODY, ["user_id + metric  PK", "target_value  (cm; your own target for one", "  of the 14 measurements)"], "updated_at"),
    "exercise_muscles": (30, 800, CAT, ["exercise_id  → exercises  +  muscle  (PK)", "role  primary (1 per set) / secondary (0.5)"], "user_id"),
    "watch_pairings": (1260, 480, WATCH, ["id  PK", "code_hash  (the code is never stored)", "attempts  (dies at 5 wrong)", "expires_at  (10 minutes)",
                                           "used_at", "cancelled_at"], "user_id · created_at"),
}

VIEWS = [
    ("last_performance", "what you did last time, per exercise"),
    ("current_plan", "the plan to show per routine (Claude beats rules)"),
    ("routine_status", "when each routine was last done, and which is next"),
    ("exercise_set_results", "one row per working set, left/right merged"),
    ("exercise_session_stats", "per exercise and session: best weight, 1RM, volume"),
    ("exercise_best_reps_by_weight", "best reps at every weight used"),
    ("exercise_summary", "per exercise: sessions, last done, best"),
    ("session_plan_performance", "sets that met the plan you followed"),
    ("weekly_overview", "per week: training next to your check-ins"),
    ("session_scores", "per session: % of planned sets met, its tier, your 1-5 feeling"),
    ("body_metrics", "every body number as a row, plus shoulders/waist, waist/height, lean mass, tape body fat"),
    ("body_latest", "per body metric: latest value against about 4 weeks earlier"),
    ("body_target_values", "the target for each of the 14 measurements (yours, or the model scaled to your height)"),
    ("body_shape", "each measured part against its target: gap and closeness"),
    ("routine_plan_status", "per routine: is Claude planning it now, or did it not answer"),
    ("hevy_export_rows", "one row per working set, in the Strong CSV format Hevy imports"),
    ("session_muscles", "per session and muscle: weighted sets and share of the session"),
    ("weekly_muscles", "the same muscle sets, summed per week"),
    ("monthly_muscles", "the same muscle sets, summed per month"),
]
FUNCS = [
    ("generate_plan(routine)", "progression rules → the automatic plan"),
    ("submit_plan(routine, json, notes)", "Claude writes a plan, validated"),
    ("workout_plan(routine)", "plan shown at start, kept in step with routine edits"),
    ("finish_session(session)", "end a workout, mark plans used, plan, ask Claude"),
    ("request_routine_plan(routine)", "the Plan with Claude button: asks the scheduled task"),
    ("edit_session(…) / delete_session(…)", "correct or remove a past session, all-or-nothing"),
    ("exercise_history(exercise, n)", "the last n sessions of an exercise"),
    ("claude_instructions(with_goal)", "the guide (and goal) Claude reads"),
    ("claude_automation_status()", "checks the automation secrets"),
    ("workout_start(routine)", "everything needed to start a workout, in one call"),
    ("sync_workout(json) / open_workout()", "share the workout in progress between phone and watch"),
    ("session_tier(pct)", "great / good / average / weak / poor"),
    ("shape_defaults()", "the model: each measurement as a share of height, grow or shrink"),
    ("muscle_defs() / exercise_muscle_defaults()", "the 16 muscles, and the standard muscle tags by exercise name"),
    ("export_hevy_csv(only_app)", "your workouts as a CSV file Hevy can import"),
    ("create_watch_pairing() / claim_watch_pairing(code)", "sign the watch in with a 6-digit code"),
    ("round_to_step · deload_weight · set_updated_at · workout_json · watch_code_hash · tag_new_exercise · hevy_exercise_name · csv_field", "small helpers"),
]

box = {}


def table(name):
    x, y, (dark, light), cols, foot = T[name]
    h = HEAD + LH * (len(cols) + 1) + 8
    box[name] = (x, y, W, h)
    s = f'<rect x="{x}" y="{y}" width="{W}" height="{h}" rx="8" fill="{light}" stroke="{dark}" stroke-width="2"/>'
    s += f'<path d="M{x} {y + 8} a8 8 0 0 1 8 -8 h{W - 16} a8 8 0 0 1 8 8 v{HEAD - 8} h-{W} z" fill="{dark}"/>'
    s += f'<text x="{x + 12}" y="{y + 23}" font-size="16" font-weight="700" fill="#fff">{name}</text>'
    for i, c in enumerate(cols):
        s += f'<text x="{x + 12}" y="{y + HEAD + LH * (i + 1) - 2}" font-size="12.5" fill="#222">{esc(c)}</text>'
    s += f'<text x="{x + 12}" y="{y + HEAD + LH * (len(cols) + 1) - 2}" font-size="11" fill="#666" font-style="italic">{esc(foot)}</text>'
    return s


def arrow(points):
    d = "M" + " L".join(f"{a} {b}" for a, b in points)
    return f'<path d="{d}" fill="none" stroke="#444" stroke-width="1.8" marker-end="url(#arr)"/>'


def panel(x, y, w, title, items):
    h = 40 + 22 * len(items)
    s = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="#f6f6f6" stroke="#bbb"/>'
    s += f'<text x="{x + 14}" y="{y + 25}" font-size="15" font-weight="700" fill="#222">{esc(title)}</text>'
    for i, (name, what) in enumerate(items):
        yy = y + 48 + 22 * i
        s += f'<text x="{x + 14}" y="{yy}" font-size="12.5" font-weight="700" fill="#222" font-family="Consolas, monospace">{esc(name)}</text>'
        s += f'<text x="{x + 24 + len(name) * 7.4}" y="{yy}" font-size="12.5" fill="#555">{esc(what)}</text>'
    return s, h


tables = "".join(table(n) for n in T)
b = box
arrows = [
    arrow([(370, 100), (440, 100)]),                                                    # routine_exercises -> routines
    arrow([(130, b["routine_exercises"][1] + b["routine_exercises"][3]), (130, b["exercises"][1])]),
    arrow([(600, b["sessions"][1]), (600, b["routines"][1] + b["routines"][3])]),       # sessions -> routines
    arrow([(600, b["sets"][1]), (600, b["sessions"][1] + b["sessions"][3])]),           # sets -> sessions
    arrow([(440, 640), (405, 640), (405, 480), (370, 480)]),                            # sets -> exercises
    arrow([(1000, b["planned_sessions"][1]), (1000, 115), (780, 115)]),                 # planned_sessions -> routines
    arrow([(850, 330), (780, 330)]),                                                    # planned_sessions -> sessions
    arrow([(1025, b["planned_sets"][1]), (1025, b["planned_sessions"][1] + b["planned_sessions"][3])]),
    arrow([(1000, b["planned_sets"][1] + b["planned_sets"][3]), (1000, 840), (390, 840), (390, 520), (370, 520)]),  # -> exercises
    arrow([(130, b["session_exercise_notes"][1]), (130, b["exercises"][1] + b["exercises"][3])]),
    arrow([(370, 700), (425, 700), (425, 440), (440, 440)]),                            # notes -> sessions
]

p1, h1 = panel(30, 950, 700, "Views  (read-only, shared by every client)", VIEWS)
p2, h2 = panel(760, 950, 810, "Functions  (the logic, in the database)", FUNCS)
H = max(950 + h1, 950 + h2) + 90

legend = f'''<g font-size="13" fill="#222"><rect x="30" y="{H - 70}" width="1580" height="52" rx="8" fill="#fff" stroke="#bbb"/>
<rect x="46" y="{H - 56}" width="14" height="14" fill="{CAT[1]}" stroke="{CAT[0]}"/><text x="68" y="{H - 44}">catalog</text>
<rect x="150" y="{H - 56}" width="14" height="14" fill="{LOG[1]}" stroke="{LOG[0]}"/><text x="172" y="{H - 44}">training log</text>
<rect x="276" y="{H - 56}" width="14" height="14" fill="{PLAN[1]}" stroke="{PLAN[0]}"/><text x="298" y="{H - 44}">plans</text>
<rect x="372" y="{H - 56}" width="14" height="14" fill="{BODY[1]}" stroke="{BODY[0]}"/><text x="394" y="{H - 44}">body / recovery</text>
<rect x="530" y="{H - 56}" width="14" height="14" fill="{DOC[1]}" stroke="{DOC[0]}"/><text x="552" y="{H - 44}">Claude's instructions</text>
<rect x="720" y="{H - 56}" width="14" height="14" fill="{WATCH[1]}" stroke="{WATCH[0]}"/><text x="742" y="{H - 44}">watch pairing</text>
<text x="46" y="{H - 26}">Arrow = belongs to (foreign key). Every table: row level security, only your account. Deletes are soft (deleted_at). All ids are UUIDs made by the client.</text></g>'''

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="1640" height="{H}" viewBox="0 0 1640 {H}" font-family="Segoe UI, Arial, sans-serif">
<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#444"/></marker></defs>
<rect width="1640" height="{H}" fill="#fff"/>
<text x="30" y="34" font-size="22" font-weight="700" fill="#222">GymLogger database: {len(T)} tables, {len(VIEWS)} views, 28 functions</text>
{"".join(arrows)}{tables}{p1}{p2}{legend}</svg>'''

out = Path(__file__).resolve().parent.parent / "docs" / "schema.svg"
out.write_text(svg, encoding="utf-8")
print(f"wrote {out} (height {H})")
