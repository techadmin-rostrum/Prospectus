#!/usr/bin/env python3
"""
Shrink a prospectus by right-sizing its images.

~90% of these files is image data, stored as JPEG 2000 at up to 2438x1676 for
a 842x595pt (A4 landscape) page. That's far more detail than the viewer can
ever show, and JPX is also slow for pdf.js to decode on phones.

For every image we work out the largest box it's actually drawn into, downsample
to that box at TARGET_DPI, and re-encode as baseline JPEG. Output stays
linearized so pdf.js can keep opening page 1 without the whole file.

Always run this against the master in pdf-source/, never against an already
optimized file, or the images get re-encoded a second time.

Usage:  python scripts/optimize-pdf.py pdf-source/UG26.original.pdf public/pdfs/UG26.v2.pdf
Requires: pip install pymupdf pillow pikepdf
"""

import argparse
import hashlib
import io
import pathlib

import pikepdf
import pymupdf
from PIL import Image

# A 842pt-wide page shown full-screen on a 2x display is ~1700px => ~145 DPI.
TARGET_DPI = 150
JPEG_QUALITY = 80
# Leave tiny assets (logos, icons, rules) alone — re-encoding them costs more
# in artefacts than it saves in bytes.
MIN_BYTES = 24 * 1024


def dedupe_images(pdf) -> int:
    """Point every copy of an identical image stream at one shared object.

    Re-encoding leaves the same photo stored once per placement. MuPDF's
    clean=True used to collapse those, but it also corrupts some headings, so
    the merge happens here instead. qpdf then drops whatever is unreferenced.
    """
    canonical = {}
    remap = {}

    for obj in pdf.objects:
        try:
            if obj.get("/Subtype") != pikepdf.Name("/Image"):
                continue
            raw = obj.read_raw_bytes()
        except Exception:
            continue

        shape = tuple(
            str(obj.get(k)) for k in ("/Width", "/Height", "/BitsPerComponent", "/Filter", "/ImageMask")
        )
        key = (hashlib.sha1(raw).hexdigest(), shape)

        if key in canonical:
            remap[obj.objgen] = canonical[key]
        else:
            canonical[key] = obj

    if not remap:
        return 0

    # Resource dictionaries are often direct children of a page, so the rewrite
    # has to recurse rather than just scan pdf.objects.
    seen = set()

    def rewrite(node):
        try:
            gen = node.objgen
        except Exception:
            return
        if gen != (0, 0):
            if gen in seen:
                return
            seen.add(gen)

        if isinstance(node, pikepdf.Array):
            for i, v in enumerate(node):
                target = remap.get(getattr(v, "objgen", (0, 0)))
                if target is not None:
                    node[i] = target
                else:
                    rewrite(v)
            return

        if isinstance(node, (pikepdf.Dictionary, pikepdf.Stream)):
            for k, v in node.items():
                target = remap.get(getattr(v, "objgen", (0, 0)))
                if target is not None:
                    node[k] = target
                else:
                    rewrite(v)

    rewrite(pdf.Root)
    for page in pdf.pages:
        rewrite(page.obj)

    return len(remap)


def shrink_smask(doc, xref, target_w, target_h, quality):
    """Bring an alpha mask down to its base image's new size, as grayscale JPEG.

    Masks are never listed as page images, so the main loop never sees them and
    they stay at full resolution (often JPEG 2000) long after the photo they
    belong to has shrunk. Returns (bytes_before, bytes_after).
    """
    try:
        raw_before = len(doc.xref_stream_raw(xref))
        pix = pymupdf.Pixmap(doc, xref)
        img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("L")
    except Exception:
        return (0, 0)

    if img.width > target_w or img.height > target_h:
        img = img.resize((target_w, target_h), Image.LANCZOS)

    buf_io = io.BytesIO()
    img.save(buf_io, format="JPEG", quality=quality, optimize=True)
    buf = buf_io.getvalue()

    try:
        doc.update_stream(xref, buf, new=False, compress=False)
        doc.xref_set_key(xref, "Filter", "/DCTDecode")
        doc.xref_set_key(xref, "Width", str(img.width))
        doc.xref_set_key(xref, "Height", str(img.height))
        doc.xref_set_key(xref, "BitsPerComponent", "8")
        doc.xref_set_key(xref, "ColorSpace", "/DeviceGray")
        doc.xref_set_key(xref, "DecodeParms", "null")
    except Exception:
        return (0, 0)

    return (raw_before, len(buf))


