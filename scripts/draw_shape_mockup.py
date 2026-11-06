"""A mockup of the "shape vs target" view: a front-view figure built from your tape measurements, with the target outline on
top, and a table of the gaps. Run:  python scripts/draw_shape_mockup.py   (writes docs/shape-mockup.svg; render it to PNG
with a headless browser, as for the schema diagram).

Everything here is schematic. Trunk circumferences become front-view widths with fixed factors, limbs are treated as circles
(width = circumference / pi), and the heights of the landmarks are typical proportions. It is meant to show proportions and
gaps, not to be a body scan. The target is a proportions model scaled to your height, NOT official numbers.
"""
import math
from pathlib import Path
from xml.sax.saxutils import escape as esc

W, H = 1560, 930
BG, CARD = "#0f1115", "#1a1a19"
INK, INK2, MUTED, GRID = "#ffffff", "#c3c2b7", "#8d94a5", "#2c2f38"
YOU, TARGET = "#3987e5", "#d95926"  # validated categorical slots 1 and 2 for a dark surface

HEIGHT = 162.0
PX = 4.0  # pixels per cm
FLOOR, CX = 830, 335

# sample tape measurements (cm), 14 Mar 2026
you = dict(shoulders=108, chest=90, waist=76, abdomen=78, hips=91, neck=36,
           bicep_l=29, bicep_r=29, forearm_l=24, forearm_r=24, thigh_l=51, thigh_r=50, calf_l=35, calf_r=35)

# the target: classical athletic proportions of a wide-shouldered, lean, strong build, scaled to the height
target = dict(shoulders=0.72 * HEIGHT, chest=0.60 * HEIGHT, waist=0.44 * HEIGHT, abdomen=0.46 * HEIGHT, hips=0.52 * HEIGHT,
              neck=0.22 * HEIGHT, bicep_l=0.2222 * HEIGHT, bicep_r=0.2222 * HEIGHT, forearm_l=0.1722 * HEIGHT, forearm_r=0.1722 * HEIGHT, thigh_l=0.3444 * HEIGHT, thigh_r=0.3444 * HEIGHT, calf_l=0.2222 * HEIGHT, calf_r=0.2222 * HEIGHT)


def yy(frac):
    return FLOOR - frac * HEIGHT * PX


def smooth_closed(pts):
    """A smooth closed path through the points (Catmull-Rom turned into Bezier curves)."""
    n = len(pts)
    d = f"M{pts[0][0]:.1f},{pts[0][1]:.1f}"
    for i in range(n):
        p0, p1, p2, p3 = pts[(i - 1) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d += f" C{c1[0]:.1f},{c1[1]:.1f} {c2[0]:.1f},{c2[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}"
    return d + " Z"


def contour(left, mirror_cx=CX):
    """left: [(y fraction, half width cm)] top to bottom. Returns the closed outline through both sides."""
    l = [(mirror_cx - hw * PX, yy(f)) for f, hw in left]
    r = [(mirror_cx + hw * PX, yy(f)) for f, hw in reversed(left)]
    return l + r


def limb(cx_cm, spec):
    """spec: [(y fraction, half width cm, centre offset cm)] top to bottom, for a vertical limb centred at cx_cm."""
    left = [(CX + (cx_cm + off) * PX - hw * PX, yy(f)) for f, hw, off in spec]
    right = [(CX + (cx_cm + off) * PX + hw * PX, yy(f)) for f, hw, off in reversed(spec)]
    return left + right


def figure(m):
    """The paths of a figure with the given measurements: head, torso, two arms, two legs."""
    sh = 0.385 * m["shoulders"] / 2  # half width across the deltoids
    ch, wa, ab, hi = (0.31 * m[k] / 2 for k in ("chest", "waist", "abdomen", "hips"))
    nk = m["neck"] / math.pi / 2
    torso = contour([(0.87, nk), (0.84, nk + 2.5), (0.815, sh * 0.93), (0.785, sh * 0.9), (0.735, ch),
                     (0.685, ch + (wa - ch) * 0.5), (0.625, wa), (0.595, ab), (0.53, hi), (0.485, hi * 0.97)])
    paths = [smooth_closed(torso), f'<ellipse cx="{CX}" cy="{yy(0.935):.1f}" rx="{7.8 * PX:.1f}" ry="{0.068 * HEIGHT * PX:.1f}"/>']
    for side, sign in (("l", -1), ("r", 1)):
        bw, fw = m["bicep_" + side] / math.pi / 2, m["forearm_" + side] / math.pi / 2
        arm_x = sign * (sh - bw * 0.95)
        arm = limb(arm_x, [(0.81, bw * 0.8, 0), (0.74, bw, sign * 0.4), (0.665, (bw + fw) / 2 * 0.95, sign * 0.9),
                           (0.57, fw, sign * 1.5), (0.5, fw * 0.62, sign * 2.0), (0.455, 2.6, sign * 2.2)])
        paths.append(smooth_closed(arm))
        tw, cw = m["thigh_" + side] / math.pi / 2, m["calf_" + side] / math.pi / 2
        leg_x = sign * (hi * 0.5)
        leg = limb(leg_x, [(0.50, tw * 0.95, 0), (0.43, tw, sign * 0.3), (0.34, tw * 0.78, sign * 0.2), (0.285, tw * 0.62, 0),
                           (0.2, cw, sign * 0.3), (0.12, cw * 0.62, 0), (0.04, 2.9, 0)])
        paths.append(smooth_closed(leg))
    return paths


def group(paths, **attrs):
    body = "".join(p if p.startswith("<") else f'<path d="{p}"/>' for p in paths)
    a = " ".join(f'{k.replace("_", "-")}="{v}"' for k, v in attrs.items())
    return f"<g {a}>{body}</g>"


parts = []


def text(x, y, s, size=13, weight="400", fill=INK, anchor="start", style=""):
    parts.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}" {style}>{esc(s)}</text>')


