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
  if (/^DONE|COMPLETE/.test(u)) return 'DONE';
  if (/^(I\.?P|IN PROGRESS|RUNNING)/.test(u)) return 'IP';
  if (/^(B\/?O|BACK ?ORDER)/.test(u)) return 'BO';
  if (/HOLD/.test(u)) return 'HOLD';
  if (/READY|STOCK OK/.test(u)) return 'READY';
  return 'OPEN';
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
    const status = spec.complete ? 'DONE' : normTaskStatus(get(row.cells, 'status'));

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
      bo: num(get(row.cells, 'bo')) ?? num(get(row.cells, 'boInt')),
      boStat: txt(get(row.cells, 'boStat')),
      archived: !!spec.complete,
    });
  }

  report.sheets.push({ sheet: spec.sheet, machine: spec.machine, rows: out.length });
  return out;
}

/**
 * Import a machine workbook.
 * @param kind 'rolling' | 'cnc'
 */
export async function importMachineWorkbook(arrayBuffer, { kind, fileName = 'schedule.xlsx' } = {}) {
  const specs = SHEET_MAP[kind];
  if (!specs) throw new Error(`Unknown workbook type "${kind}".`);

  const report = { kind, fileName, importedAt: new Date().toISOString(), sheets: [], missing: [] };

  const wb = await readXlsx(arrayBuffer, { only: specs.map((s) => s.sheet) });

  let tasks = [];
  for (const spec of specs) {
    const sheet = wb.sheets[spec.sheet];
    if (!sheet) { report.missing.push(spec.sheet); continue; }
    tasks = tasks.concat(parseMachineSheet(sheet, spec, report));
  }

  if (!tasks.length) {
    throw new Error(
      `No machine schedule rows found. Expected sheets: ${specs.map((s) => s.sheet).join(', ')}. ` +
      `This workbook has: ${wb.sheetNames.slice(0, 12).join(', ')}`
    );
  }

  report.count = tasks.length;
  return { tasks, report };
}

/* ---------- verification against the Daily Schedule ---------- */

/**
 * Check the machine schedules against the company Daily Schedule.
 * The machine schedules drive the work; the Daily Schedule is the check that
 * dates and quantities still agree with what the company expects.
 */
export function verifyAgainstDaily(tasks, orders, { toleranceDays = 2 } = {}) {
  const byWo = new Map();
  for (const o of orders) {
    if (!byWo.has(o.wo)) byWo.set(o.wo, []);
    byWo.get(o.wo).push(o);
  }

  // Only work still to be done is worth checking. Finished tasks drift out of
  // step with the schedule as a matter of course and would drown the signal.
  const grouped = new Map();
  for (const t of tasks) {
    if (t.archived || t.status === 'DONE') continue;
    if (!grouped.has(t.wo)) grouped.set(t.wo, []);
    grouped.get(t.wo).push(t);
  }

  const dayDiff = (a, b) =>
    Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);

  const issues = [];
  let matched = 0;

  for (const [wo, list] of grouped) {
    const orderRows = byWo.get(wo);
    if (!orderRows) {
      issues.push({
        kind: 'missing-from-daily', wo,
        project: list[0].project, machines: [...new Set(list.map((t) => t.machine))],
        pieces: list.reduce((a, t) => a + (t.qty || 0), 0),
        detail: 'Scheduled on a machine but not on the Daily Schedule',
      });
      continue;
    }
    matched++;

    // Report one row per work order, not per task, using the closest Daily
    // Schedule date so multi-floor orders are not flagged spuriously.
    const check = (field, label) => {
      const dailyDates = [...new Set(orderRows.map((o) => o[field]).filter(Boolean))];
      if (!dailyDates.length) return;
      const withDate = list.filter((t) => t[field]);
      if (!withDate.length) return;

      let worst = null;
      for (const t of withDate) {
        const best = dailyDates
          .map((d) => ({ d, diff: dayDiff(t[field], d) }))
          .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff))[0];
        if (!worst || Math.abs(best.diff) > Math.abs(worst.diff)) {
          worst = { ...best, task: t };
        }
      }
      if (!worst || Math.abs(worst.diff) <= toleranceDays) return;

      issues.push({
        kind: field === 'cuttingDate' ? 'date-mismatch' : 'ship-mismatch',
        wo, project: worst.task.project,
        machines: [...new Set(list.map((t) => t.machine))],
        days: worst.diff,
        detail: `${label}: machine sheet ${worst.task[field]}, Daily Schedule ${worst.d} ` +
                `(${worst.diff > 0 ? worst.diff + ' days later' : Math.abs(worst.diff) + ' days earlier'})`,
      });
    };

    check('cuttingDate', 'Cut date');
    check('shipDate', 'Ship date');
  }

  // Orders the company expects that no machine schedule covers.
  const notScheduled = [];
  for (const [wo, rows] of byWo) {
    if (grouped.has(wo)) continue;
    const live = rows.filter((o) => {
      const cut = o.ops?.cut?.status;
      return cut !== 'OK' && cut !== 'DONE';
    });
    if (live.length) notScheduled.push({ wo, orders: live, project: live[0].project });
  }

  issues.sort((a, b) => Math.abs(b.days || 999) - Math.abs(a.days || 999));

  return {
    matched, machineWos: grouped.size, dailyWos: byWo.size,
    issues, notScheduled, toleranceDays,
  };
}
