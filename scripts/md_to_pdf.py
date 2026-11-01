"""Turns a markdown file into a clean A4 PDF using the Edge browser that comes with Windows.

    python scripts/md_to_pdf.py docs/evidence.md            # writes docs/evidence.pdf

Needs the `markdown` package (pip install markdown). Web addresses and 'doi 10.xxxx/...' references become links.
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import markdown

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

CSS = """
@page { size: A4; margin: 18mm 16mm; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1d2430; }
h1 { font-size: 21pt; margin: 0 0 6pt; color: #1f4e79; border-bottom: 2px solid #1f4e79; padding-bottom: 6pt; }
h2 { font-size: 13.5pt; margin: 18pt 0 6pt; color: #1f4e79; }
p, li { margin: 4pt 0; }
ul, ol { padding-left: 18pt; }
strong { color: #111; }
a { color: #1b6ec2; text-decoration: none; word-break: break-all; }
code { background: #f1f3f6; padding: 1pt 4pt; border-radius: 3pt; font-size: 9.5pt; }
h2, p, li { orphans: 3; widows: 3; }
h2 { break-after: avoid; }
"""


def prepare(text: str) -> str:
    text = re.sub(r"\(doi (10\.\d{4,9}/[^\s)]+)\)", r"([doi \1](https://doi.org/\1))", text)
    text = re.sub(r"(?<![<(\[])\bhttps?://[^\s<>)]+", lambda m: f"<{m.group(0)}>", text)
    return text


def main():
    src = Path(sys.argv[1]).resolve()
    html_body = markdown.markdown(prepare(src.read_text(encoding="utf-8")), extensions=["extra", "sane_lists"])
    html = f"<!doctype html><html><head><meta charset='utf-8'><title>{src.stem}</title><style>{CSS}</style></head><body>{html_body}</body></html>"
    out = src.with_suffix(".pdf")
    with tempfile.TemporaryDirectory() as tmp:
        page = Path(tmp) / "page.html"
        page.write_text(html, encoding="utf-8")
        subprocess.run(
            [EDGE, "--headless", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={out}", page.as_uri()],
            check=True, capture_output=True, timeout=120)
    print(f"wrote {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
