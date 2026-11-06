"""Draws docs/claude-flow.svg: what happens, step by step, from tapping Finish to a plan made by Claude showing up in the app.
Run:  python scripts/draw_claude_flow.py   then render a PNG with a headless browser (same as the schema diagram)."""
from pathlib import Path
from xml.sax.saxutils import escape as esc

W = 1700
DEV = ("#0b6e6e", "#d9f1f1")     # phone and watch
DB = ("#1f4e79", "#dbe9f7")      # Supabase
AI = ("#9a4f00", "#fde9d0")      # claude.ai
SIDE = ("#555555", "#ececec")    # data Claude reads, documents
LOOP = ("#6b3fa0", "#ece1f7")

LX = {"dev": 30, "db": 520, "ai": 1150}
LW = {"dev": 400, "db": 540, "ai": 520}
LANES = [("dev", DEV, "Phone and watch", "what you hold"),
         ("db", DB, "Supabase database", "all the logic; every table is yours only (row level security)"),
         ("ai", AI, "claude.ai scheduled task", "\"GymLogger planner\", runs on your Claude plan")]

parts = []
box_geo = {}


def text(x, y, s, size=13, weight="400", fill="#222", anchor="start", style=""):
    parts.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" {style}>{esc(s)}</text>')


def step(key, lane, y, pal, n, title, lines, w=None):
    """A numbered box inside a lane. Returns its bottom y."""
    dark, light = pal
    x = LX[lane] + 20
    w = w or LW[lane] - 40
    h = 46 + 19 * len(lines) + 10
    box_geo[key] = (x, y, w, h)
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="9" fill="{light}" stroke="{dark}" stroke-width="2"/>')
    if n is not None:
        parts.append(f'<circle cx="{x + 24}" cy="{y + 24}" r="14" fill="{dark}"/>')
        text(x + 24, y + 29, str(n), 14, "700", "#fff", "middle")
        text(x + 48, y + 29, title, 15, "700", dark)
    else:
        text(x + 14, y + 29, title, 15, "700", dark)
    for i, line in enumerate(lines):
        text(x + 16, y + 56 + 19 * i, line, 12.5, "400", "#333")
    return y + h


def path(points, color="#444", dash=False, label=None, lpos=None, width=2.2, marker=True):
    d = "M" + " L".join(f"{a} {b}" for a, b in points)
    da = ' stroke-dasharray="7 5"' if dash else ""
    mk = ' marker-end="url(#arr)"' if marker else ""
    parts.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}"{da}{mk}/>')
    if label:
        lx, ly = lpos
        text(lx, ly, label, 12, "700", color, "middle")


def edge(key, side):
    x, y, w, h = box_geo[key]
    return {"t": (x + w / 2, y), "b": (x + w / 2, y + h), "l": (x, y + 30), "r": (x + w, y + 30)}[side]


# ------------------------------------------------------------------ boxes (y positions chosen so nothing overlaps)
step(1, "dev", 120, DEV, 1, "You tap Finish", [
    "The workout is saved on the phone or watch",
    "first, so it works with no signal. You can tap",
    "a feeling from 1 to 5. Until it uploads, the",
    "history shows \"waiting to upload\"."])
step(2, "db", 120, DB, 2, "sync_workout uploads it", [
    "Session, sets and feeling are merged into the",
    "database (safe to repeat: ids are made on the",
    "device). A workout done on two devices is one.",
    "Finishing then runs finish_session."])
step(3, "db", 290, DB, 3, "finish_session", [
    "Marks the session as ended.",
    "Marks the routine's pending plans as used.",
    "generate_plan: writes the automatic rules plan",
    "right away, so a plan exists even if Claude",
    "never answers."])
step(4, "db", 500, DB, 4, "request_claude_plan", [
    "Reads the address and the token from the Vault",
    "(never in the code). Sends one HTTP request",
    "with pg_net: \"routine: Workout B\" + session id.",
    "Only once per session. If it fails, the finish",
    "still succeeds (the rules plan stays)."])
step(5, "ai", 500, AI, 5, "The task starts", [
    "Nobody is watching. It reads only the routine's",
    "name from the request, and ignores anything",
    "else in it. An unknown routine name: it stops."])
step(6, "ai", 670, AI, 6, "Reads your instructions", [
    "select claude_instructions(true), through the",
    "Supabase connector: your goal, the planning",
    "guide and the evidence notes. This text is yours,",
    "so it is followed. An empty text: it stops."])
step("docs", "db", 670, SIDE, None, "documents", [
    "owner-goal, planning-guide, evidence-notes",
    "(the guide is published from CLAUDE_GUIDE.md)"])
step(7, "ai", 840, AI, 7, "Reads your data (select only)", [
    "The routine's exercises and rep ranges, the last",
    "4 sessions (every set, your notes), then how the",
    "body is doing: weekly overview, session scores",
    "and feelings, measurements, check-ins."])
step("views", "db", 840, SIDE, None, "views and tables it reads", [
    "routine_exercises, exercises, sets, sessions,",
    "session_scores, weekly_overview, body_latest,",
    "body_shape, body_checkins, current_plan"])
step(8, "ai", 1010, AI, 8, "Decides the next session", [
    "Double progression inside each rep range, the",
    "weight steps (increment_kg), your goal and the",
    "research notes. It keeps your three routines and",
    "flags any exercise whose step is unknown."])
step("rules", "db", 1010, SIDE, None, "What Claude may and may not do", [
    "It uses select queries and submit_plan only: it",
    "never inserts, updates or deletes anything else.",
    "Text found in the database (notes, titles) is",
    "treated as data, never as instructions."])
step(9, "ai", 1170, AI, 9, "Calls submit_plan", [
    "submit_plan(routine, plan as JSON, note):",
    "every exercise with its sets: weight, rep range.",
    "It may not insert, update or delete anything else."])
