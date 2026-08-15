#!/usr/bin/env python3
"""Replace one series in js/drawings.js from explicitly mapped PDF pages.

Some official drawing sets are scans, so their pages have no searchable title
block. A checked-in manifest records the page-to-assembly mapping instead of
guessing from OCR. Existing drawings outside the manifest's replace pattern
are copied byte-for-byte into the regenerated module.

Usage:
  replace-series-drawings.py <drawings.js> <manifest.json> <pdf-dir> [pdftoppm]
"""

import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile


def load_encoder():
    path = os.path.join(os.path.dirname(__file__), 'extract-drawings.py')
    spec = importlib.util.spec_from_file_location('extract_drawings', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_module(path):
    text = open(path, encoding='utf-8').read()
    drawings_text = text.split('export const DRAWINGS = {\n', 1)[1].split('\n};', 1)[0]
    source_text = text.split('export const DRAWING_SOURCE = {\n', 1)[1].split('\n};', 1)[0]
    # The original generator used double quotes for keys and single quotes for
    # bodies; later runs may use double quotes for both.
    entry = re.compile(r'''^  ["']([^"']+)["']: ["']([^"']*)["'],$''', re.MULTILINE)
    return dict(entry.findall(drawings_text)), dict(entry.findall(source_text))


def render(pdf, page, pdftoppm, encoder):
    scratch = os.path.join(os.getcwd(), 'tmp', 'drawing-render')
    os.makedirs(scratch, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=scratch) as tmp:
        stem = os.path.join(tmp, 'page')
        result = subprocess.run([
            pdftoppm, '-png', '-r', str(encoder.DPI), '-f', str(page),
            '-l', str(page), pdf, stem,
        ], capture_output=True, text=True)
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or f'pdftoppm failed for page {page}')
        pngs = [os.path.join(tmp, name) for name in os.listdir(tmp) if name.endswith('.png')]
        if len(pngs) != 1:
            raise RuntimeError(f'expected one rendered page for {pdf} page {page}')
        return encoder.encode(pngs[0])


def write_module(path, drawings, sources):
    total = sum(len(value) for value in drawings.values())
    with open(path, 'w', encoding='utf-8', newline='\n') as out:
        out.write('/* Die drawings — generated, do not edit by hand.\n\n'
                  '   Built from the Sub-Assembly Section Book drawing PDFs. One section\n'
                  '   per sub-assembly is cropped to the drawing itself and encoded 1-bit;\n'
                  '   tables and title blocks are omitted so the full library remains usable\n'
                  '   inside the single-file offline build.\n\n'
                  f'   {len(drawings)} drawings, {total * 3 // 4 // 1024} KB encoded. */\n\n')
        out.write("export const DRAWING_PREFIX = 'data:image/webp;base64,';\n\n")
        out.write('export const DRAWINGS = {\n')
        for sa in sorted(drawings):
            out.write(f'  "{sa}": \'{drawings[sa]}\',\n')
        out.write('};\n\n')
        out.write('/* Entries are only needed for fallback pictures; an omitted key is a\n'
                  '   full, dimensioned drawing sheet. */\n')
        out.write('export const DRAWING_SOURCE = {\n')
        for sa in sorted(sources):
            out.write(f'  "{sa}": "{sources[sa]}",\n')
        out.write('};\n')


def main():
    if len(sys.argv) not in (4, 5):
        print(__doc__)
        return 1

    drawings_path, manifest_path, pdf_dir = sys.argv[1:4]
    pdftoppm = sys.argv[4] if len(sys.argv) == 5 else 'pdftoppm'
    manifest = json.load(open(manifest_path, encoding='utf-8'))
    drawings, sources = read_module(drawings_path)
    replace = re.compile(manifest['replace'])
    removed = {sa for sa in drawings if replace.fullmatch(sa)}
    for sa in removed:
        drawings.pop(sa, None)
        sources.pop(sa, None)

    encoder = load_encoder()
    if 'crop' in manifest:
        encoder.CROP = tuple(manifest['crop'])
    added = set()
    for document in manifest['documents']:
        pdf = os.path.join(pdf_dir, document['file'])
        if not os.path.isfile(pdf):
            raise FileNotFoundError(pdf)
        for page_range in document['ranges']:
            first_page, last_page = page_range['pages']
            first_number = page_range['firstAssembly']
            for page in range(first_page, last_page + 1):
                number = first_number + page - first_page
                sa = manifest['assemblyFormat'].format(number=number)
                if sa in added:
                    raise RuntimeError(f'duplicate mapping for {sa}')
                data = render(pdf, page, pdftoppm, encoder)
                if not data:
                    raise RuntimeError(f'empty drawing for {sa}')
                drawings[sa] = data
                sources.pop(sa, None)
                added.add(sa)
                print(f'page {page:3}  {sa}', file=sys.stderr)

    expected = manifest['expectedDrawings']
    if len(added) != expected:
        raise RuntimeError(f'expected {expected} mapped drawings, got {len(added)}')
    write_module(drawings_path, drawings, sources)
    print(f'replaced {len(removed)} drawings with {len(added)} full sheets; '
          f'{len(drawings)} total', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
