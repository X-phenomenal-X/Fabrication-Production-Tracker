/* Read the separate Daily Schedule workbook. This is intentionally a narrow
   import: orders, dates, project identity and the Cutting status columns. It
   does not restore the retired purchasing workflow that once used this file.

   The CNC workbook has its own Daily Sched tab. That tab is not this import.
   Daily orders come only from the separate Daily Schedule file. */

import { readXlsx } from './xlsx.js';

export const DAILY_PARSER_VERSION = 3;
const SHEET = 'Daily Sched';
export const DAILY_SHEET = SHEET;
const PHANTOM_BEFORE = Date.UTC(1990, 0, 1);

const FALLBACK = {
  wo: 1, jobCode: 2, project: 3, floor: 4, qty: 5, notes: 6,
  series: 12, shipDate: 13, glazingDate: 15, cuttingDate: 16,
  cutStatus: 27, materialStatus: 41,
};

const ALIASES = {
  wo: [/^W\s*\/?\s*O\s*#?$/, /^WO\s*#?$/, /^WORK\s*ORDER/],
  jobCode: [/^JOB(\s*(CODE|#|NO\.?))?$/, /^JOB\s*ID$/],
  project: [/^PROJECT(\s*NAME)?$/],
  floor: [/^(FL|FLOOR|LEVEL)$/],
  qty: [/^(QTY|QUANTITY|TOTAL\s*QTY)$/],
  notes: [/^(NOTES?|COMMENTS?)$/],
  series: [/^SERIES$/],
  shipDate: [/SHIP.*DATE|DATE.*SHIP/],
  glazingDate: [/GLAZ.*DATE|DATE.*GLAZ/],
  cuttingDate: [/CUT(TING)?.*DATE|DATE.*CUT(TING)?/],
  cutStatus: [/^CUT(TING)?(\s*STATUS)?$/],
  materialStatus: [/^(MTL|MAT(ERIA)?L)(\s*STATUS)?$/],
  color: [/\bCOLOU?R\b/, /\bFINISH\b/],
};

function text(value) {
  if (value == null || typeof value === 'object') return null;
  const out = String(value).trim().replace(/\s+/g, ' ');
  return out || null;
}

function number(value) {
  if (value == null || value instanceof Date || typeof value === 'object') return null;
  const out = typeof value === 'number' ? value : Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(out) ? out : null;
}

function date(value) {
  if (value instanceof Date) {
    return value.getTime() >= PHANTOM_BEFORE ? value.toISOString().slice(0, 10) : null;
  }
  const raw = text(value);
  if (!raw || !/\b(19|20)\d{2}\b/.test(raw)) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

// Normalize department headers only. Exact tokens prevent WIDTH matching
// FRAME WIDTH, and CUT from colliding with CUTTING DATE or CUT STATUS.
function departmentHeader(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}
const DEPARTMENT_NAMES = Object.freeze({
  assembly: ['ASSEMBLY', 'ASSY'], vents: ['VENT', 'VENTS'],
  deframes: ['DEFRAME', 'DEFRAMES'], warehouse: ['WAREHOUSE'],
  hts: ['HTS'], widths: ['WIDTH', 'WIDTHS'], punch: ['PUNCH'],
  vtml: ['VTML'], sfs: ['SFS'],
  lvrsTcPan: ['LVRSTCPAN', 'LVRSTCPANEL', 'LVRSTCPANELS'],
});

function headerMap(sheet) {
  const headings = [];
  for (const row of sheet.rows.filter((row) => row.r <= 6)) {
    row.cells.forEach((value, index) => {
      const part = text(value);
      if (part) headings[index] = [headings[index], part].filter(Boolean).join(' ');
    });
  }
  const found = {};
  for (const [key, patterns] of Object.entries(ALIASES)) {
    // A bare CUT is a legacy status heading, but it must never outrank
    // CUT STATUS / CUTTING STATUS when both occur in the same workbook.
    // Keep all other legacy column aliases and fallback positions unchanged.
    const indexes = headings.flatMap((heading, index) =>
      patterns.some((pattern) => pattern.test(String(heading).toUpperCase())) ? [index] : []);
    if (!indexes.length) continue;
    const preferred = key === 'cutStatus'
      ? indexes.find((index) => /^CUT(?:TING)?\\s*STATUS$/.test(String(headings[index]).toUpperCase()))
      : undefined;
    found[key] = (preferred ?? indexes[0]) + 1;
  }
  // Match individual cells, not titles accumulated across multiple header rows.
  // Prefer the row containing W/O when available; otherwise inspect top rows.
  const top = sheet.rows.filter((row) => row.r <= 6);
  const headers = top.filter((row) => (row.cells || []).some((cell) =>
    ALIASES.wo.some((pattern) => pattern.test(String(cell || '').trim().toUpperCase()))));
  const candidates = headers.length ? headers : top;
  const reserved = new Set(Object.entries(found).filter(([key]) =>
    !Object.hasOwn(DEPARTMENT_NAMES, key)).map(([, index]) => index));
  for (const [key, names] of Object.entries(DEPARTMENT_NAMES)) {
    const matches = [];
    for (const row of candidates) row.cells.forEach((cell, index) => {
      if (names.includes(departmentHeader(cell)) && !reserved.has(index + 1)) matches.push(index + 1);
    });
    const unique = [...new Set(matches)];
    // Ambiguity must not silently bind the wrong manufacturing operation.
    if (unique.length === 1) { found[key] = unique[0]; reserved.add(unique[0]); }
  }
  return { ...FALLBACK, ...found, color: found.color || null };
}

function value(cells, col) {
  return col ? cells[col - 1] : null;
}

function sectionOf(cells) {
  const filled = cells.filter((item) => item != null && item !== '').length;
  if (filled > 5) return null;
  const candidate = cells.slice(0, 6).map(text).find(Boolean);
  if (!candidate) return null;
  const upper = candidate.toUpperCase();
  return /IN CUTTING|MAT.?L REQUIRED|ON HOLD|WINDOW WALL|SHIPPING|SCHEDULING|IN GLAZING|COMMERCIAL DOOR/.test(upper)
    ? upper.replace(/[.\s]+$/, '') : null;
}

/** The heading is a cell in the first rows, not a joined title-plus-header. */
export function dailySheetHasWorkOrderHeader(sheet) {
  if (!sheet?.rows) return false;
  for (const row of sheet.rows) {
    if (row.r > 6) break;
    for (const cell of row.cells || []) {
      const part = text(cell);
      if (!part) continue;
      const upper = part.toUpperCase();
      if (ALIASES.wo.some((pattern) => pattern.test(upper))) return true;
    }
  }
  return false;
}

function isOrder(value) {
  const raw = text(value);
  if (!raw) return false;
  return !/^(W\s*\/?\s*O\s*#?|WO\s*#?|QUEST|-+|PLEASE SEE SCHEDULER)/i.test(raw);
}

export async function importDailySchedule(arrayBuffer, { fileName = 'Daily Schedule.xlsx' } = {}) {
  const workbook = await readXlsx(arrayBuffer, { only: [SHEET], maxRows: 10000 });
  const sheet = workbook.sheets[SHEET];
  if (!sheet) {
    throw new Error(`This workbook has no "${SHEET}" sheet. Sheets found: ${workbook.sheetNames.join(', ')}`);
  }

  const columns = headerMap(sheet);
  const woHeaderFound = dailySheetHasWorkOrderHeader(sheet);
  const rows = [];
  const seen = new Map();
  let section = null;
  let skipped = 0;

  for (const row of sheet.rows) {
    if (row.r <= 2 || row.empty) continue;
    const nextSection = sectionOf(row.cells);
    if (nextSection) { section = nextSection; continue; }
    const wo = text(value(row.cells, columns.wo));
    const filled = row.cells.filter((item) => item != null && item !== '').length;
    if (!isOrder(wo) || filled <= 5) { if (wo) skipped++; continue; }

    const project = text(value(row.cells, columns.project));
    const floor = text(value(row.cells, columns.floor));
    const base = [wo, floor || '', project || ''].join('::');
    const occurrence = (seen.get(base) || 0) + 1;
    seen.set(base, occurrence);
    rows.push({
      id: occurrence === 1 ? base : `${base}#${occurrence}`,
      row: row.r,
      wo,
      jobCode: text(value(row.cells, columns.jobCode)),
      project,
      floor,
      qty: number(value(row.cells, columns.qty)),
      notes: text(value(row.cells, columns.notes)),
      series: text(value(row.cells, columns.series)),
      shipDate: date(value(row.cells, columns.shipDate)),
      glazingDate: date(value(row.cells, columns.glazingDate)),
      cuttingDate: date(value(row.cells, columns.cuttingDate)),
      cutStatus: text(value(row.cells, columns.cutStatus)),
      materialStatus: text(value(row.cells, columns.materialStatus)),
      color: text(value(row.cells, columns.color)),
      assembly: text(value(row.cells, columns.assembly)),
      vents: text(value(row.cells, columns.vents)),
      deframes: text(value(row.cells, columns.deframes)),
      warehouse: text(value(row.cells, columns.warehouse)),
      hts: text(value(row.cells, columns.hts)),
      widths: text(value(row.cells, columns.widths)),
      punch: text(value(row.cells, columns.punch)),
      vtml: text(value(row.cells, columns.vtml)),
      sfs: text(value(row.cells, columns.sfs)),
      lvrsTcPan: text(value(row.cells, columns.lvrsTcPan)),
      section,
    });
  }

  const projects = new Set(rows.map((row) => row.project).filter(Boolean));
  const colors = new Set(rows.map((row) => row.color).filter(Boolean));
  return {
    rows,
    report: {
      kind: 'daily',
      fileName,
      importedAt: new Date().toISOString(),
      parser: DAILY_PARSER_VERSION,
      count: rows.length,
      skipped,
      projects: projects.size,
      colors: colors.size,
      columns,
      colorColumnFound: !!columns.color,
      woHeaderFound,
      sheet: SHEET,
    },
  };
}
