#!/usr/bin/env python3
"""Turn the Sub-Assembly Section Book drawings into the app's die pictures.

Each series has a drawings PDF with one page per sub-assembly: a section
through the assembled profile, dimensioned, with every component called out
where it sits. That last part is the reason to have the picture at all — the
listing says 80-113 is the exterior, the drawing shows you which piece that is.

The page also carries a revision table, a components table and a title block.
The tables repeat data the app already has and the title block is letterhead,
so the drawing area is cropped out and the rest dropped. That plus 1-bit
encoding takes a page from ~280KB of PDF to about 3KB of WebP, which is what
makes it possible to carry 900-odd of them inside a single offline file.

Where a series' drawing sheets cannot be got hold of, the listing's own
Assembly Diagram thumbnails stand in — smaller and without the callouts, but a
real picture of the profile. Those are produced by extract-listing-thumbs.py
and merged here; the sheet always wins, and which one was used is recorded so
the app can say.

Usage: tools/extract-drawings.py <dir-of-pdfs> <out.js> [thumbs.json]
"""

import base64
import io
import os
import re
import subprocess
import sys
import tempfile

from PIL import Image

DPI = 150
WIDTH = 720           # rendered width of the cropped drawing
THRESHOLD = 170       # line art is black on white; anything grey is an artefact

# Proportions of the page holding the drawing itself. The books are one
# AutoCAD template, so these hold across series — the crop is then tightened
# to the actual ink, which absorbs the variation between drawings.
CROP = (0.065, 0.115, 0.945, 0.705)

SA_RE = re.compile(r'\bSA\d{2}-\d{3}[A-Z]*\b')


def pages_of(pdf):
    """The sub-assembly number on each page, by page number."""
    text = subprocess.run(['pdftotext', '-layout', pdf, '-'],
                          capture_output=True, text=True, check=True).stdout
    out = {}
    for i, page in enumerate(text.split('\f'), start=1):
        # The drawing number in the title block is the last one on the page;
        # callouts elsewhere name other assemblies this one references.
        found = SA_RE.findall(page)
        if found:
            out[i] = found[-1]
    return out


def render(pdf, page, tmp):
    stem = os.path.join(tmp, 'p')
    subprocess.run(['pdftoppm', '-png', '-r', str(DPI), '-f', str(page), '-l', str(page),
                    pdf, stem], check=True, capture_output=True)
    for f in os.listdir(tmp):
        if f.startswith('p') and f.endswith('.png'):
            return os.path.join(tmp, f)
    return None


def encode(png_path):
    im = Image.open(png_path).convert('L')
    w, h = im.size
    im = im.crop((int(w * CROP[0]), int(h * CROP[1]), int(w * CROP[2]), int(h * CROP[3])))

    # Tighten to the ink so a drawing that sits high or low on the sheet still
    # fills the frame.
    bbox = Image.eval(im, lambda x: 255 - x).getbbox()
    if bbox:
        pad = 8
        im = im.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad),
                      min(im.width, bbox[2] + pad), min(im.height, bbox[3] + pad)))
    if im.width < 40 or im.height < 40:
        return None

    height = max(1, round(im.height * WIDTH / im.width))
    im = im.resize((WIDTH, height), Image.LANCZOS).point(lambda x: 255 if x > THRESHOLD else 0, '1')

    buf = io.BytesIO()
    im.convert('L').save(buf, 'WEBP', lossless=True, method=6)
    return base64.b64encode(buf.getvalue()).decode('ascii')


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    src, out_path = sys.argv[1], sys.argv[2]
    thumbs_path = sys.argv[3] if len(sys.argv) > 3 else None

    drawings = {}
    source = {}
    for name in sorted(os.listdir(src)):
        if not name.endswith('.pdf'):
            continue
        pdf = os.path.join(src, name)
        try:
            pages = pages_of(pdf)
        except subprocess.CalledProcessError:
            print(f'{name:44} unreadable', file=sys.stderr)
            continue

        added = 0
        for page, sa in pages.items():
            if sa in drawings:
                continue
            with tempfile.TemporaryDirectory() as tmp:
                png = render(pdf, page, tmp)
                if not png:
                    continue
                data = encode(png)
            if data:
                drawings[sa] = data
                source[sa] = 'sheet'
                added += 1
        print(f'{name:44} {added:4} drawings', file=sys.stderr)

    if thumbs_path and os.path.exists(thumbs_path):
        import json
        filled = 0
        for sa, data in json.load(open(thumbs_path)).items():
            if sa in drawings:
                continue
            drawings[sa] = data
            source[sa] = 'listing'
            filled += 1
        print(f'{"listing thumbnails":44} {filled:4} gaps filled', file=sys.stderr)

    total = sum(len(v) for v in drawings.values())
    print(f'\n{len(drawings)} drawings, {total * 3 // 4 // 1024} KB of image data', file=sys.stderr)

    with open(out_path, 'w') as f:
        f.write('/* Die drawings — generated, do not edit by hand.\n\n'
                '   Built by tools/extract-drawings.py from the Sub-Assembly Section Book\n'
                '   drawing PDFs. One section per sub-assembly, cropped to the drawing\n'
                '   itself and encoded 1-bit: the tables and title block on each sheet\n'
                '   repeat what the app already knows, and dropping them is most of what\n'
                '   makes %d of these fit inside a single offline file.\n\n'
                '   Keyed by sub-assembly number; values are the WebP body, so the data\n'
                '   URI prefix is added once at use rather than %d times here. */\n\n'
                % (len(drawings), len(drawings)))
        f.write('export const DRAWING_PREFIX = \'data:image/webp;base64,\';\n\n')
        f.write('export const DRAWINGS = {\n')
        for sa in sorted(drawings):
            f.write(f'  {sa!r}: \'{drawings[sa]}\',\n'.replace("'", '"', 2))
        f.write('};\n\n')
        f.write('/* Which kind of picture each one is: the full dimensioned sheet, or the\n'
                '   listing\'s smaller Assembly Diagram standing in for a sheet not in hand. */\n')
        f.write('export const DRAWING_SOURCE = {\n')
        for sa in sorted(source):
            if source[sa] != 'sheet':
                f.write(f'  "{sa}": "{source[sa]}",\n')
        f.write('};\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
