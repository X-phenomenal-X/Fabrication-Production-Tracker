/* V2.1 read model. Operational reports are ordinary synced todos with optional
   metadata, so backup, offline use, deletion and conflict resolution stay shared. */
import { state, addTodo, setTodo } from './store.js';
import { MACHINES } from './machines.js';
import { machineConfig, todayBoard, today, shiftUpdateFor, workInShift } from './model.js';
import { shiftContextAt } from './shifts.js';

export const OPERATION_KINDS = ['action', 'downtime', 'quality'];
export function operationKind(item) {
  return OPERATION_KINDS.includes(item.operation?.kind) ? item.operation.kind : 'action';
}
export function createOperation({ id = null, kind, text, machine = '', assignee = null, priority = 'normal', minutes = '', quantity = '', wo = '', date = today() }) {
  if (!OPERATION_KINDS.includes(kind)) throw new Error('Choose a valid report type.');
  if (!String(text || '').trim()) throw new Error('Describe what needs attention.');
  if (machine && !MACHINES.some(m => m.key === machine && !m.queue)) throw new Error('Choose a machine.');
  if (kind === 'downtime' && !machine) throw new Error('Choose the affected machine.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > today()) throw new Error('Choose a report date.');
  const number = (value, label) => {
    if (value === '' || value == null) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw new Error(`${label} must be a whole number of zero or more.`);
    return n;
  };
  const operation = { kind, machine, priority: priority === 'high' ? 'high' : 'normal', wo: String(wo).trim(),
    minutes: kind === 'downtime' ? number(minutes, 'Lost minutes') : null,
    quantity: kind === 'quality' ? number(quantity, 'Affected quantity') : null };
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
    minutes: losses.reduce((n, t) => n + (Number(t.operation?.minutes) || 0), 0),
    unknownMinutes: losses.filter(t => t.operation?.minutes == null).length };
}

export function operationHandoverLines(ref = today()) {
  return Object.values(state.todos || {}).filter(t => !t.done && t.date <= ref).map(t => {
    const op = t.operation || {};
    const machine = MACHINES.find(m => m.key === op.machine);
    return `${t.text} — ${t.assignee || 'Unassigned'}${machine ? ' · ' + machineConfig(machine).label : ''}${op.wo ? ' · W/O ' + op.wo : ''}${op.minutes != null ? ' · ' + op.minutes + ' min reported' : ''}`;
  });
}
