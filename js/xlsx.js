/* Minimal XLSX reader. No external libraries — an .xlsx is a ZIP of XML, and
   modern Chrome/Edge can inflate it natively via DecompressionStream.
   This keeps the whole app runnable from a network share with no internet. */

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOC = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;

/* ---------- ZIP ---------- */

function findEOCD(view, bytes) {
  // EOCD is at the end, but a trailing comment can push it back up to 64KB.
  const min = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  throw new Error('Not a valid .xlsx file (no ZIP end-of-directory record found).');
}

function readDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEOCD(view, bytes);

  let count = view.getUint16(eocd + 10, true);
  let dirOffset = view.getUint32(eocd + 16, true);

  // ZIP64: the 32-bit fields saturate and the real values live in a separate record.
  if (dirOffset === 0xffffffff || count === 0xffff) {
    const locatorOff = eocd - 20;
    if (locatorOff >= 0 && view.getUint32(locatorOff, true) === SIG_EOCD64_LOC) {
      const z64 = Number(view.getBigUint64(locatorOff + 8, true));
      if (view.getUint32(z64, true) === SIG_EOCD64) {
        count = Number(view.getBigUint64(z64 + 32, true));
        dirOffset = Number(view.getBigUint64(z64 + 48, true));
      }
    }
  }

  const entries = new Map();
  let p = dirOffset;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== SIG_CENTRAL) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, bytes, view };
}

async function inflate(raw) {
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readFile(zip, name) {
  const e = zip.entries.get(name);
  if (!e) return null;
  // The central directory's sizes are authoritative, but the data offset must be
  // computed from the local header (its name/extra lengths can differ).
  const lh = e.localOffset;
  const nameLen = zip.view.getUint16(lh + 26, true);
  const extraLen = zip.view.getUint16(lh + 28, true);
  const start = lh + 30 + nameLen + extraLen;
  const raw = zip.bytes.subarray(start, start + e.compSize);
  const out = e.method === 0 ? raw : await inflate(raw);
  return new TextDecoder().decode(out);
}

/* ---------- XLSX ---------- */

// Excel's epoch is 1899-12-30 (the offset already absorbs the fake 1900 leap year).
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

export function serialToDate(serial) {
  if (typeof serial !== 'number' || !isFinite(serial)) return null;
  const d = new Date(EXCEL_EPOCH + Math.round(serial * 86400000));
  return isNaN(d.getTime()) ? null : d;
}

const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function parseStyles(xml) {
  // Map each cellXfs index -> is it a date format? Needed because date cells are
  // just numbers; only the style tells them apart from a quantity.
  if (!xml) return [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  const customDate = new Set();
  for (const nf of doc.getElementsByTagName('numFmt')) {
    const id = Number(nf.getAttribute('numFmtId'));
    const code = (nf.getAttribute('formatCode') || '').replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '');
    if (/[ymdhs]/i.test(code)) customDate.add(id);
  }

  const cellXfs = doc.getElementsByTagName('cellXfs')[0];
  if (!cellXfs) return [];
  return Array.from(cellXfs.getElementsByTagName('xf')).map((xf) => {
    const id = Number(xf.getAttribute('numFmtId') || 0);
    return BUILTIN_DATE_FMTS.has(id) || customDate.has(id);
  });
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return Array.from(doc.getElementsByTagName('si')).map((si) => {
    // Rich-text runs split one logical string across several <t> nodes.
    let out = '';
    for (const t of si.getElementsByTagName('t')) out += t.textContent;
    return out;
  });
}

function colToIndex(ref) {
  // "BC12" -> 54 (1-based column number)
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n;
}

function parseSheet(xml, shared, dateStyles, maxRows) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const rows = [];
  let widest = 0;

  for (const row of doc.getElementsByTagName('row')) {
    if (rows.length >= maxRows) break;
    const cells = [];
    let any = false;

    for (const c of row.getElementsByTagName('c')) {
      const ref = c.getAttribute('r') || '';
      const idx = colToIndex(ref);
      if (!idx) continue;
      const type = c.getAttribute('t');
      let value = null;

      if (type === 'inlineStr') {
        let s = '';
        for (const t of c.getElementsByTagName('t')) s += t.textContent;
        value = s || null;
      } else {
        const v = c.getElementsByTagName('v')[0];
        if (v != null) {
          const raw = v.textContent;
          if (type === 's') {
            value = shared[Number(raw)] ?? null;
          } else if (type === 'e') {
            // #REF!, #VALUE!, #N/A — surfaced so the importer can report them.
            value = { error: raw };
          } else if (type === 'str' || type === 'b') {
            value = type === 'b' ? raw === '1' : raw;
          } else {
            const num = Number(raw);
            if (isFinite(num)) {
              const styleIdx = Number(c.getAttribute('s') || 0);
              value = dateStyles[styleIdx] ? serialToDate(num) : num;
            } else {
              value = raw || null;
            }
          }
        }
      }

      if (value !== null && value !== '') any = true;
      cells[idx - 1] = value ?? null;
      if (idx > widest) widest = idx;
    }

    const r = Number(row.getAttribute('r') || rows.length + 1);
    rows.push({ r, cells, empty: !any });
  }

  return { rows, width: widest };
}