text(40, 40, "Sample data: shape vs target, a mockup with example measurements of 14 Mar", 24, "700")
text(40, 66, "Front view, schematic. Your shape is filled; the target is the orange outline and tint. Height 162 cm.", 14, "400", INK2)

# ---- the figure panel
parts.append(f'<rect x="30" y="86" width="640" height="810" rx="14" fill="{CARD}"/>')
parts.append(f'<line x1="60" y1="{FLOOR + 4}" x2="640" y2="{FLOOR + 4}" stroke="{GRID}" stroke-width="2"/>')
parts.append(group(figure(target), fill=TARGET, opacity="0.22"))  # where the target is bigger than you, an orange rim shows
parts.append(group(figure(you), fill=YOU, opacity="0.85"))
parts.append(group(figure(target), fill="#000", filter="url(#edge)"))

# direct labels with leader lines (a few regions only)
def label(side, frac, name, key, half_cm):
    cur = you[key] if key in you else (you[key + "_l"] + you[key + "_r"]) / 2
    tgt = target[key] if key in target else (target[key + "_l"] + target[key + "_r"]) / 2
    y = yy(frac)
    if side == "L":
        x_edge, x_text, anchor = CX - half_cm * PX - 6, 52, "start"
        line_from = 172
    else:
        x_edge, x_text, anchor = CX + half_cm * PX + 6, 648, "end"
        line_from = 506
    parts.append(f'<line x1="{line_from}" y1="{y:.1f}" x2="{x_edge:.1f}" y2="{y:.1f}" stroke="{MUTED}" stroke-width="1"/>')
    parts.append(f'<circle cx="{x_edge:.1f}" cy="{y:.1f}" r="3.5" fill="{INK}"/>')
    text(x_text, y - 8, name, 13, "700", INK, anchor)
    text(x_text, y + 10, f"{cur:g} → {tgt:.0f} cm", 13, "400", INK2, anchor)


sh_t, ch_t, wa_t = (0.385 * target["shoulders"] / 2), 0.31 * target["chest"] / 2, 0.31 * target["waist"] / 2
label("L", 0.815, "Shoulders", "shoulders", sh_t)
label("L", 0.735, "Chest", "chest", ch_t + 1)
label("L", 0.625, "Waist", "waist", 0.31 * you["waist"] / 2)
label("R", 0.665, "Biceps", "bicep", sh_t + 3)
label("R", 0.40, "Thighs", "thigh", 0.31 * you["hips"] / 2 * 0.5 + target["thigh_r"] / math.pi * 0.9)
label("R", 0.19, "Calves", "calf", 0.31 * you["hips"] / 2 * 0.5 + you["calf_r"] / math.pi / 2 + 2)

# legend
parts.append(f'<rect x="60" y="108" width="22" height="14" rx="3" fill="{YOU}" opacity="0.85"/>')
text(90, 120, "You", 13, "400", INK)
parts.append(f'<rect x="140" y="108" width="22" height="14" rx="3" fill="none" stroke="{TARGET}" stroke-width="2"/>')
text(170, 120, "Target (goal look)", 13, "400", INK)

# ---- the table of gaps
X0 = 700
parts.append(f'<rect x="{X0 - 10}" y="86" width="830" height="810" rx="14" fill="{CARD}"/>')
text(X0 + 14, 122, "How far each measurement is", 18, "700")
text(X0 + 14, 146, "The bar shows how much of the target size you have (for waist, abdomen and hips: how close you are from above).", 12.5, "400", INK2)
heads = [("Measurement", X0 + 14, "start"), ("You", X0 + 300, "end"), ("Target", X0 + 395, "end"), ("To go", X0 + 500, "end")]
for h, x, a in heads:
    text(x, 186, h, 13, "700", MUTED, a)
