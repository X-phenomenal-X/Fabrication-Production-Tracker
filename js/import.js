/* Turns a Daily Schedule workbook into clean order records, and reports
   everything it had to fix or throw away so the import is never a black box. */

import { readXlsx } from './xlsx.js';
import {
  SHEET, FIELDS, OPS, isJunkRow, isWorkOrder, isErpWorkOrder, normCutStatus, normPurch,
  SECTION_HINTS, BANNER_MAX_FILLED,
} from './schema.js';

const PHANTOM_BEFORE = Date.UTC(1990, 0, 1); // 1899-12-16 etc. are formula artifacts

function cell(cells, col) {
  const v = cells[col - 1];
  return v === undefined ? null : v;
}

function asText(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v.error ? null : null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s === '' ? null : s;
}

function asNumber(v) {
  if (v == null || typeof v === 'object') return null;
  if (v instanceof Date) return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return isFinite(n) ? n : null;
}

function asDate(v) {
  if (!(v instanceof Date)) return null;
  if (v.getTime() < PHANTOM_BEFORE) return null; // phantom date, treat as blank
  return v.toISOString().slice(0, 10);
}

function isError(v) {
  return v != null && typeof v === 'object' && !!v.error;
}

function filledCount(cells) {
  let n = 0;
  for (const v of cells) if (v != null && v !== '') n++;
  return n;
}

/** Detect a lone-text banner row like "IN CUTTING" or "MAT'L REQUIRED".
    Requires the row to be sparse, so an order that merely mentions the phrase
    is not mistaken for a band header. */
function sectionOf(cells, filled) {
  if (filled > BANNER_MAX_FILLED) return null;
  for (let i = 0; i < Math.min(cells.length, 6); i++) {
    const t = asText(cells[i]);
    if (!t) continue;
    const up = t.toUpperCase().replace(/\s+/g, ' ').trim();
    if (SECTION_HINTS.some((h) => up.startsWith(h))) return up.replace(/[.\s]+$/, '');
  }
  return null;
}