def drawn_sizes(doc):
    """Largest width/height in points each image is drawn at, plus a host page."""
    sizes = {}
    for page in doc:
        for img in page.get_images(full=True):
            xref = img[0]
            for r in page.get_image_rects(xref):
                w, h, _ = sizes.get(xref, (0.0, 0.0, page))
                sizes[xref] = (max(w, r.width), max(h, r.height), page)
    return sizes


def optimize(src: pathlib.Path, dst: pathlib.Path, dpi: int, quality: int) -> None:
    doc = pymupdf.open(src)

    sizes = drawn_sizes(doc)
    scale = dpi / 72.0

    replaced = 0
    before = after = 0

    for xref in sorted(sizes):
        try:
            info = doc.extract_image(xref)
        except Exception:
            continue

        raw = info["image"]
        # JPEG 2000 makes pdf.js pull its 1.5 MB OpenJPEG WASM decoder and then
        # decode in software, which is painful on phones. Convert every one of
        # them to baseline JPEG even when the byte count doesn't improve.
        is_jpx = info.get("ext") == "jpx"
        if len(raw) < MIN_BYTES and not is_jpx:
            continue

        draw_w, draw_h, host_page = sizes[xref]
        if draw_w <= 0 or draw_h <= 0:
            continue

        target_w = max(1, int(draw_w * scale))
        target_h = max(1, int(draw_h * scale))

        # MuPDF decodes JPX/PNG/etc. reliably; Pillow then handles the resample.
        try:
            pix = pymupdf.Pixmap(doc, xref)
            if pix.alpha or (pix.colorspace and pix.colorspace.n not in (1, 3)):
                pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
            img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
        except Exception:
            continue

        if img.width > target_w or img.height > target_h:
            factor = max(img.width / target_w, img.height / target_h)
            img = img.resize(
                (max(1, round(img.width / factor)), max(1, round(img.height / factor))),
                Image.LANCZOS,
            )

        buf_io = io.BytesIO()
        # Baseline, not progressive: browsers decode it faster and the whole
        # stream has to arrive before the page paints anyway.
        img.save(buf_io, format="JPEG", quality=quality, optimize=True)
        buf = buf_io.getvalue()

        # Only take the swap when it's smaller, unless we're getting rid of JPX.
        if len(buf) >= len(raw) and not is_jpx:
            continue

        # Cut-out photos keep their transparency in a separate /SMask object.
        # replace_image writes a fresh image dict, so the link has to be put
        # back or those images flatten onto opaque white boxes.
        try:
            smask_type, smask_val = doc.xref_get_key(xref, "SMask")
        except Exception:
            smask_type = smask_val = None

        # Swapping through any page that hosts the image rewrites the shared
        # xref, so every other placement of it picks up the new data too.
        try:
            host_page.replace_image(xref, stream=buf)
        except Exception:
            continue

        if smask_type == "xref":
            doc.xref_set_key(xref, "SMask", smask_val)
            smask_xref = int(smask_val.split()[0])
            saved = shrink_smask(doc, smask_xref, img.width, img.height, quality)
            before += saved[0]
            after += saved[1]

        before += len(raw)
        after += len(buf)
        replaced += 1

    # MuPDF can no longer linearize, so it does the rewrite and qpdf (via
    # pikepdf) produces the final web-optimized file. Linearization is what lets
    # pdf.js render page 1 without pulling the whole document.
    # No clean=True here: MuPDF's content-stream sanitizer rewrites some of the
    # layered/outlined headings incorrectly (PG p11 renders "UsUs"), and it buys
    # almost nothing once qpdf has compressed the streams.
    staged = dst.with_suffix(".staged.pdf")
    doc.save(staged, garbage=4, deflate=True, deflate_images=True, deflate_fonts=True)
    doc.close()

    with pikepdf.open(staged) as pdf:
        merged = dedupe_images(pdf)
        pdf.remove_unreferenced_resources()
        pdf.save(dst, linearize=True, compress_streams=True)
    staged.unlink()
    print(f"  merged {merged} duplicate image streams")

    print(
        f"{src.name}: replaced {replaced}/{len(sizes)} images "
        f"({before / 1e6:.1f} MB -> {after / 1e6:.1f} MB of image data)"
    )
    print(
        f"  file {src.stat().st_size / 1e6:.1f} MB -> {dst.stat().st_size / 1e6:.1f} MB "
        f"({dst.stat().st_size / src.stat().st_size * 100:.0f}%)"
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", type=pathlib.Path)
    ap.add_argument("dst", type=pathlib.Path)
    ap.add_argument("--dpi", type=int, default=TARGET_DPI)
    ap.add_argument("--quality", type=int, default=JPEG_QUALITY)
    args = ap.parse_args()

    optimize(args.src, args.dst, args.dpi, args.quality)


if __name__ == "__main__":
    main()
