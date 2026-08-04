# Asset pipeline

One-off Python scripts for preparing the prospectus assets. They are not part of
the Vite build — run them by hand whenever a new PDF is dropped in.

```bash
python3 -m venv .venv
.venv/bin/pip install pymupdf pillow pikepdf
```

## `optimize-pdf.py`

Shrinks a prospectus for web delivery. Roughly 90% of the originals was image
data stored as JPEG 2000 at up to 2438x1676 for an A4-landscape page — far more
detail than the viewer can show, and a format pdf.js can only decode by pulling
its OpenJPEG WASM module and running it in software.

The script right-sizes every image to the box it's actually drawn into at
150 DPI, re-encodes to baseline JPEG, shrinks the matching alpha masks, merges
duplicate image streams, and writes a linearized file so pdf.js can render
page 1 without downloading the rest.

```bash
.venv/bin/python scripts/optimize-pdf.py pdf-source/UG26.original.pdf public/pdfs/UG26.pdf
.venv/bin/python scripts/optimize-pdf.py pdf-source/PG26.original.pdf public/pdfs/PG26.pdf
```

Results on the 2026 prospectuses:

| File | Before | After | First-page bytes |
| --- | --- | --- | --- |
| UG26 | 35.9 MB | 6.1 MB | 1.04 MB -> 190 KB |
| PG26 | 27.4 MB | 4.4 MB | 8.06 MB -> 509 KB |

Median per-page PSNR against the originals is ~47 dB, i.e. visually
indistinguishable. Keep the print-quality masters in `pdf-source/` (outside
`public/`, so they are never deployed) and always re-run from those rather than
from an already-optimized file.

Two things this script deliberately avoids:

- MuPDF's `clean=True`, which rewrites some layered headings incorrectly
  (PG page 11 renders "UsUs").
- Dropping `/SMask` links, which flattens cut-out photos onto white boxes.

## `make-covers.py`

Renders page 1 of each PDF to `public/covers/`. The landing page uses these
instead of opening the PDFs through pdf.js, which previously cost ~1 MB (UG) and
~8 MB (PG) of range requests before the cards appeared.

```bash
.venv/bin/python scripts/make-covers.py
```