function parseDailySheet(sheet, report) {
  const orders = [];
  let section = null;
  const seen = new Map();

  for (const row of sheet.rows) {
    if (row.r <= 2 || row.empty) continue;
    const cells = row.cells;
    const filled = filledCount(cells);

    const sec = sectionOf(cells, filled);
    if (sec) {
      section = sec;
      continue;
    }

    const first = cell(cells, FIELDS.wo);
    if (!isWorkOrder(first)) {
      if (asText(first) && !isJunkRow(first)) {
        report.skipped.push({ row: row.r, reason: 'no work order number', value: asText(first) });
      }
      continue;
    }
    // A sparse row with an id but almost no data is a leftover, not an order.
    if (filled <= BANNER_MAX_FILLED) {
      report.skipped.push({ row: row.r, reason: 'row too sparse to be an order', value: asText(first) });
      continue;
    }

    const wo = String(first).trim();
    const floor = asText(cell(cells, FIELDS.floor));
    const project = asText(cell(cells, FIELDS.project));

    // W/O alone is not unique — the same order recurs per floor/tag, and a few
    // rows repeat even then. Collisions get a stable occurrence suffix rather
    // than being dropped, so no real order is lost and ids survive re-import.
    const base = [wo, floor || '', project || ''].join('::');
    const nth = (seen.get(base) || 0) + 1;
    seen.set(base, nth);
    const id = nth === 1 ? base : `${base}#${nth}`;
    if (nth > 1) report.duplicates.push({ row: row.r, id: base, occurrence: nth });

    const o = {
      id,
      wo,
      row: row.r,
      section,
      job: asText(cell(cells, FIELDS.job)),
      project: asText(cell(cells, FIELDS.project)),
      floor,
      qty: asNumber(cell(cells, FIELDS.qty)),
      notes: asText(cell(cells, FIELDS.notes)),
      rem: asNumber(cell(cells, FIELDS.rem)),
      quar: asNumber(cell(cells, FIELDS.quar)),
      commRes: asText(cell(cells, FIELDS.commRes)),
      series: asText(cell(cells, FIELDS.series)),
      shipDate: asDate(cell(cells, FIELDS.shipDate)),
      glazingDate: asDate(cell(cells, FIELDS.glazingDate)),
      cuttingDate: asDate(cell(cells, FIELDS.cuttingDate)),
      panelsToGlazing: asDate(cell(cells, FIELDS.panelsToGlazing)),
      bdRec: asDate(cell(cells, FIELDS.bdRec)),
      purch: normPurch(cell(cells, FIELDS.purch)),
      extStatus: asText(cell(cells, FIELDS.extStatus)),
      warehouse: asText(cell(cells, FIELDS.warehouse)),
      reason: asText(cell(cells, FIELDS.reason)),
      daysToShip: asNumber(cell(cells, FIELDS.daysToShip)),
      ops: {},
    };

    // `commRes` is only meaningful as COMM or RES; the column is reused elsewhere.
    if (o.commRes && !/^(COMM|RES)$/i.test(o.commRes)) o.commRes = null;

    // Warehouse column mixes real dates with notes like "PULLED 7/30".
    const wh = cell(cells, FIELDS.warehouse);
    if (wh instanceof Date) o.warehouse = asDate(wh);

    for (const op of OPS) {
      const raw = cell(cells, op.col);
      if (isError(raw)) {
        report.errorCells.push({ row: row.r, op: op.label, code: raw.error });
        continue;
      }
      if (op.kind === 'qty') {
        const n = asNumber(raw);
        if (n != null && n > 0) {
          // A date typed into a quantity column loses its formatting and arrives
          // as a serial around 40000-60000 (e.g. 46206 = July 2026). Those are
          // not piece counts, and left in they wreck every total on the board.
          const looksLikeDate = n >= 40000 && n <= 60000 && Number.isInteger(n);
          const wayOverQty = o.qty > 0 && n > o.qty * 100;
          if (looksLikeDate || wayOverQty) {
            report.suspectQty.push({
              row: row.r, wo, op: op.label, value: n, orderQty: o.qty,
              why: looksLikeDate ? 'looks like a date serial' : 'far larger than the order quantity',
            });
          } else {
            o.ops[op.key] = { target: n };
          }
        }
      } else {
        const st = normCutStatus(raw);
        const txt = asText(raw);
        if (st) o.ops[op.key] = { status: st };
        else if (txt && txt.toUpperCase() !== 'N/A') {
          o.ops[op.key] = { status: null, text: txt };
          report.unknownStatus.push({ row: row.r, op: op.label, value: txt });
        }
      }
    }

    orders.push(o);
  }

  return orders;
}

function parsePrep(sheet) {
  const out = [];
  for (const row of sheet.rows) {
    if (row.r <= 1 || row.empty) continue;
    const c = row.cells;
    const job = asText(c[0]);
    if (!job) continue;
    out.push({
      job,
      project: asText(c[1]),
      pm: asText(c[2]),
      lastFloor: asText(c[3]),
      nextUp: asText(c[4]),
      prodWeek: c[5] instanceof Date ? asDate(c[5]) : asText(c[5]),
      notes: asText(c[6]),
    });
  }
  return out;
}

function parseWip(sheet) {
  const out = [];
  for (const row of sheet.rows) {
    if (row.r <= 2 || row.empty) continue;
    const c = row.cells;
    const wo = c[0];
    if (!isErpWorkOrder(wo)) continue; // the WIP export is ERP-generated, always numeric
    out.push({
      wo: String(wo).trim(),
      project: asText(c[1]),
      floor: asText(c[2]),
      schQty: asNumber(c[3]),
      remAssy: asNumber(c[4]),
      remGlaz: asNumber(c[5]),
      quar: asNumber(c[6]),
      cpRem: asNumber(c[7]),
      shipDate: asDate(c[8]),
      shpRem: asNumber(c[9]),
    });
  }
  return out;
}

