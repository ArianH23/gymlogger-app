"""Draws docs/cicd.svg: how the planned CI/CD works. Run:  python scripts/draw_cicd.py
Then render a PNG with a headless browser (see README, same as the schema diagram)."""
from pathlib import Path
from xml.sax.saxutils import escape as esc

W, H = 1560, 930
GREY = ("#555555", "#ececec")
CI = ("#1f4e79", "#e6eef8")
AUTO = ("#1e6b3a", "#e4f4ea")
MANUAL = ("#9a4f00", "#fdeedb")
PC = ("#6b3fa0", "#efe6f8")
STOP = ("#a32020", "#fbe4e4")
KEY = ("#8a6d00", "#fff6d6")

parts = []


def text(x, y, s, size=13, weight="400", fill="#222", anchor="start", style=""):
    parts.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" {style}>{esc(s)}</text>')


def box(x, y, w, h, pal, title, lines=(), title_size=14.5):
    dark, light = pal
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="9" fill="{light}" stroke="{dark}" stroke-width="2"/>')
    text(x + 14, y + 24, title, title_size, "700", dark)
    for i, line in enumerate(lines):
        text(x + 14, y + 46 + 19 * i, line, 12.5, "400", "#333")


def panel(x, y, w, h, pal, title, sub):
    dark, light = pal
    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{light}" stroke="{dark}" stroke-width="2.5"/>')
    text(x + 18, y + 31, title, 17, "700", dark)
    text(x + 18, y + 52, sub, 12.5, "400", "#555", style='font-style="italic"')


def arrow(x1, y1, x2, y2, color="#444", dash=False, label=None, lx=None, ly=None):
    d = ' stroke-dasharray="7 5"' if dash else ""
    parts.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="2.2"{d} marker-end="url(#arr)"/>')
    if label:
        text(lx if lx is not None else (x1 + x2) / 2, ly if ly is not None else (y1 + y2) / 2 - 8, label, 12, "700", color, "middle")


text(30, 38, "GymLogger: how the CI/CD would work", 24, "700")
text(30, 62, "CI = automatic checks on every push. CD = putting the result live. Green is automatic, orange needs your click, purple stays on your PC.", 13.5, "400", "#555")

# ---- you push
box(30, 270, 270, 120, GREY, "You push to GitHub", ["git push origin main", "(this is the only thing you do", "for the automatic parts)"])

# ---- CI
panel(330, 90, 420, 640, CI, "CI: checks on every push", "automatic, needs no secrets")
checks = [
    ("1  Database tests", ["240 checks, run on a", "temporary test database"]),
    ("2  Phone app", ["type-check, lint and build"]),
    ("3  Importer tests", ["the Hevy importer (Python)"]),
    ("4  Watch app compiles", ["build only: nothing is installed"]),
]
for i, (t, ls) in enumerate(checks):
    box(350, 170 + 105 * i, 380, 92, CI, t, ls)
box(350, 610, 180, 100, AUTO, "All green", ["the site job", "starts"])
box(550, 610, 180, 100, STOP, "Any red", ["stop: nothing", "is deployed"])
arrow(300, 330, 330, 330, "#444")
arrow(750, 215, 830, 215, AUTO[0], label="green", lx=790, ly=205)

# ---- lane A: the site (automatic)
panel(830, 90, 700, 270, AUTO, "Site: deploys itself when CI is green", "uses the Cloudflare and Supabase secrets")
box(850, 170, 260, 90, AUTO, "Is production's database", ["up to date?", "(any migration not applied yet?)"])
arrow(1110, 215, 1160, 215, AUTO[0], label="yes", lx=1135, ly=205)
box(1160, 170, 350, 90, AUTO, "Build the phone app", ["and deploy it to Cloudflare"])
arrow(1335, 260, 1335, 292, AUTO[0])
parts.append(f'<rect x="1160" y="292" width="350" height="50" rx="25" fill="{AUTO[0]}"/>')
text(1335, 322, "Site is live: the phone updates itself", 13.5, "700", "#fff", "middle")
arrow(980, 260, 980, 292, STOP[0])
box(850, 292, 260, 52, STOP, "no: stop with a message", ["\"run the database button first\""], 13)

# ---- lane B: the database (manual)
panel(830, 390, 700, 270, MANUAL, "Database: only when you click", "GitHub, Actions, \"Deploy database\", Run workflow")
box(850, 470, 210, 118, MANUAL, "1  First run", ["\"apply\" box NOT ticked", "dry run: shows the list", "changes nothing"])
arrow(1060, 529, 1090, 529, MANUAL[0])
box(1090, 470, 210, 118, MANUAL, "2  Second run", ["\"apply\" box ticked", "applies the migrations", "to your real database"])
arrow(1300, 529, 1330, 529, MANUAL[0])
box(1330, 470, 180, 118, MANUAL, "3  Same run", ["then deploys the", "watch-pair function", "(in this order)"])
text(850, 625, "You read the list in run 1, then click again with the box ticked. Afterwards the site check above passes.", 12.5, "400", "#555", style='font-style="italic"')
text(850, 646, "Why by hand: a migration cannot be undone, and the tests never see your real data.", 12.5, "700", MANUAL[0])

# ---- lane C: the watch (on the PC)
panel(830, 690, 700, 160, PC, "Watch app: stays on your PC", "GitHub cannot reach your watch, so this part is never automatic")
box(850, 760, 200, 78, PC, "Build the release", ["build.ps1 assembleRelease"], 14)
arrow(1050, 799, 1080, 799, PC[0])
box(1080, 760, 210, 78, PC, "Connect over Wi-Fi", ["adb pair, adb connect"], 14)
arrow(1290, 799, 1320, 799, PC[0])
box(1320, 760, 190, 78, PC, "Wear OS watch", ["adb install -r"], 14)

# ---- secrets
box(30, 440, 270, 290, KEY, "Secrets (you add them)", [
    "repo Settings, Secrets and",
    "variables, Actions",
    "",
    "Cloudflare token + account ID",
    "   used by the site deploy",
    "",
    "Supabase access token +",
    "database password",
    "   used by the site check and",
    "   the database button",
    "",
    "Public, not secret: Supabase",
    "URL and publishable key",
])

# ---- legend
parts.append(f'<rect x="30" y="868" width="1500" height="44" rx="8" fill="#fff" stroke="#bbb"/>')
for i, (pal, name) in enumerate([(AUTO, "automatic"), (MANUAL, "needs your click"), (PC, "on your PC"), (STOP, "stop"), (CI, "checks (CI)"), (KEY, "secrets")]):
    x = 50 + 175 * i
    parts.append(f'<rect x="{x}" y="882" width="16" height="16" fill="{pal[1]}" stroke="{pal[0]}" stroke-width="2"/>')
    text(x + 24, 895, name, 13)

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Segoe UI, Arial, sans-serif">
<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="context-stroke"/></marker></defs>
<rect width="{W}" height="{H}" fill="#fff"/>
{"".join(parts)}</svg>'''

out = Path(__file__).resolve().parent.parent / "docs" / "cicd.svg"
out.write_text(svg, encoding="utf-8")
print(f"wrote {out}")
