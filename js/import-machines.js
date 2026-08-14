/* Imports the department's own schedules — the Rolling workbook and the CNC
   workbook — which are the base for scheduling.

   Every machine sheet in those workbooks shares one shape:
     WO# | PROJECT | FL | Product (die) | QTY | B/O | B/O Stat | Cutting Date | Status
   so one parser with a per-sheet column map covers all of them.

   A row here is a *task*: this many pieces of this die, for this work order, on
   this machine. That is finer than the Daily Schedule, which only carries one
   piece count per operation per order. */

import { readXlsx } from './xlsx.js';

const PHANTOM_BEFORE = Date.UTC(1990, 0, 1);

function txt(v) {
  if (v == null || typeof v === 'object') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s || s === '#N/A' || s === '#REF!' || s === '#VALUE!') return null;
  return s;
}

function num(v) {
  if (v == null || typeof v === 'object' || v instanceof Date) return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return isFinite(n) ? n : null;
}

function date(v) {
  if (!(v instanceof Date)) return null;
  if (v.getTime() < PHANTOM_BEFORE) return null;
  return v.toISOString().slice(0, 10);
}

function isWo(v) {
  return v != null && /^\d{3,7}$/.test(String(v).trim());
}

/* Status vocabulary used across the machine sheets. */
const TASK_STATUS = {
  DONE: { label: 'Done', tone: 'ok', done: true },
  IP: { label: 'In progress', tone: 'work', done: false },
  BO: { label: 'Back order', tone: 'bad', done: false },
  READY: { label: 'Ready', tone: 'mute', done: false },
  HOLD: { label: 'On hold', tone: 'bad', done: false },
  OPEN: { label: 'Open', tone: 'mute', done: false },
};

export { TASK_STATUS };

export function normTaskStatus(raw) {
  const s = txt(raw);
  if (!s) return 'OPEN';
  const u = s.toUpperCase();
  if (/^(DONE|COMPLETE)/.test(u)) return 'DONE';
  if (/^(I\.?P|IN PROGRESS|RUNNING)/.test(u)) return 'IP';
  if (/^(B\/?O|BACK ?ORDER)/.test(u)) return 'BO';
  if (/HOLD/.test(u)) return 'HOLD';
  if (/READY|STOCK OK/.test(u)) return 'READY';
  return 'OPEN';
}

/** Back order is orthogonal to progress: the sheets write "IP BO" for a line
    that is running but short of material. `normTaskStatus` matches IP first
    and would drop the BO half entirely, so it is captured separately here and
    shown as its own badge. */
export function readsBackOrder(statusRaw, boStat, bo) {
  const u = (txt(statusRaw) || '').toUpperCase();
  if (/\bB\/?O\b|BACK ?ORDER/.test(u)) return true;
  if (txt(boStat)) return true;
  return typeof bo === 'number' && bo > 0;
}

/* Which sheet feeds which work centre, and where its columns sit (1-based).
   `complete: true` marks archive sheets whose rows are finished by definition. */
const SHEET_MAP = {
  rolling: [
    {
      sheet: 'Auto', machine: 'roll-auto',
      cols: { wo: 1, project: 2, floor: 3, die: 4, qty: 5, boInt: 6, boExt: 7, material: 8,
              cuttingDate: 9, comments: 10, status: 11, product: 12, setup: 13,
              shipDate: 14, rollingEta: 15, machiningEta: 16 },
    },
    {
      sheet: 'Manual', machine: 'roll-man',
      cols: { wo: 1, project: 2, floor: 3, die: 4, qty: 5, boInt: 6, boExt: 7, material: 8,
              cuttingDate: 9, comments: 10, status: 11 },
    },
    {
      sheet: 'Complete', machine: 'roll-auto', complete: true,
      cols: { wo: 1, project: 2, floor: 3, die: 4, qty: 5, cuttingDate: 9, status: 11 },
    },
  ],
  cnc: [
    {
      sheet: 'FOM1', machine: 'fom1',
      cols: { wo: 1, project: 2, floor: 3, die: 4, qty: 5, bo: 6, boStat: 7,
              cuttingDate: 8, program: 9, dayShift: 10, status: 11, shifts: 12 },
    },
    {
      // FOM2 carries the pin-hole / 8560 vent flag, which is the hinge rule.
      sheet: 'FOM2', machine: 'fom2',
      cols: { wo: 1, project: 2, floor: 3, die: 4, pinHole: 5, qty: 6, cuttingDate: 7,
              bo: 8, boStat: 9, dayShift: 10, status: 11, shifts: 12 },
    },
    {
      sheet: 'FOM3', machine: 'fom3',
      cols: { wo: 1, project: 2, floor: 3, die: 4, qty: 5, cuttingDate: 6,
              bo: 7, boStat: 8, dayShift: 9, status: 10, shifts: 11 },
    },
    {
      sheet: 'MultiPunch & SAW', machine: 'multipunch',
      cols: { wo: 1, project: 2, floor: 3, die: 4, qty: 5, bo: 6, boStat: 7,
              rolling: 8, cuttingDate: 9, saw: 10, punch: 11, shifts: 12 },
    },
    {
      sheet: 'CNC & FMC', machine: 'cnc1',
      cols: { wo: 1, project: 2, floor: 3, die: 4, qty: 5, bo: 6, boStat: 7,
              cuttingDate: 8, status: 9 },
    },
  ],
};