function parseScreens(sheet) {
  const out = [];
  for (const row of sheet.rows) {
    if (row.r <= 1 || row.empty) continue;
    const c = row.cells;
    const product = asText(c[0]);
    const job = asText(c[1]);
    if (!product || !job) continue;
    out.push({
      product, job,
      project: asText(c[2]),
      floor: asText(c[3]),
      wsQty: asNumber(c[4]),
      dsQty: asNumber(c[5]),
      notes: asText(c[6]),
      shipDate: asDate(c[7]),
      glazingDate: asDate(c[8]),
      extStatus: asText(c[9]),
      warehouse: asDate(c[10]) || asText(c[10]),
      po: asText(c[11]),
      status: asText(c[12]),
      cut: asText(c[13]),
      assy: asText(c[14]),
      mesh: asText(c[15]),
    });
  }
  return out;
}

/** Parse a workbook into a revision snapshot. */
export async function importWorkbook(arrayBuffer, { fileName = 'schedule.xlsx' } = {}) {
  const report = {
    fileName,
    importedAt: new Date().toISOString(),
    skipped: [],
    duplicates: [],
    errorCells: [],
    unknownStatus: [],
    suspectQty: [],
    sheetsFound: [],
    sheetsMissing: [],
  };

  const wb = await readXlsx(arrayBuffer, {
    only: [SHEET.DAILY, SHEET.WIP, SHEET.PREP, SHEET.SCREENS],
  });

  for (const key of [SHEET.DAILY, SHEET.WIP, SHEET.PREP, SHEET.SCREENS]) {
    (wb.sheets[key] ? report.sheetsFound : report.sheetsMissing).push(key);
  }
  if (!wb.sheets[SHEET.DAILY]) {
    throw new Error(
      `This workbook has no "${SHEET.DAILY}" sheet. Sheets found: ${wb.sheetNames.join(', ')}`
    );
  }

  const orders = parseDailySheet(wb.sheets[SHEET.DAILY], report);
  const wip = wb.sheets[SHEET.WIP] ? parseWip(wb.sheets[SHEET.WIP]) : [];
  const prep = wb.sheets[SHEET.PREP] ? parsePrep(wb.sheets[SHEET.PREP]) : [];
  const screens = wb.sheets[SHEET.SCREENS] ? parseScreens(wb.sheets[SHEET.SCREENS]) : [];

  // Fold the ERP's remaining-quantity columns onto the matching order.
  const wipByWo = new Map();
  for (const w of wip) {
    const k = w.floor ? `${w.wo}::${w.floor}` : w.wo;
    wipByWo.set(k, w);
    if (!wipByWo.has(w.wo)) wipByWo.set(w.wo, w);
  }
  for (const o of orders) {
    const w = wipByWo.get(o.id) || wipByWo.get(o.wo);
    if (w) o.wip = { remAssy: w.remAssy, remGlaz: w.remGlaz, cpRem: w.cpRem, shpRem: w.shpRem };
  }

  report.counts = {
    orders: orders.length,
    wip: wip.length,
    prep: prep.length,
    screens: screens.length,
  };

  return { orders, wip, prep, screens, report };
}

/** Compare a new revision against the one already loaded. */
export function diffRevisions(prevOrders = [], nextOrders = []) {
  const prev = new Map(prevOrders.map((o) => [o.id, o]));
  const next = new Map(nextOrders.map((o) => [o.id, o]));

  const added = [];
  const removed = [];
  const changed = [];

  const WATCH = [
    ['shipDate', 'Ship date'],
    ['glazingDate', 'Glazing date'],
    ['cuttingDate', 'Cutting date'],
    ['qty', 'Qty'],
    ['purch', 'Material'],
    ['extStatus', 'Ext status'],
    ['notes', 'Notes'],
  ];

  for (const [id, o] of next) {
    const p = prev.get(id);
    if (!p) { added.push(o); continue; }
    const fields = [];
    for (const [key, label] of WATCH) {
      if ((p[key] ?? null) !== (o[key] ?? null)) {
        fields.push({ key, label, from: p[key] ?? null, to: o[key] ?? null });
      }
    }
    const pCut = p.ops?.cut?.status ?? null;
    const nCut = o.ops?.cut?.status ?? null;
    if (pCut !== nCut) fields.push({ key: 'cut', label: 'Cut status', from: pCut, to: nCut });
    if (fields.length) changed.push({ order: o, fields });
  }

  for (const [id, o] of prev) if (!next.has(id)) removed.push(o);

  return { added, removed, changed };
}
