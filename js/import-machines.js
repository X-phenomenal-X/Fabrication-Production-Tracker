/* Imports the department's own schedules — the Rolling workbook and the CNC
   workbook — which are the base for scheduling.

   Every machine sheet in those workbooks shares one shape:
     WO# | PROJECT | FL | Product (die) | QTY | B/O | B/O Stat | Cutting Date | Status
   so one parser with a per-sheet column map covers all of them.

   A row here is a *task*: this many pieces of this die, for this work order, on
   this machine. That is finer than the Daily Schedule, which only carries one
   piece count per operation per order. */

import { readXlsx } from './xlsx.js';

/* Bumped whenever a change here would parse the same workbook differently.
   An import is stamped with it, so the app can tell that data already loaded
   predates a parsing fix and say so — the alternative is what actually
   happened three times: the fix ships, the stored result stays wrong, and the
   only clue is that the numbers look odd.

     1  original
     2  FMC 1 / FMC 2, and the CNC & FMC shared queue
     3  shift update read from the visible tab only; CNC-3 mapped to CNC 1 */
export const PARSER_VERSION = 3;

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
      // No machine column on this sheet — it is one queue for CNC 1, FMC 1 and
      // FMC 2, split by hand in the app rather than guessed at here.
      sheet: 'CNC & FMC', machine: 'cncfmc',
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
      // The MultiPunch & SAW sheet tracks the saw and the punch as separate
      // operations on the same line. Read rather than discarded — the punch
      // column is the one the department actually fills in.
      saw: txt(get(row.cells, 'saw')),
      punch: txt(get(row.cells, 'punch')),
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

/* The CNC workbook's shift-update sheet carries the latest word on most
   machines — what ran, what is next, and whether a machine is down.

   Which sheet that is, is decided by **which tab is visible in Excel**, not by
   its name. The workbook holds four similarly-named ones — `Shift Update 2`,
   `Shift Update`, `Shift Update (3)`, `Shift Update Old` — and only the first
   is visible; the department has hidden the rest, along with 58 of the
   workbook's 73 sheets. Hiding a tab is how they archive it, so visibility is
   their own signal for which one is live, and it keeps working if they rename
   or reorganise. Naming a sheet in code here was wrong twice: once reading all
   four and merging them, once pinned to `Shift Update 2`, which only looked
   right because that happens to be the visible one today.

   A block is laid out as two side-by-side halves so it prints on one page:
   the left half occupies columns 1-7, the right one columns 9-15, each with
   its own Date/Shift header and this column layout:

     Machine | #Ops | (bullet) | Work Done / In Progress | (bullet) | Next in Schedule | Notes

   A machine's entry runs from its name row until the next name row.

   Blocks also stack *vertically* within this one sheet: an empty leftover Day
   block sits at the top, and the real one — the only place FMC 1 and FMC 2
   appear at all — starts at row 57. Both column halves are read, every block
   within each is found by its own Date header, and entries are merged per
   machine so a filled-in block always wins over an empty one from earlier in
   the sheet. */
const SU_SHEET_RE = /^shift update/i;

/** The shift-update tab to read: the visible one. If more than one is visible
    the fullest wins; if none is (they hid them all), fall back to the fullest
    of the hidden ones rather than showing nothing. Returns [name, parsed]. */
function pickShiftUpdate(wb) {
  const named = Object.entries(wb.sheets).filter(([n]) => SU_SHEET_RE.test(n));
  if (!named.length) return [null, null];

  const visible = named.filter(([n]) => !wb.hiddenSheets?.has(n));
  const pool = visible.length ? visible : named;

  let best = [null, null];
  let bestScore = -1;
  for (const [name, sheet] of pool) {
    const parsed = parseShiftUpdate(sheet);
    const score = Object.values(parsed?.machines || {})
      .reduce((a, e) => a + e.done.length + e.next.length + e.notes.length, 0);
    if (score > bestScore) { bestScore = score; best = [name, parsed]; }
  }
  if (best[1]) best[1].fromVisibleTab = visible.length > 0;
  return best;
}

/* Sheet labels -> machine keys. Anything not listed (Proline, Notching, the
   Saws, the standing SERVICE ORDERS / K1285 / BACK ORDER rows) is outside the
   centres this app tracks and is skipped — but its label is reported, so a
   machine appearing on the sheet that the app does not know about is visible
   rather than silently dropped. */
const SU_MACHINE = {
  'ROLLINGETASAUTO': 'roll-auto',
  'ROLLINGIOTAMANUAL': 'roll-man',
  'FOM1': 'fom1',
  'FOM2': 'fom2',
  'FOM3': 'fom3',
  'CNC1': 'cnc1',
  // The live block writes the one remaining CNC machine as "CNC-3", while the
  // stale block above it still lists a "CNC 1" with nothing in it. Both
  // normalise to CNC3/CNC1 here and both point at the same work centre; the
  // content-first merge below then picks the one that actually says something.
  'CNC3': 'cnc1',
  'FMC1': 'fmc1',
  'FMC2': 'fmc2',
  'MULTIPUNCH': 'multipunch',
};

/* Rows that head a block or total it up, never a machine. */
const SU_SKIP = new Set(['MACHINE', 'DATE', 'TOTAL', 'SERVICEORDERS', 'K1285PULLS', 'BACKORDER']);

const SU_SHIFT_RANK = { DAY: 0, AFTERNOON: 1, AFT: 1, MIDNIGHT: 2, NIGHT: 2 };

