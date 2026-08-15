"""Build searchable extrusion records and cell images from the engineering masters.

The AutoCAD metadata tables are plotted as paths rather than selectable PDF
text, so this is intentionally an offline generation step. The tracker itself
does not gain an OCR or PDF dependency.

Temporary dependency used by this generator:
  python -m pip install --target tmp/pylibs rapidocr-onnxruntime
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCAL_LIBS = ROOT / "tmp" / "pylibs"
if LOCAL_LIBS.exists():
    sys.path.insert(0, str(LOCAL_LIBS))

import pdfplumber
from PIL import Image
from rapidocr_onnxruntime import RapidOCR


SERIES = ["2000", "8000", "8100", "8200", "8300", "8400",
          "8500", "8600", "8700", "8800", "8900", "8950"]
REVISION_PAGES = {"8700": {1, 2}, "8900": {1, 2}}
# These cells were read directly from the rendered engineering cards during
# QA. They are the small set where OCR confused a plotted digit with a nearby
# profile callout, or where the internal number deliberately breaks the usual
# NN-NNN pattern.
ID_CORRECTIONS = {
    ("2000", 2, 4, 4): "20-016",
    ("2000", 14, 5, 1): "24-77",
    ("8400", 5, 1, 1): "A&P",
    ("8700", 4, 5, 1): "87-037",
    ("8700", 5, 1, 2): "87-042",
    ("8700", 5, 2, 2): "87-046",
    ("8700", 5, 3, 2): "87-050",
    ("8700", 5, 3, 3): "87-051",
    ("8700", 5, 4, 1): "87-053",
    ("8700", 5, 4, 2): "87-054",
    ("8700", 5, 4, 3): "87-055",
    ("8700", 6, 1, 2): "87-062",
    ("8700", 9, 3, 3): "87-131",
    ("8700", 9, 3, 4): "87-132",
    ("8700", 9, 4, 1): "87-133",
    ("8700", 9, 4, 3): "87-135",
    ("8700", 9, 4, 4): "87-136",
    ("8700", 15, 1, 1): "87-401A / 87-401P",
    ("8700", 17, 1, 2): "87-442",
    ("8700", 17, 1, 3): "87-443",
    ("8700", 17, 1, 4): "87-444",
    ("8700", 17, 2, 2): "87-446",
    ("8800", 4, 4, 1): "88-053",
    ("8800", 4, 4, 2): "88-054",
    ("8800", 7, 4, 3): "88-115",
    ("8800", 10, 2, 4): "88-308",
    ("8950", 4, 2, 2): "89-086",
    ("8950", 4, 2, 3): "89-087",
    ("8950", 8, 1, 1): "89-261",
    ("8950", 8, 1, 2): "89-262",
    ("8950", 10, 2, 4): "89-368",
}
SOURCE_ROOT = Path(r"\\FS\engineering\Design Group\BVGlazing Systems\01 - Window Series\Active Extrusions")
PDF_NAME = "EX-Master Template - {series} Series Extrusions.pdf"
PDFTOPPM = Path(
    r"C:\Users\abhay.badhwar\.cache\codex-runtimes\codex-primary-runtime"
    r"\dependencies\native\poppler\Library\bin\pdftoppm.exe"
)

# All twelve masters use the same 4 × 5 cell template. These are measured on
# the 120-dpi render; scaling from width keeps the crop stable at any DPI.
BASE_WIDTH = 2040
X_EDGES = [119, 555, 990, 1425, 1862]
Y_EDGES = [44, 291, 537, 783, 1030, 1278]
TABLE_LABEL_WIDTH = 76
TABLE_HEIGHT = 68


def clean_line(value: str) -> str:
    value = re.sub(r"\s+", " ", value.replace("~", "-").replace("�", '"')).strip(" |-_")
    if value and all(ch in "一二-—_=| " for ch in value):
        return ""
    return value


def clean_description(value: str) -> str:
    value = clean_line(value)
    fixes = {
        "originol": "original", "glozing": "glazing", "spondrel": "spandrel",
        "horizontol": "horizontal", "comer": "corner", "bose": "base",
        "interor": "interior", "frome": "frame",
    }
    for wrong, right in fixes.items():
        value = re.sub(rf"\b{wrong}\b", right, value, flags=re.IGNORECASE)
    return value


def allowed_prefixes(series: str) -> set[str]:
    return {str(n) for n in range(20, 30)} if series == "2000" else {series[:2]}


def normalize_internal(raw: str, series: str) -> str | None:
    compact = re.sub(r"[^A-Z0-9]", "", raw.upper())
    prefixes = allowed_prefixes(series)
    if len(prefixes) == 1:
        prefix = next(iter(prefixes))
        digits_only = re.sub(r"\D", "", compact)
        if len(digits_only) == 4 and digits_only[0] == prefix[0]:
            return f"{prefix}-{digits_only[-3:]}"
    if len(compact) < 5:
        return None

    # OCR occasionally drops the separator but is reliable at 240 dpi about
    # the five digits themselves. The series constrains the prefix so a
    # dimension elsewhere in a cell can never become an extrusion number.
    for prefix in allowed_prefixes(series):
        mapped = compact.replace("O", "0").replace("I", "1")
        pos = mapped.find(prefix)
        if pos < 0 or len(mapped) < pos + 5:
            continue
        number = mapped[pos + 2:pos + 5]
        if not number.isdigit():
            continue
        suffix = mapped[pos + 5:]
        suffix = suffix if re.fullmatch(r"[A-Z]\d?", suffix or "") else ""
        return f"{prefix}-{number}" + (f"-{suffix}" if suffix else "")

    # A bad first glyph (B0 instead of 80) should not discard a cell whose
    # remaining three digits are clean; the PDF chosen by the user supplies
    # the authoritative series prefix.
    tail = compact[2:]
    m = re.match(r"(\d{3})([A-Z]\d?)?$", tail)
    if len(prefixes) == 1 and m:
        prefix = next(iter(prefixes))
        return f"{prefix}-{m.group(1)}" + (f"-{m.group(2)}" if m.group(2) else "")
    return None


def band_text(items: list[dict], low: float, high: float) -> str:
    return clean_line(" ".join(i["text"] for i in items if low <= i["y"] < high))


def table_contact_sheet(image: Image.Image) -> tuple[Image.Image, int, int, float]:
    scale = image.width / BASE_WIDTH
    x_edges = [round(x * scale) for x in X_EDGES]
    y_edges = [round(y * scale) for y in Y_EDGES]
    label_width = round(TABLE_LABEL_WIDTH * scale)
    cell_width = x_edges[1] - x_edges[0] - label_width
    cell_height = round(TABLE_HEIGHT * scale)
    sheet = Image.new("RGB", (cell_width * 4, cell_height * 5), "white")
    for row in range(5):
        for col in range(4):
            x0, x1 = x_edges[col], x_edges[col + 1]
            y1 = y_edges[row + 1]
            crop = image.crop((x0 + label_width, y1 - cell_height, x1, y1))
            sheet.paste(crop, (col * cell_width, row * cell_height))
    return sheet, cell_width, cell_height, scale


def ocr_cells(engine: RapidOCR, image: Image.Image) -> list[list[dict]]:
    sheet, cell_width, cell_height, _ = table_contact_sheet(image)
    result, _ = engine(sheet)
    cells: list[list[dict]] = [[] for _ in range(20)]
    for box, text, score in result or []:
        cx = sum(point[0] for point in box) / 4
        cy = sum(point[1] for point in box) / 4
        col = min(3, int(cx / cell_width))
        row = min(4, int(cy / cell_height))
        cells[row * 4 + col].append({
            "text": text,
            "score": float(score),
            "y": cy - row * cell_height,
        })
    for cell in cells:
        cell.sort(key=lambda item: (item["y"], item["text"]))
    return cells


def cell_words(page, words: list[dict], row: int, col: int) -> list[str]:
    x0, x1 = X_EDGES[col] / BASE_WIDTH * page.width, X_EDGES[col + 1] / BASE_WIDTH * page.width
    y0, y1 = Y_EDGES[row] / 1360 * page.height, Y_EDGES[row + 1] / 1360 * page.height
    return [
        word["text"] for word in words
        if x0 <= (word["x0"] + word["x1"]) / 2 < x1
        and y0 <= (word["top"] + word["bottom"]) / 2 < y1
    ]


def internal_from_pdf_text(words: list[str], series: str) -> str | None:
    for word in words:
        candidate = normalize_internal(word, series)
        if candidate and re.search(r"[-._]", word):
            return candidate
    return None


def cell_status(words: list[str]) -> str:
    text = " ".join(words).upper()
    if "CANCELED" in text or "CANCELLED" in text:
        return "Cancelled"
    if "DISCONTINUED" in text:
        return "Discontinued"
    if "OBSOLETE" in text:
        return "Obsolete"
    return "Active"


def save_cell_image(image: Image.Image, row: int, col: int, target: Path) -> None:
    scale = image.width / BASE_WIDTH
    x_edges = [round(x * scale) for x in X_EDGES]
    y_edges = [round(y * scale) for y in Y_EDGES]
    pad = round(2 * scale)
    crop = image.crop((x_edges[col] + pad, y_edges[row] + pad,
                       x_edges[col + 1] - pad, y_edges[row + 1] - pad)).convert("L")
    width = 720
    crop = crop.resize((width, round(crop.height * width / crop.width)), Image.Resampling.LANCZOS)
    crop.save(target, "WEBP", quality=78, method=6)


def has_profile_drawing(image: Image.Image, row: int, col: int) -> bool:
    scale = image.width / BASE_WIDTH
    x_edges = [round(x * scale) for x in X_EDGES]
    y_edges = [round(y * scale) for y in Y_EDGES]
    pad = round(8 * scale)
    cell_height = y_edges[row + 1] - y_edges[row]
    # The metadata table starts below this point. Requiring ink above it keeps
    # reserved-but-empty Internal Number cells out of an extrusion drawing
    # lookup without discarding profiles whose supplier fields are blank.
    crop = image.crop((x_edges[col] + pad, y_edges[row] + pad,
                       x_edges[col + 1] - pad, y_edges[row] + round(cell_height * 0.65))).convert("L")
    histogram = crop.histogram()
    dark = sum(histogram[:235])
    return dark / max(1, crop.width * crop.height) > 0.0005


def render_page(pdf: Path, page_number: int, target_stem: Path) -> Path:
    subprocess.run([
        str(PDFTOPPM), "-f", str(page_number), "-l", str(page_number),
        "-r", "240", "-png", "-singlefile", str(pdf), str(target_stem),
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    return target_stem.with_suffix(".png")


def extract_series(series: str, output: Path) -> None:
    pdf = SOURCE_ROOT / PDF_NAME.format(series=series)
    work = output / "rendered"
    images = output / "images"
    work.mkdir(parents=True, exist_ok=True)
    images.mkdir(parents=True, exist_ok=True)
    for old_image in images.glob(f"*-{series}-p*.webp"):
        old_image.unlink()
    engine = RapidOCR()
    records: list[dict] = []
    warnings: list[dict] = []

    with pdfplumber.open(pdf) as document:
        total = len(document.pages)
        skipped = REVISION_PAGES.get(series, {1})
        for page_number, page in enumerate(document.pages, start=1):
            if page_number in skipped:
                print(f"{series}: page {page_number}/{total}, revision page skipped", flush=True)
                continue
            rendered = render_page(pdf, page_number, work / f"{series}-{page_number:03}")
            with Image.open(rendered) as opened:
                image = opened.convert("RGB")
            cells = ocr_cells(engine, image)
            page_words = page.extract_words(use_text_flow=False, keep_blank_chars=False)

            for index, items in enumerate(cells):
                row, col = divmod(index, 4)
                height = round(TABLE_HEIGHT * image.width / BASE_WIDTH)
                internal_raw = band_text(items, 0, height * 0.30)
                words = cell_words(page, page_words, row, col)
                internal_signal = len(re.findall(r"\d", internal_raw)) >= 3
                correction_key = (series, page_number, row + 1, col + 1)
                corrected = correction_key in ID_CORRECTIONS
                internal = ID_CORRECTIONS.get(correction_key) or normalize_internal(internal_raw, series)
                if not internal and internal_signal:
                    internal = internal_from_pdf_text(words, series)
                has_table = any(
                    item["score"] >= 0.55 and re.search(r"[A-Za-z0-9]{3}", item["text"])
                    for item in items
                )
                if not internal:
                    if has_table:
                        warnings.append({
                            "series": series, "page": page_number,
                            "row": row + 1, "col": col + 1,
                            "ocr": [clean_line(item["text"]) for item in items],
                        })
                    continue

                supplier = band_text(items, height * 0.30, height * 0.48)
                proposed = band_text(items, height * 0.48, height * 0.67)
                final_die = band_text(items, height * 0.67, height * 0.84)
                description = clean_description(band_text(items, height * 0.84, height * 1.05))
                if not has_profile_drawing(image, row, col):
                    continue
                image_stem = re.sub(r"[^A-Za-z0-9]+", "_", internal).strip("_")
                image_name = f"{image_stem}-{series}-p{page_number}-r{row + 1}c{col + 1}.webp"
                save_cell_image(image, row, col, images / image_name)
                records.append({
                    "id": internal,
                    "series": series,
                    "description": description,
                    "supplier": supplier,
                    "proposed": proposed,
                    "finalDie": final_die,
                    "status": cell_status(words),
                    "page": page_number,
                    "cell": f"r{row + 1}c{col + 1}",
                    "image": image_name,
                })

            rendered.unlink(missing_ok=True)
            print(f"{series}: page {page_number}/{total}, {len(records)} records, {len(warnings)} warnings", flush=True)

    (output / f"records-{series}.json").write_text(
        json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
    (output / f"warnings-{series}.json").write_text(
        json.dumps(warnings, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--series", choices=SERIES, required=True)
    parser.add_argument("--output", type=Path, default=ROOT / "tmp" / "extrusion-build")
    args = parser.parse_args()
    extract_series(args.series, args.output)


if __name__ == "__main__":
    main()
