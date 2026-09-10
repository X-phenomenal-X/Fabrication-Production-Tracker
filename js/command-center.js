/* V2.1 read model. Operational reports are ordinary synced todos with optional
   metadata, so backup, offline use, deletion and conflict resolution stay shared. */
import { state, addTodo, setTodo } from './store.js';
import { MACHINES } from './machines.js';
import { machineConfig, todayBoard, today, shiftUpdateFor, workInShift } from './model.js';
import { shiftContextAt } from './shifts.js';
import { lossMinutesOn, LOSS_REASONS, MAINTENANCE_STATES, QUALITY_STATES } from './floor-operations.js';

export const OPERATION_KINDS = ['action', 'downtime', 'quality'];
export function operationKind(item) {
  return OPERATION_KINDS.includes(item.operation?.kind) ? item.operation.kind : 'action';
}
export function createOperation({ id = null, kind, text, machine = '', assignee = null, priority = 'normal', minutes = '', quantity = '', wo = '', date = today(), dueDate = '', details = {} }) {
  if (!OPERATION_KINDS.includes(kind)) throw new Error('Choose a valid report type.');
  if (!String(text || '').trim()) throw new Error('Describe what needs attention.');
  if (machine && !MACHINES.some(m => m.key === machine && !m.queue)) throw new Error('Choose a machine.');
  if (kind === 'downtime' && !machine) throw new Error('Choose the affected machine.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > today()) throw new Error('Choose a report date.');
  if (kind === 'action' && dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(Date.parse(dueDate)) || new Date(dueDate).toISOString().slice(0, 10) !== dueDate)) throw new Error('Choose a valid due date.');
  const number = (value, label) => {
    if (value === '' || value == null) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw new Error(`${label} must be a whole number of zero or more.`);
    return n;
  };
  const previous = id ? state.todos?.[id]?.operation || {} : {};
  if (previous.timer && previous.machine !== machine) throw new Error('A timed event cannot be moved to another machine.');
  const operation = { ...previous, kind, machine, dueDate: kind === 'action' ? dueDate || null : null, priority: priority === 'high' ? 'high' : 'normal', wo: String(wo).trim(),
    minutes: kind === 'downtime' ? number(minutes, 'Lost minutes') : null,
    quantity: kind === 'quality' ? number(quantity, 'Affected quantity') : null };
  if (previous.timer) operation.minutes = previous.minutes;
  if (kind === 'downtime') {
    operation.reason = LOSS_REASONS.includes(details.reason) ? details.reason : previous.reason || 'Other';
    operation.planned = details.planned === undefined ? !!previous.planned : !!details.planned;
    operation.maintenance = MAINTENANCE_STATES.includes(details.maintenance) ? details.maintenance : previous.maintenance || 'Not notified';
  }
  if (kind === 'quality') {
    for (const key of ['defect', 'source', 'containment', 'resolution']) operation[key] = String(details[key] ?? previous[key] ?? '').trim().slice(0, 2000);
    operation.qualityState = QUALITY_STATES.includes(details.qualityState) ? details.qualityState : previous.qualityState || 'Open';
    for (const key of ['rejected', 'reworked', 'replacement']) operation[key] = number(details[key] ?? previous[key] ?? '', key);
    operation.photos = details.photos ?? previous.photos ?? [];
    if (!Array.isArray(operation.photos) || operation.photos.length > 2 || operation.photos.some(p => typeof p.data !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(p.data) || p.data.length > 160000)) throw new Error('Maximum two compressed JPEG evidence photos.');
    const otherBytes = Object.values(state.todos).filter(t => t.id !== id).reduce((n, t) => n + JSON.stringify(t.operation?.photos || []).length, 0);
    if (otherBytes + JSON.stringify(operation.photos).length > 1500000) throw new Error('Evidence storage is full. Export a backup and review older photos.');
  }
  const prefix = kind === 'action' ? '' : `[${kind === 'quality' ? 'Quality' : 'Downtime'}] `;
  const body = prefix + String(text).trim();
  if (id) {
    if (!state.todos?.[id]) throw new Error('This report no longer exists.');
    setTodo(id, { text: body, date, assignee, operation });
    return id;
  }
  return addTodo(body, { date, assignee, operation });
}
export function completeOperation(id) { setTodo(id, { done: true }); }

export function commandSnapshot(ref = today(), now = new Date()) {
  const context = shiftContextAt(ref, now);
  const board = todayBoard(ref);
  const reports = Object.values(state.todos || {}).filter(t => t.date <= ref);
  const open = reports.filter(t => !t.done).sort((a, b) =>
    Number(b.operation?.priority === 'high') - Number(a.operation?.priority === 'high') || a.date.localeCompare(b.date));
  const down = open.filter(t => operationKind(t) === 'downtime');
  const machines = MACHINES.filter(m => !m.queue).map(machineConfig).filter(m => !m.hidden).map(m => {
    const update = shiftUpdateFor(m.key);
    const incidents = down.filter(t => t.operation.machine === m.key);
    const running = board.running.filter(r => r.machine === m.key);
    const shortages = board.backOrders.filter(r => r.machine === m.key);
    const status = incidents.length || m.down ? 'Reported down' : update?.down || update?.staleDown ? 'Check down report'
      : running.length ? 'Work in progress' : shortages.length ? 'Material shortage' : 'No active line';
    const tone = incidents.length || m.down ? 'bad' : update?.down || update?.staleDown || shortages.length ? 'warn' : running.length ? 'work' : 'mute';
    return { ...m, update, incidents, running, shortages, status, tone };
  });
  const completed = machines.flatMap(m => workInShift(m.key, context.date, context.key)).filter(h => h.to === 'DONE');
  const log = state.shiftLogs?.[`${context.date}|${context.key}`];
  const documented = machines.filter(m => {
    const row = log?.rows?.[m.key];
    return row && ['done', 'next', 'notes'].some(k => String(row[k] || '').trim());
  }).length;
  const losses = reports.filter(t => t.date === ref && operationKind(t) === 'downtime');
  return { context, board, reports, open, down, machines, completed, log, documented,
    quality: open.filter(t => operationKind(t) === 'quality'),
    minutes: Math.round(reports.filter(t => operationKind(t) === 'downtime').reduce((n, t) => n + lossMinutesOn(t, ref, now), 0)),
    unknownMinutes: losses.filter(t => t.operation?.minutes == null).length };
}

// The most recent shift can be handed over after midnight. Include reports
// entered today for that handover, but keep historical handovers date-bounded.
export function handoverReportDate(date, shift, ref = today(), now = new Date()) {
  const context = shiftContextAt(ref, now);
  return date === context.date && shift === context.key ? ref : date;
}

export function operationHandoverLines(ref = today()) {
  return Object.values(state.todos || {}).filter(t => !t.done && t.date <= ref).map(t => {
    const op = t.operation || {};
    const machine = MACHINES.find(m => m.key === op.machine);
    return `${t.text} — ${t.assignee || 'Unassigned'}${machine ? ' · ' + machineConfig(machine).label : ''}${op.wo ? ' · W/O ' + op.wo : ''}${op.dueDate ? ' · Due ' + op.dueDate : ''}${op.minutes != null ? ' · ' + op.minutes + ' min reported' : ''}`;
  });
}