function parseMachineSheet(sheet, spec, report) {
  const out = [];
  const c = spec.cols;
  const get = (cells, key) => (c[key] ? cells[c[key] - 1] : undefined);

  for (const row of sheet.rows) {
    if (row.empty) continue;
    const wo = get(row.cells, 'wo');
    if (!isWo(wo)) continue;

    const qty = num(get(row.cells, 'qty'));
    const statusRaw = get(row.cells, 'status');
    const status = spec.complete ? 'DONE' : normTaskStatus(statusRaw);
    const boQty = num(get(row.cells, 'bo')) ?? num(get(row.cells, 'boInt'));
    // The B/O column counts BARS, not pieces, and on FOM2/FOM3 it is written
    // as text ("3 BARS"). Keep the raw cell so that shortage is still readable
    // even though it will not parse as a number.
    const boRaw = txt(get(row.cells, 'bo')) || txt(get(row.cells, 'boInt'));
    const boStat = txt(get(row.cells, 'boStat'));

    out.push({
      id: `${spec.machine}:${String(wo).trim()}:${txt(get(row.cells, 'die')) || 'x'}:${row.r}`,
      machine: spec.machine,
      sheet: spec.sheet,
      row: row.r,
      wo: String(wo).trim(),
      project: txt(get(row.cells, 'project')),
      floor: txt(get(row.cells, 'floor')),
      die: txt(get(row.cells, 'die')),
      qty,
      status,
      cuttingDate: date(get(row.cells, 'cuttingDate')),
      shipDate: date(get(row.cells, 'shipDate')),
      material: txt(get(row.cells, 'material')),
      comments: txt(get(row.cells, 'comments')),
      setup: txt(get(row.cells, 'setup')),
      rollingEta: date(get(row.cells, 'rollingEta')) || txt(get(row.cells, 'rollingEta')),
      dayShift: txt(get(row.cells, 'dayShift')),
      shifts: num(get(row.cells, 'shifts')),
      pinHole: txt(get(row.cells, 'pinHole')),
      bo: boQty,
      boRaw,
      boStat,
      backOrder: spec.complete ? false : readsBackOrder(statusRaw, boStat || boRaw, boQty),
      archived: !!spec.complete,
    });
  }

  report.sheets.push({ sheet: spec.sheet, machine: spec.machine, rows: out.length });
  return out;
}

/* ---------- shift update ---------- */

/* The CNC workbook's "Shift Update" sheet carries the latest word on most
   machines — what ran, what is next, and whether a machine is down. It is
   laid out as two side-by-side blocks so it prints on one page: the left
   block occupies columns 1-7, the right one columns 9-15, each with its own
   Date/Shift header on row 2 and this column layout:

     Machine | #Ops | (bullet) | Work Done / In Progress | (bullet) | Next in Schedule | Notes

   A machine's entry runs from its name row until the next name row. */
const SU_SHEET = 'Shift Update';

/* Sheet labels -> machine keys. Anything not listed (Proline, Notching, the
   Saws, the standing SERVICE ORDERS / K1285 / BACK ORDER rows) is outside the
   four centres this app tracks and is skipped. */
