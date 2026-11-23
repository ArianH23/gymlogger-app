"""Draws the app's artwork from simple geometric shapes (no third-party images, nothing traced or copied).

    python scripts/make_art.py          (needs: pip install pillow)

Writes:
  web/public/icon-192.png, icon-512.png            the app icon (phone home screen, favicon, login screen)
  web/public/icon.svg                              the same icon as a vector
  watch/app/src/main/res/mipmap-*/ic_launcher.png  the watch launcher icon, five densities
  web/public/faces/{great,good,average,weak,poor}.png   the session-tier faces (512 px, transparent)

All of it is original work released under the repository's MIT licence (see LICENSE).
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SS = 4  # draw 4x bigger, then shrink: smooth edges

BG, JADE = (15, 17, 21, 255), (76, 195, 138, 255)
INK = (16, 35, 27, 255)


def dumbbell(size: int) -> Image.Image:
    """Same geometry as icon.svg (a 512 x 512 drawing), scaled to `size`."""
    k = size * SS / 512
    img = Image.new("RGBA", (size * SS, size * SS), BG)
    d = ImageDraw.Draw(img)
    for (x, y, w, h, r) in [(96, 216, 320, 80, 10), (64, 160, 56, 192, 14), (392, 160, 56, 192, 14),
                            (28, 196, 44, 120, 12), (440, 196, 44, 120, 12)]:
        d.rounded_rectangle([x * k, y * k, (x + w) * k, (y + h) * k], radius=r * k, fill=JADE)
    return img.resize((size, size), Image.LANCZOS)


ICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0f1115"/>
  <g fill="#4cc38a">
    <rect x="96" y="216" width="320" height="80" rx="10"/>
    <rect x="64" y="160" width="56" height="192" rx="14"/>
    <rect x="392" y="160" width="56" height="192" rx="14"/>
    <rect x="28" y="196" width="44" height="120" rx="12"/>
    <rect x="440" y="196" width="44" height="120" rx="12"/>
  </g>
</svg>
"""

# tier -> face colour
FACE = {"great": (76, 195, 138), "good": (140, 207, 106), "average": (224, 184, 76),
        "weak": (224, 138, 76), "poor": (217, 83, 79)}


def face(tier: str, size: int = 512) -> Image.Image:
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = s / 512  # one unit of the 512 grid
    P = lambda x, y: (x * u, y * u)
    d.ellipse([24 * u, 24 * u, 488 * u, 488 * u], fill=FACE[tier] + (255,))
    w = int(18 * u)

    def eye(cx, cy, r=26):  # open eye
        d.ellipse([(cx - r) * u, (cy - r) * u, (cx + r) * u, (cy + r) * u], fill=INK)

    def closed(cx, cy):  # calm closed eye: a downward arc
        d.arc([(cx - 36) * u, (cy - 30) * u, (cx + 36) * u, (cy + 30) * u], 20, 160, fill=INK, width=w)

    def smile(top, bottom, a0, a1):
        d.arc([120 * u, top * u, 392 * u, bottom * u], a0, a1, fill=INK, width=w)

    if tier == "great":      # the grin: open eyes, wide open smile
        eye(170, 195); eye(342, 195)
        d.pieslice([130 * u, 250 * u, 382 * u, 420 * u], 0, 180, fill=INK)
    elif tier == "good":     # calm, eyes closed, gentle smile
        closed(170, 205); closed(342, 205)
        smile(250, 400, 25, 155)
    elif tier == "average":  # neutral: dots and a straight mouth
        eye(170, 200, 22); eye(342, 200, 22)
        d.line([P(180, 340), P(332, 340)], fill=INK, width=w)
    elif tier == "weak":     # side-eye: pupils looking sideways, flat mouth tilted down
        for cx in (170, 342):
            d.ellipse([(cx - 30) * u, 168 * u, (cx + 30) * u, 226 * u], fill=(255, 255, 255, 255))
            d.ellipse([(cx + 2) * u, 178 * u, (cx + 26) * u, 214 * u], fill=INK)
        d.line([P(140, 160), P(210, 150)], fill=INK, width=w)
        d.line([P(302, 150), P(372, 160)], fill=INK, width=w)
        d.line([P(185, 345), P(330, 328)], fill=INK, width=w)
    else:                    # poor: the scowl, angled brows and a frown
        eye(170, 215, 20); eye(342, 215, 20)
        d.line([P(120, 150), P(215, 190)], fill=INK, width=int(22 * u))
        d.line([P(392, 150), P(297, 190)], fill=INK, width=int(22 * u))
        d.arc([150 * u, 330 * u, 362 * u, 450 * u], 200, 340, fill=INK, width=w)
    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    pub = ROOT / "web" / "public"
    (pub / "faces").mkdir(parents=True, exist_ok=True)
    (pub / "icon.svg").write_text(ICON_SVG, encoding="utf-8")
    for n in (192, 512):
        dumbbell(n).convert("RGB").save(pub / f"icon-{n}.png", optimize=True)
    for density, n in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
        out = ROOT / "watch" / "app" / "src" / "main" / "res" / f"mipmap-{density}"
        out.mkdir(parents=True, exist_ok=True)
        dumbbell(n).convert("RGB").save(out / "ic_launcher.png", optimize=True)
    for tier in FACE:
        face(tier).save(pub / "faces" / f"{tier}.png", optimize=True)
    print("icons and faces written")


if __name__ == "__main__":
    main()
