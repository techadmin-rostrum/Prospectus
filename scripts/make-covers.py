#!/usr/bin/env python3
"""
Render page 1 of each prospectus to a static cover image.

The landing page used to open both PDFs through pdf.js just to draw the two
cover thumbnails, which costs ~1 MB (UG) and ~8 MB (PG) of range requests
before anything is visible. Static covers make that page free.

Usage:  python scripts/make-covers.py
Requires: pip install pymupdf
"""

import pathlib

import pymupdf

ROOT = pathlib.Path(__file__).resolve().parent.parent
PDF_DIR = ROOT / "public" / "pdfs"
OUT_DIR = ROOT / "public" / "covers"

# Cards render at ~35vw, so ~1100px covers a 2x retina desktop card.
TARGET_WIDTH = 1100
JPEG_QUALITY = 82

SOURCES = {
    "ug": "UG26.v2.pdf",
    "pg": "PG26.v2.pdf",
}


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for slug, filename in SOURCES.items():
        src = PDF_DIR / filename
        if not src.exists():
            print(f"skip {filename}: not found")
            continue

        doc = pymupdf.open(src)
        page = doc[0]
        zoom = TARGET_WIDTH / page.rect.width
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)

        out = OUT_DIR / f"{slug}-cover.jpg"
        pix.save(out, jpg_quality=JPEG_QUALITY)
        doc.close()

        print(f"{out.relative_to(ROOT)}  {pix.width}x{pix.height}  {out.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