BAR_X, BAR_W = X0 + 540, 250
text(BAR_X, 186, "Progress", 13, "700", MUTED)

rows = [
    ("Shoulders", you["shoulders"], target["shoulders"], "grow"),
    ("Chest", you["chest"], target["chest"], "grow"),
    ("Waist", you["waist"], target["waist"], "shrink"),
    ("Abdomen", you["abdomen"], target["abdomen"], "shrink"),
    ("Hips", you["hips"], target["hips"], "shrink"),
    ("Neck", you["neck"], target["neck"], "grow"),
    ("Biceps (avg L/R)", (you["bicep_l"] + you["bicep_r"]) / 2, (target["bicep_l"] + target["bicep_r"]) / 2, "grow"),
    ("Forearms (avg)", (you["forearm_l"] + you["forearm_r"]) / 2, (target["forearm_l"] + target["forearm_r"]) / 2, "grow"),
    ("Thighs (avg)", (you["thigh_l"] + you["thigh_r"]) / 2, (target["thigh_l"] + target["thigh_r"]) / 2, "grow"),
    ("Calves (avg)", (you["calf_l"] + you["calf_r"]) / 2, (target["calf_l"] + target["calf_r"]) / 2, "grow"),
]
y = 222
for name, cur, tgt, kind in rows:
    closeness = min(cur / tgt, 1.0) if kind == "grow" else min(tgt / cur, 1.0)
    gap = tgt - cur
    done = closeness >= 0.995
    to_go = "reached" if done else (f"+{gap:.1f} cm" if gap > 0 else f"{gap:.1f} cm")
    text(X0 + 14, y + 5, name, 14.5)
    text(X0 + 300, y + 5, f"{cur:g} cm", 14.5, "400", INK, "end")
    text(X0 + 395, y + 5, f"{tgt:.0f} cm", 14.5, "400", INK2, "end")
    text(X0 + 500, y + 5, to_go, 14.5, "700" if not done else "400", INK, "end")
    parts.append(f'<rect x="{BAR_X}" y="{y - 4}" width="{BAR_W}" height="8" rx="4" fill="{GRID}"/>')
    parts.append(f'<rect x="{BAR_X}" y="{y - 4}" width="{BAR_W * closeness:.1f}" height="8" rx="4" fill="{YOU}"/>')
    parts.append(f'<rect x="{BAR_X + BAR_W - 2}" y="{y - 9}" width="3" height="18" rx="1.5" fill="{TARGET}"/>')
    text(BAR_X + BAR_W + 12, y + 5, f"{closeness * 100:.0f}%", 13, "400", INK2)
    y += 44

# the V-taper, as a headline row
y += 10
parts.append(f'<line x1="{X0 + 14}" y1="{y - 22}" x2="{X0 + 800}" y2="{y - 22}" stroke="{GRID}" stroke-width="1"/>')
ratio_now, ratio_t = you["shoulders"] / you["waist"], target["shoulders"] / target["waist"]
text(X0 + 14, y + 8, "V-taper (shoulders ÷ waist)", 15, "700")
text(X0 + 300, y + 8, f"{ratio_now:.2f}", 22, "700", INK, "end")
text(X0 + 395, y + 8, f"{ratio_t:.2f}", 22, "400", INK2, "end")
text(X0 + 540, y + 8, "the classic ideal is about 1.6", 13, "400", INK2)
y += 60
text(X0 + 14, y, "Where the gap is: in this sample, mostly the shoulders, chest and arms (to grow) and the hips (to shrink).", 13.5, "400", INK2)
y += 52
for line in ("How the target is set: proportions of a wide-shouldered, lean, strong build scaled to your 162 cm",
              "(shoulders 72% of height, waist 44%, chest 60%, hips 52%, biceps and calves 22%, thighs 34%).",
              "There are no official measurements, so this is a model of the look, and every number can be edited.",
              "Some targets (biceps 36 cm, thighs 56 cm) are at the high end for a natural lifter and take years.",
              "Tape method matters: measure biceps the same way every time (flexed or relaxed)."):
    text(X0 + 14, y, line, 12.5, "400", MUTED)
    y += 21

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Segoe UI, Arial, sans-serif">
<defs>
<!-- only the outer edge of a shape (2.5px), so overlapping limbs do not show inside lines -->
<filter id="edge" x="-5%" y="-5%" width="110%" height="110%">
<feMorphology in="SourceAlpha" operator="dilate" radius="2.5" result="grown"/>
<feComposite in="grown" in2="SourceAlpha" operator="out" result="edge"/>
<feFlood flood-color="{TARGET}"/>
<feComposite in2="edge" operator="in"/>
</filter>
</defs>
<rect width="{W}" height="{H}" fill="{BG}"/>
{"".join(parts)}</svg>'''

out = Path(__file__).resolve().parent.parent / "docs" / "shape-mockup.svg"
out.write_text(svg, encoding="utf-8")
print(f"wrote {out}")
