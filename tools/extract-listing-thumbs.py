#!/usr/bin/env python3
"""Pull the Assembly Diagram thumbnails out of the Section Book listing PDFs.

The full drawing sheets are the better picture — dimensioned, with every
component called out where it sits — but they are also the biggest files in
the book, and some cannot be got hold of. The listings carry a small profile
diagram per row in their first column, and a small true picture beats no
picture, so this extracts those as a fallback.

Each listing page is a fixed table: the assembly number sits in its own
column at a constant x, and rows are evenly spaced. So the row bands are read
off the positions of those numbers rather than guessed at, which keeps this
working when a page holds fewer than a full set of rows.

Usage: tools/extract-listing-thumbs.py <dir-of-listing-pdfs> <out.json>
"""

import base64
import io
import json
import os
import re
import subprocess
import sys
import tempfile

from PIL import Image

DPI = 300
PT = DPI / 72.0          # points -> pixels at the render resolution
WIDTH = 760              # rendered width; the source cell is ~770px at 300dpi

# The Assembly Diagram column, in points across a 612pt letter page.
DIAGRAM_X = (30, 215)
# The Assembly No. column, used to find rows. Anything outside it is a
# cross-reference in the description ("Discontinued - Use SA80-251").
NUMBER_X = (200, 292)

WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(SA\d{2}-\d{3}[A-Z]*)</word>')


def rows_of(pdf):
    """Assembly number -> (page, y-centre in points), from the number column."""
    out = []
    xml = subprocess.run(['pdftotext', '-bbox', pdf, '-'],
                         capture_output=True, text=True, check=True).stdout
    page = 0
    for line in xml.split('\n'):
        if '<page ' in line:
            page += 1
            continue
        m = WORD.search(line)
        if not m:
            continue
        x0, y0, x1, y1, sa = float(m[1]), float(m[2]), float(m[3]), float(m[4]), m[5]
        if not (NUMBER_X[0] <= x0 <= NUMBER_X[1]):
            continue
        out.append((page, sa, (y0 + y1) / 2))
    return out


def band(rows, i):
    """Half-height of a row, from the gap to its neighbours on the same page."""
    page, _, y = rows[i]
    gaps = []
    for j in (i - 1, i + 1):
        if 0 <= j < len(rows) and rows[j][0] == page:
            gaps.append(abs(rows[j][2] - y))
    return (min(gaps) if gaps else 66.0) / 2


def encode(page_img, y_centre, half):
    x0, x1 = int(DIAGRAM_X[0] * PT), int(DIAGRAM_X[1] * PT)
    y0 = max(0, int((y_centre - half) * PT))
    y1 = min(page_img.height, int((y_centre + half) * PT))
    cell = page_img.crop((x0, y0, x1, y1))

    bbox = Image.eval(cell, lambda v: 255 - v).getbbox()
    if not bbox:
        return None                      # an empty cell, nothing drawn
    pad = 6
    cell = cell.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad),
                      min(cell.width, bbox[2] + pad), min(cell.height, bbox[3] + pad)))
    if cell.width < 60 or cell.height < 25:
        return None

    h = max(1, round(cell.height * WIDTH / cell.width))
    cell = cell.resize((WIDTH, h), Image.LANCZOS).point(lambda v: 255 if v > 175 else 0, '1')
    buf = io.BytesIO()
    cell.convert('L').save(buf, 'WEBP', lossless=True, method=6)
    return base64.b64encode(buf.getvalue()).decode('ascii')


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    src, out_path = sys.argv[1], sys.argv[2]

    thumbs = {}
    for name in sorted(os.listdir(src)):
        if not name.endswith('.pdf'):
            continue
        pdf = os.path.join(src, name)
        rows = rows_of(pdf)
        added = 0

        with tempfile.TemporaryDirectory() as tmp:
            pages = {}
            for i, (page, sa, y) in enumerate(rows):
                if sa in thumbs:
                    continue
                if page not in pages:
                    stem = os.path.join(tmp, f'p{page}')
                    subprocess.run(['pdftoppm', '-png', '-r', str(DPI),
                                    '-f', str(page), '-l', str(page), pdf, stem],
                                   check=True, capture_output=True)
                    found = [f for f in os.listdir(tmp) if f.startswith(f'p{page}-')]
                    if not found:
                        continue
                    pages[page] = Image.open(os.path.join(tmp, found[0])).convert('L')
                data = encode(pages[page], y, band(rows, i))
                if data:
                    thumbs[sa] = data
                    added += 1

        print(f'{name:44} {added:4} thumbnails', file=sys.stderr)

    size = sum(len(v) for v in thumbs.values()) * 3 // 4 // 1024
    print(f'\n{len(thumbs)} thumbnails, {size} KB', file=sys.stderr)
    with open(out_path, 'w') as f:
        json.dump(thumbs, f)
    return 0


if __name__ == '__main__':
    sys.exit(main())