/**
 * Read an .xlsx into { sheetNames, hiddenSheets, sheets: { [name]: { rows, width } } }.
 * `only` limits which sheets are parsed — important here because the workbook
 * contains a 1M-row scratch sheet we never need. It takes a list of names, or
 * a predicate for the sheets whose names are only known by pattern.
 */
export async function readXlsx(arrayBuffer, { only = null, maxRows = 25000 } = {}) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'This browser cannot unzip files natively. Use Chrome or Edge (version 103 or newer).'
    );
  }

  const zip = readDirectory(new Uint8Array(arrayBuffer));

  const [wbXml, relsXml, ssXml, stylesXml] = await Promise.all([
    readFile(zip, 'xl/workbook.xml'),
    readFile(zip, 'xl/_rels/workbook.xml.rels'),
    readFile(zip, 'xl/sharedStrings.xml'),
    readFile(zip, 'xl/styles.xml'),
  ]);
  if (!wbXml) throw new Error('That file is not an Excel workbook (xl/workbook.xml missing).');

  const shared = parseSharedStrings(ssXml);
  const dateStyles = parseStyles(stylesXml);

  const relTarget = new Map();
  if (relsXml) {
    const relDoc = new DOMParser().parseFromString(relsXml, 'application/xml');
    for (const rel of relDoc.getElementsByTagName('Relationship')) {
      relTarget.set(rel.getAttribute('Id'), rel.getAttribute('Target'));
    }
  }

  const wbDoc = new DOMParser().parseFromString(wbXml, 'application/xml');
  const sheetNames = [];
  /* Which tabs Excel hides. Worth surfacing: in the department's workbooks a
     hidden sheet is one they have archived — 58 of the CNC workbook's 73
     sheets are hidden — so visibility is the best available signal for which
     of several similarly-named sheets is the live one. */
  const hiddenSheets = new Set();
  const targets = new Map();
  for (const sh of wbDoc.getElementsByTagName('sheet')) {
    const name = sh.getAttribute('name');
    const rid =
      sh.getAttribute('r:id') ||
      sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    sheetNames.push(name);
    if ((sh.getAttribute('state') || 'visible') !== 'visible') hiddenSheets.add(name);
    let target = relTarget.get(rid) || '';
    target = target.replace(/^\/xl\//, '').replace(/^\//, '');
    targets.set(name, target.startsWith('xl/') ? target : 'xl/' + target);
  }

  const keep = typeof only === 'function' ? only : (n) => only.includes(n);
  const wanted = only ? sheetNames.filter(keep) : sheetNames;
  const sheets = {};
  for (const name of wanted) {
    const xml = await readFile(zip, targets.get(name));
    if (!xml) continue;
    sheets[name] = parseSheet(xml, shared, dateStyles, maxRows);
  }

  return { sheetNames, hiddenSheets, sheets };
}