const SU_MACHINE = {
  'ROLLINGETASAUTO': 'roll-auto',
  'ROLLINGIOTAMANUAL': 'roll-man',
  'FOM1': 'fom1',
  'FOM2': 'fom2',
  'FOM3': 'fom3',
  'CNC1': 'cnc1',
  'CNC2': 'cnc2',
  'CNC3': 'cnc3',
  'CNCSBZ140': 'cnc140',
  'MULTIPUNCH': 'multipunch',
};

function suKey(label) {
  return String(label || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function parseShiftUpdateBlock(rows, off) {
  const g = (row, col) => row.cells[off + col - 1];
  const header = rows[1];
  const date = header ? date_(g(header, 2)) : null;
  const shift = header ? txt(g(header, 6)) : null;

  const out = {};
  let cur = null;
  for (const row of rows.slice(3)) {
    const name = txt(g(row, 1));
    if (name) {
      const key = SU_MACHINE[suKey(name)];
      cur = key || null;                   // rows for untracked machines are skipped
      if (cur && !out[cur]) {
        const opsRaw = g(row, 2);
        const opsTxt = txt(opsRaw);
        out[cur] = {
          machine: cur,
          label: name,
          // "#Ops" is normally a headcount but is sometimes the word DOWN.
          ops: typeof opsRaw === 'number' ? opsRaw : null,
          down: /DOWN/i.test(opsTxt || ''),
          done: [],
          next: [],
          notes: [],
        };
      }
    }
    if (!cur || !out[cur]) continue;
    const d = txt(g(row, 4));
    const n = txt(g(row, 6));
    const note = txt(g(row, 7));
    if (d) out[cur].done.push(d);
    if (n) out[cur].next.push(n);
    if (note) out[cur].notes.push(note);
    // A machine flagged Down carries the word in its work column, not #Ops.
    if (d && /^down$/i.test(d)) out[cur].down = true;
  }
  return { date, shift, machines: out };
}

function date_(v) {
  return date(v);
}

/** Parse the Shift Update sheet into { date, shift, machines: {key: entry} }. */
export function parseShiftUpdate(sheet) {
  if (!sheet) return null;
  const left = parseShiftUpdateBlock(sheet.rows, 0);
  const right = parseShiftUpdateBlock(sheet.rows, 8);

  // A machine can appear in both blocks. Both carry the same date and shift,
  // so prefer whichever entry actually says something.
  const weight = (e) => (e ? e.done.length + e.next.length + (e.ops ? 1 : 0) : -1);
  const machines = { ...left.machines };
  for (const [k, e] of Object.entries(right.machines)) {
    if (weight(e) > weight(machines[k])) machines[k] = e;
  }

  return {
    date: left.date || right.date,
    shift: left.shift || right.shift,
    machines,
  };
}

/**
 * Import a machine workbook.
 * @param kind 'rolling' | 'cnc'
 */
export async function importMachineWorkbook(arrayBuffer, { kind, fileName = 'schedule.xlsx' } = {}) {
  const specs = SHEET_MAP[kind];
  if (!specs) throw new Error(`Unknown workbook type "${kind}".`);

  const report = { kind, fileName, importedAt: new Date().toISOString(), sheets: [], missing: [] };

  const wanted = specs.map((s) => s.sheet);
  if (kind === 'cnc') wanted.push(SU_SHEET);
  const wb = await readXlsx(arrayBuffer, { only: wanted });

  let tasks = [];
  for (const spec of specs) {
    const sheet = wb.sheets[spec.sheet];
    if (!sheet) { report.missing.push(spec.sheet); continue; }
    tasks = tasks.concat(parseMachineSheet(sheet, spec, report));
  }

  // The CNC workbook also carries the shift update — the latest word on most
  // machines, and finer than the per-line Status columns.
  let shiftUpdate = null;
  if (kind === 'cnc') {
    shiftUpdate = parseShiftUpdate(wb.sheets[SU_SHEET]);
    if (!shiftUpdate) report.missing.push(SU_SHEET);
    else report.shiftUpdate = {
      date: shiftUpdate.date, shift: shiftUpdate.shift,
      machines: Object.keys(shiftUpdate.machines).length,
    };
  }

  if (!tasks.length) {
    throw new Error(
      `No machine schedule rows found. Expected sheets: ${specs.map((s) => s.sheet).join(', ')}. ` +
      `This workbook has: ${wb.sheetNames.slice(0, 12).join(', ')}`
    );
  }

  report.count = tasks.length;
  return { tasks, shiftUpdate, report };
}
