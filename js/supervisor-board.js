/* Numbers for the supervisor overview and the end-of-shift summary.

   Nothing here is stored. The plan is the work whose cutting date is the
   shift's own date. Done is how much of that plan is already finished.
   Parked lines stay in the cloud and out of both counts. */

import { MACHINES, MACHINE_BY_KEY } from './machines.js';
import {
  allBackOrders, assignedMachine, effectiveTaskStatus, isParked, openTodos,
  resolveTask, shiftWindow, stagingQueue, tasksInScope, today, workInShift,
} from './model.js';
import { shiftContextAt } from './shifts.js';

export const SUPERVISOR_CENTRES = Object.freeze([
  { group: 'Rolling', label: 'Rolling', page: 'rolling' },
  { group: 'FOM', label: 'FOM', page: 'fom' },
  { group: 'CNC', label: 'CNC & FMC', page: 'cnc' },
  { group: 'Punch', label: 'Multi Punch', page: 'punch' },
]);

/** The complete Window Wall paper order. Older daily orders may lack these keys. */
export const WINDOW_WALL_FIELDS = Object.freeze([
  ['wo', 'W/O'], ['jobCode', 'Job #'], ['project', 'Project'],
  ['floor', 'Floor'], ['qty', 'Qty'], ['assembly', 'Assembly'],
  ['vents', 'Vents'], ['deframes', 'Deframes'], ['shipDate', 'Ship Date'],
  ['cuttingDate', 'Cutting'], ['warehouse', 'Warehouse'],
  ['cutStatus', 'Cut'], ['hts', 'HTS'], ['widths', 'Widths'],
  ['punch', 'Punch'], ['vtml', 'VTML'], ['sfs', 'SFS'],
  ['lvrsTcPan', 'LVRS/TC PAN'],
]);

export function centreShiftProgress(lines, shiftDate) {
  return SUPERVISOR_CENTRES.map((centre) => {
    const planned = lines.filter((line) =>
      line.group === centre.group && !line.parked && line.cuttingDate === shiftDate);
    const done = planned.filter((line) => line.status === 'DONE');
    const qty = (rows) => rows.reduce((sum, line) => sum + (Number(line.qty) || 0), 0);
    return { ...centre, plan: planned.length, done: done.length, planQty: qty(planned), doneQty: qty(done) };
  });
}

export function shipWeekStart(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

export function windowWallSheet(orders = []) {
  const rows = orders.filter((order) => /WINDOW WALL/i.test(String(order?.section || '')));
  const groups = new Map();
  for (const row of rows) {
    const start = shipWeekStart(row.shipDate);
    const label = start ? `Week of ${start}` : 'No ship date';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(row);
  }
  return [...groups.entries()]
    .sort((a, b) => {
      if (a[0] === 'No ship date') return 1;
      if (b[0] === 'No ship date') return -1;
      return a[0] < b[0] ? -1 : 1;
    })
    .map(([label, items]) => ({
      label,
      rows: items,
      qty: items.reduce((sum, row) => sum + (Number(row.qty) || 0), 0),
    }));
}

export function machineShiftNotes({ done = [], running = [], backOrders = [] } = {}) {
  const doneLines = done.map((line) => [line.wo, line.project].filter(Boolean).join(' '));
  const runningLines = running.map((line) => `${[line.wo, line.project].filter(Boolean).join(' ')} I.P`);
  const shortages = backOrders.map((line) => {
    const qty = line.qty != null && line.qty !== '' ? ` ${line.qty} short` : '';
    return `B/O ${[line.wo, line.project].filter(Boolean).join(' ')}${qty}`.trim();
  });
  return {
    ops: done.length ? String(done.length) : '',
    done: [...doneLines, ...runningLines].join('\n'),
    next: '',
    notes: shortages.join('\n'),
  };
}

function lineLabel(task) {
  return { wo: task.wo, project: task.project || '' };
}

/** Editable shift-update text gathered from what the app already recorded. */
export function buildShiftDraft(date, shiftKey) {
  const rows = {};
  const shortages = [];
  for (const group of allBackOrders()) {
    for (const row of group.rows) {
      shortages.push({
        machine: row.machine,
        wo: row.task.wo,
        project: row.task.project || '',
        qty: row.bo.qty,
      });
    }
  }

  for (const machine of MACHINES) {
    if (machine.queue) continue;
    const moved = workInShift(machine.key, date, shiftKey);
    const done = moved.filter((item) => item.to === 'DONE').map((item) => lineLabel(item.task));
    const running = moved.filter((item) => item.to === 'IN_PROGRESS').map((item) => lineLabel(item.task));
    const backOrders = shortages.filter((item) => item.machine === machine.key);
    const notes = machineShiftNotes({ done, running, backOrders });
    if (notes.ops || notes.done || notes.notes) rows[machine.key] = notes;
  }

  if (shortages.length) {
    rows.backorder = machineShiftNotes({
      backOrders: shortages.map((item) => ({ ...item, project: MACHINE_BY_KEY[item.machine]?.label || item.project })),
    });
  }

  const issues = openTodos(date).open.map((item) => item.text).filter(Boolean);
  return { rows, notes: issues.join('\n') };
}

export function supervisorBoard(ref = today(), now = new Date()) {
  const shift = shiftContextAt(ref, now);
  const lines = tasksInScope().map((task) => {
    const resolved = resolveTask(task);
    const machine = assignedMachine(resolved);
    return {
      group: MACHINE_BY_KEY[machine]?.group || '',
      cuttingDate: resolved.cuttingDate || '',
      status: effectiveTaskStatus(resolved).key,
      parked: isParked(resolved),
      qty: resolved.qty,
      wo: resolved.wo,
      project: resolved.project || '',
      machine,
    };
  });
  const late = lines.filter((line) => !line.parked && line.status !== 'DONE' && line.cuttingDate && line.cuttingDate < shift.date);
  const backOrders = allBackOrders().flatMap((group) => group.rows.map((row) => ({
    wo: row.task.wo,
    project: row.task.project || '',
    machine: row.machine,
    qty: row.bo.qty,
  })));
  const staging = stagingQueue({ ref: shift.date });
  return {
    shift,
    centres: centreShiftProgress(lines, shift.date),
    late,
    backOrders,
    stagingLines: staging.todo.slice(0, 8).map((row) => ({ wo: row.task.wo, project: row.task.project || '' })),
    stagingTodo: staging.todo.length,
    stagingReady: staging.staged.length,
    todos: openTodos(shift.date),
  };
}

export function applyShiftWindow(date, shiftKey) {
  return shiftWindow(date, shiftKey);
}