function suKey(label) {
  return String(label || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** How recent a block is, as a sortable string. Undated blocks sort last. */
function suWhen(date, shift) {
  if (!date) return '';
  const rank = SU_SHIFT_RANK[suKey(shift)] ?? 0;
  return `${date}#${rank}`;
}

/** Row indexes where a block starts in this column half: every row whose first
    column reads "Date". Falls back to the classic fixed header at row 2. */
function suBlockStarts(rows, off) {
  const starts = [];
  rows.forEach((row, i) => {
    if (/^date$/i.test(txt(row.cells[off]) || '')) starts.push(i);
  });
  if (!starts.length) starts.push(1);
  return starts;
}

function parseShiftUpdateBlock(rows, off, from, to, unknown) {
  const g = (row, col) => row.cells[off + col - 1];
  const header = rows[from];
  const blockDate = header ? date(g(header, 2)) : null;
  const shift = header ? txt(g(header, 6)) : null;

  const out = {};
  let cur = null;
  // The Date row is followed by the column header row; entries start after it.
  for (const row of rows.slice(from + 2, to)) {
    const name = txt(g(row, 1));
    if (name) {
      const k = suKey(name);
      const key = SU_MACHINE[k];
      cur = key || null;                   // rows for untracked machines are skipped
      if (!key && k && !SU_SKIP.has(k)) unknown.add(name.trim());
      if (cur && !out[cur]) {
        const opsRaw = g(row, 2);
        const opsTxt = txt(opsRaw);
        out[cur] = {
          machine: cur,
          label: name.trim(),
          // "#Ops" is normally a headcount but is sometimes the word DOWN.
          ops: typeof opsRaw === 'number' ? opsRaw : null,
          down: /DOWN/i.test(opsTxt || ''),
          done: [],
          next: [],
          notes: [],
          date: blockDate,
          shift,
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
  return { date: blockDate, shift, machines: out };
}

/** Every block on the sheet: both column halves, every vertically stacked
    block within each half. */
function parseShiftUpdateSheet(sheet, unknown) {
  const blocks = [];
  for (const off of [0, 8]) {
    const starts = suBlockStarts(sheet.rows, off);
    starts.forEach((from, i) => {
      const to = i + 1 < starts.length ? starts[i + 1] : sheet.rows.length;
      blocks.push(parseShiftUpdateBlock(sheet.rows, off, from, to, unknown));
    });
  }
  return blocks;
}

/** Parse the Shift Update 2 sheet into { date, shift, machines: {key: entry} }.
    Each entry keeps the date and shift of the block it came from, since a
    machine can be listed on more than one block within the sheet. */
export function parseShiftUpdate(sheet) {
  if (!sheet) return null;

  const unknown = new Set();
  const blocks = parseShiftUpdateSheet(sheet, unknown);

  // Actual described work — done, next and notes. A row can have its #Ops
  // headcount filled in with nothing else on it, which is still an empty
  // block for this purpose: a crew number is not a report of what happened.
  const wordCount = (e) => e.done.length + e.next.length + e.notes.length;
  // Overall richness, #Ops included — only used as the final numeric
  // tiebreaker below, once two entries are already known to both say
  // something or both say nothing.
  const said = (e) => wordCount(e) + (e.ops ? 1 : 0);
  // An entry that describes no actual work must never beat one that does,
  // whatever its shift label claims — this sheet carries some machines
  // twice: once in a block someone actually filled in, once in an untouched
  // template row elsewhere on the same sheet. Content is checked before
  // date+shift so a blank leftover block can never win over a filled one.
  const better = (e, cur) => {
    const we = wordCount(e);
    const wc = wordCount(cur);
    if ((we > 0) !== (wc > 0)) return we > wc;
    const a = suWhen(e.date, e.shift);
    const c = suWhen(cur.date, cur.shift);
    if (a !== c) return a > c;
    return said(e) > said(cur);
  };

  const machines = {};
  for (const b of blocks) {
    for (const [k, e] of Object.entries(b.machines)) {
      if (!machines[k] || better(e, machines[k])) machines[k] = e;
    }
  }

  const values = Object.values(machines);
  const latest = values.reduce((a, b) => (a && !better(b, a) ? a : b), null);

  return {
    date: latest?.date || null,
    shift: latest?.shift || null,
    machines,
    unknown: [...unknown].sort(),
  };
}

/**
 * Import a machine workbook.
 * @param kind 'rolling' | 'cnc'
 */
export async function importMachineWorkbook(arrayBuffer, { kind, fileName = 'schedule.xlsx' } = {}) {
  const specs = SHEET_MAP[kind];
  if (!specs) throw new Error(`Unknown workbook type "${kind}".`);

  const report = {
    kind, fileName, importedAt: new Date().toISOString(),
    parser: PARSER_VERSION, sheets: [], missing: [],
  };

  const wanted = specs.map((s) => s.sheet);
  const wb = await readXlsx(arrayBuffer, {
    only: (n) => wanted.includes(n) || (kind === 'cnc' && SU_SHEET_RE.test(n)),
  });

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
    const [suName, suParsed] = pickShiftUpdate(wb);
    shiftUpdate = suParsed;
    if (!shiftUpdate) report.missing.push('Shift Update');
    else report.shiftUpdate = {
      date: shiftUpdate.date, shift: shiftUpdate.shift,
      sheet: suName,
      // Worth reporting: if this ever says false, the department has hidden
      // every shift-update tab and the app is reading an archived one.
      fromVisibleTab: !!shiftUpdate.fromVisibleTab,
      machines: Object.keys(shiftUpdate.machines).length,
      // Machine names on the sheet the app has no work centre for. Worth
      // showing: it is how the department finds out the app is behind the floor.
      unknown: shiftUpdate.unknown,
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