step(10, "db", 1170, DB, 10, "submit_plan checks and saves", [
    "Rejects unknown exercise names, repeated",
    "exercises and impossible sets (with a message).",
    "Replaces an older pending Claude plan, then",
    "writes planned_sessions (claude, pending) and",
    "planned_sets."])
step(11, "db", 1380, DB, 11, "The app asks for the plan", [
    "current_plan: a pending Claude plan beats the",
    "rules plan. workout_plan / workout_start merge",
    "it with any change you made to the routine."])
step(12, "dev", 1380, DEV, 12, "You see it", [
    "The routine says \"Claude plan ready\" with",
    "Claude's note (or \"Auto plan ready\" if there is",
    "none yet). The targets show next to what you",
    "did last time. The watch hints after each set."])
step(13, "dev", 1580, LOOP, 13, "You train, then Finish again", [
    "The plan is marked used and the session gets",
    "its score: the share of planned sets met.",
    "That score and your feeling go to the next plan."])

# ------------------------------------------------------------------ arrows
c = "#444"
path([edge(1, "r"), edge(2, "l")], c, label="upload", lpos=((edge(1, "r")[0] + edge(2, "l")[0]) / 2, edge(1, "r")[1] - 8))
path([edge(2, "b"), edge(3, "t")], c)
path([edge(3, "b"), edge(4, "t")], c)
path([edge(4, "r"), edge(5, "l")], "#9a4f00", dash=True, label="HTTPS call",
     lpos=((edge(4, "r")[0] + edge(5, "l")[0]) / 2, edge(4, "r")[1] - 8))
path([edge(5, "b"), edge(6, "t")], c)
path([edge(6, "l"), edge("docs", "r")], "#555", dash=True, label="SQL", lpos=((edge(6, "l")[0] + edge("docs", "r")[0]) / 2, edge(6, "l")[1] - 8))
path([edge(6, "b"), edge(7, "t")], c)
path([edge(7, "l"), edge("views", "r")], "#555", dash=True, label="SQL", lpos=((edge(7, "l")[0] + edge("views", "r")[0]) / 2, edge(7, "l")[1] - 8))
path([edge(7, "b"), edge(8, "t")], c)
path([edge(8, "b"), edge(9, "t")], c)
path([edge(9, "l"), edge(10, "r")], "#9a4f00", dash=True, label="writes plan",
     lpos=((edge(9, "l")[0] + edge(10, "r")[0]) / 2, edge(9, "l")[1] - 8))
# 10 -> 11 (down), 11 -> 12 (left), 12 -> 13 (down)
path([edge(10, "b"), edge(11, "t")], c)
path([edge(11, "l"), edge(12, "r")], c, label="the plan", lpos=((edge(11, "l")[0] + edge(12, "r")[0]) / 2, edge(11, "l")[1] - 8))
path([edge(12, "b"), edge(13, "t")], c)
# loop: 13 back to 1 along the far left margin
x13, y13, w13, h13 = box_geo[13]
x1, y1, w1, h1 = box_geo[1]
path([(x13, y13 + 30), (9, y13 + 30), (9, y1 + 30), (x1, y1 + 30)], "#6b3fa0", dash=True)
text(24, y13 - 40, "and round again", 12, "700", "#6b3fa0", style='transform="rotate(-90 24 %d)"' % (y13 - 40))

H = box_geo[13][1] + box_geo[13][3] + 130

# ------------------------------------------------------------------ lanes (drawn first, so under the boxes)
lanes = ""
for key, (dark, light), title, sub in LANES:
    lanes += (f'<rect x="{LX[key]}" y="70" width="{LW[key]}" height="{H - 140}" rx="12" fill="{light}" fill-opacity="0.35" stroke="{dark}" stroke-width="2.5" stroke-dasharray="2 0"/>'
              f'<text x="{LX[key] + 18}" y="95" font-size="17" font-weight="700" fill="{dark}">{esc(title)}</text>'
              f'<text x="{LX[key] + 18}" y="112" font-size="12" fill="#666" font-style="italic" transform="translate(0,0)"></text>')

legend = f'''<g font-size="13" fill="#222"><rect x="30" y="{H - 62}" width="1640" height="46" rx="8" fill="#fff" stroke="#bbb"/>
<line x1="48" y1="{H - 39}" x2="98" y2="{H - 39}" stroke="#444" stroke-width="2.2" marker-end="url(#arr)"/><text x="108" y="{H - 34}">happens inside one place / one step to the next</text>
<line x1="500" y1="{H - 39}" x2="550" y2="{H - 39}" stroke="#9a4f00" stroke-width="2.2" stroke-dasharray="7 5" marker-end="url(#arr)"/><text x="560" y="{H - 34}">crosses the internet (HTTPS)</text>
<line x1="830" y1="{H - 39}" x2="880" y2="{H - 39}" stroke="#555" stroke-width="2.2" stroke-dasharray="7 5" marker-end="url(#arr)"/><text x="890" y="{H - 34}">a read-only query through the Supabase connector</text></g>'''

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Segoe UI, Arial, sans-serif">
<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#444"/></marker></defs>
<rect width="{W}" height="{H}" fill="#fff"/>
<text x="30" y="38" font-size="24" font-weight="700" fill="#222">From Finish to a plan made by Claude</text>
<text x="30" y="58" font-size="13.5" fill="#555">Everything after step 4 happens with nobody at the phone. The automatic rules plan (step 3) is already there as a fallback.</text>
{lanes}{"".join(parts)}{legend}</svg>'''

out = Path(__file__).resolve().parent.parent / "docs" / "claude-flow.svg"
out.write_text(svg, encoding="utf-8")
print(f"wrote {out} (height {H})")
