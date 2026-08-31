/* Department broadcast board for a ceiling-mounted shop monitor.

   This deliberately reads the same derived model as the operator pages. It
   does not store a second schedule, invent partial quantities, or expose any
   controls. The three questions are fixed: what is running, what comes next,
   and what needs intervention. */

import { el, fmtDate, fmtNum, icon } from '../ui.js';
import { brandLockup } from '../brand.js';
import {
  assignedMachine, effectiveTaskStatus, isParked, machineConfig, machineSummary,
  resolveBackOrder, resolveRush, resolveTask, runningNow, shiftUpdateFor,
  taskStatusKey, tasksForMachine, tasksInScope, today, todayBoard,
} from '../model.js';
import { MACHINES, MACHINE_BY_KEY } from '../machines.js';
import { routeFor, SOP } from '../routing.js';
import { shiftStatusAt } from '../shifts.js';

const CYCLE_PAGES = 3;
let cycle = 0;
let cycleTimer = null;

const GROUPS = [
  { key: 'rolling', label: 'Rolling', machines: ['roll-auto', 'roll-man'] },
  { key: 'fom', label: 'FOM', machines: ['fom1', 'fom2', 'fom3'] },
  { key: 'punch', label: 'Multi Punch', machines: ['multipunch', 'saw'] },
  { key: 'cnc', label: 'CNC / FMC', machines: ['cnc1', 'fmc1', 'fmc2', 'cncfmc'] },
];

function machineName(key) {
  const machine = MACHINE_BY_KEY[key];
  return machine ? machineConfig(machine).label : key || 'Unassigned';
}

function visibleMachine(key) {
  const machine = MACHINE_BY_KEY[key];
  return machine && !machineConfig(machine).hidden;
}

function taskUrgency(a, b) {
  if (a.rush?.on !== b.rush?.on) return a.rush?.on ? -1 : 1;
  if (a.bo?.on !== b.bo?.on) return a.bo?.on ? -1 : 1;
  const ad = a.task.cuttingDate || '9999-99-99';
  const bd = b.task.cuttingDate || '9999-99-99';
  return ad === bd
    ? String(a.task.wo || '').localeCompare(String(b.task.wo || ''), undefined, { numeric: true })
    : ad.localeCompare(bd);
}

function machineRows(group, status) {
  return group.machines
    .filter(visibleMachine)
    .flatMap((machine) => {
      const rows = status === 'IN_PROGRESS'
        ? runningNow(machine)
        : tasksForMachine(machine).filter((row) => !isParked(row.task) && row.status.key === status);
      return rows.map((row) => ({
        ...row,
        machine,
        bo: resolveBackOrder(row.task),
      }));
    })
    .sort(taskUrgency);
}

function scheduleProgress(machine) {
  const summary = machineSummary(machine);
  return summary.total ? Math.round((summary.done / summary.total) * 100) : 0;
}

function groupCard(group) {
  const live = machineRows(group, 'IN_PROGRESS');
  const waiting = live.length ? [] : machineRows(group, 'NOT_STARTED');
  const rows = live.length ? live : waiting;
  const row = rows.length ? rows[cycle % rows.length] : null;
  const running = !!live.length;

  if (!row) {
    return el('section.monitor-now-card.idle', { 'aria-label': `${group.label}: idle` },
      el('div.monitor-now-state', {}, group.label),
      el('div.monitor-idle-word', {}, 'IDLE'),
      el('div.monitor-card-sub', {}, 'No open work scheduled'));
  }

  const task = row.task;
  const progress = scheduleProgress(row.machine);
  const operator = running && row.status.by ? `Set running by ${row.status.by}`
    : running ? 'Operator not recorded'
      : task.cuttingDate ? `Due ${fmtDate(task.cuttingDate)}` : 'No cutting date';

  return el(`section.monitor-now-card.${running ? 'running' : 'waiting'}`, {
    'aria-label': `${group.label}: ${running ? 'running' : 'next'} work order ${task.wo}`,
  },
    el('div.monitor-now-state', {}, group.label,
      el('span.monitor-machine', {}, machineName(row.machine))),
    el('div.monitor-order-line', {},
      el('strong.monitor-wo', {}, task.wo || '—'),
      task.die ? el('span.monitor-die', {}, task.die) : null,
      el('span.monitor-qty', {},
        el('b', {}, fmtNum(task.qty)),
        el('small', {}, 'pcs'))),
    el('div.monitor-project', {}, task.project || 'No project',
      task.floor ? el('span', {}, ` · ${task.floor}`) : null),
    el('div.monitor-card-sub', {},
      el('span', {}, running ? 'RUNNING' : 'NEXT'),
      el('span', {}, operator)),
    el('div.monitor-progress-row', {},
      el('span.monitor-progress-track', {
        role: 'progressbar',
        'aria-label': `${machineName(row.machine)} schedule completion`,
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(progress),
      }, el('i', { style: { width: `${progress}%` } })),
      el('b', {}, `${progress}%`)),
    el('div.monitor-progress-caption', {}, `${machineName(row.machine)} schedule complete`));
}

function nextWork() {
  const candidates = GROUPS.flatMap((group) => machineRows(group, 'NOT_STARTED').slice(0, 1))
    .sort(taskUrgency)
    .slice(0, 3);

  return el('section.monitor-next', { 'aria-label': 'Next scheduled work' },
    el('div.monitor-band-label', {}, 'NEXT'),
    el('div.monitor-next-list', {},
      ...candidates.map((row, index) => el('article.monitor-next-item', {},
        el('span.monitor-next-rank', {}, String(index + 1)),
        el('div.monitor-next-order', {},
          el('strong', {}, row.task.wo || '—'),
          row.task.die ? el('span', {}, row.task.die) : null),
        el('div.monitor-next-project', {}, row.task.project || 'No project'),
        el('div.monitor-next-meta', {},
          machineName(row.machine),
          row.task.cuttingDate ? ` · ${fmtDate(row.task.cuttingDate)}` : ' · no date'))),
      ...(!candidates.length ? [el('div.monitor-next-empty', {}, 'No waiting work scheduled')] : [])));
}

function downIssue() {
  for (const machine of MACHINES.filter((item) => !item.queue && visibleMachine(item.key))) {
    const update = shiftUpdateFor(machine.key);
    if (!update?.down && !update?.staleDown) continue;
    return {
      tone: 'bad', icon: 'gear', label: 'MACHINE DOWN',
      primary: machineName(machine.key),
      detail: update.notes?.[0] || (update.staleDown
        ? `Carried from ${fmtDate(update.staleDown)}` : 'Reported in the latest shift update'),
    };
  }
  return null;
}

function shortageIssue(board) {
  const row = [...board.backOrders].sort(taskUrgency)[0];
  if (!row) return null;
  return {
    tone: 'bad', icon: 'alert', label: 'MATERIAL SHORTAGE',
    primary: `${machineName(row.machine)} · ${row.task.wo}`,
    detail: row.bo.note || row.bo.sheetShort || row.task.project || 'Material is back ordered',
  };
}

function rushIssue(board) {
  const row = [...board.rushNow].sort(taskUrgency)[0];
  if (!row) return null;
  return {
    tone: 'warn', icon: 'clock', label: row.rush.late ? 'RUSH JOB LATE' : 'RUSH JOB',
    primary: `${machineName(row.machine)} · ${row.task.wo}`,
    detail: row.rush.reason || (row.rush.needBy ? `Needed ${fmtDate(row.rush.needBy)}` : row.task.project),
  };
}

function sopIssue(ref) {
  const rows = tasksInScope()
    .map(resolveTask)
    .filter((task) => effectiveTaskStatus(task).key !== 'DONE' && !isParked(task))
    .map((task) => {
      const machine = assignedMachine(task);
      const route = routeFor({ ...task, machine });
      return { task, machine, route, rush: resolveRush(task, ref), bo: resolveBackOrder(task) };
    })
    .filter((row) => row.route?.at < 0 && row.route.steps.some((step) => step.machine))
    .sort(taskUrgency);
  const row = rows[0];
  if (!row) return null;
  const expected = row.route.steps.filter((step) => step.machine).map((step) => step.station).join(' → ');
  return {
    tone: 'sop', icon: 'list', label: `${SOP.id} DEVIATION`,
    primary: `${machineName(row.machine)} · ${row.task.wo}`,
    detail: expected ? `Expected path: ${expected}` : 'The schedule is off the documented route',
  };
}

function attention(board, ref) {
  const critical = downIssue() || shortageIssue(board);
  const issues = [critical, rushIssue(board), sopIssue(ref)].filter(Boolean);
  if (issues.length < 3 && critical?.label === 'MACHINE DOWN') {
    const shortage = shortageIssue(board);
    if (shortage) issues.splice(1, 0, shortage);
  }
  const shown = issues.slice(0, 3);

  return el('aside.monitor-attention', { 'aria-label': 'Needs attention' },
    el('h2', {}, 'NEEDS ATTENTION'),
    el('div.monitor-attention-list', {},
      ...shown.map((issue) => el(`article.monitor-alert.${issue.tone}`, {},
        el('span.monitor-alert-symbol', { 'aria-hidden': 'true' }, icon(issue.icon, { size: 42 })),
        el('div.monitor-alert-copy', {},
          el('div.monitor-alert-label', {}, issue.label),
          el('strong', {}, issue.primary),
          el('span', {}, issue.detail)))),
      ...(!shown.length ? [el('div.monitor-all-clear', {},
        el('strong', {}, 'ALL CLEAR'),
        el('span', {}, 'No active blockers or routing conflicts'))] : [])));
}

function clockParts(now = new Date()) {
  return {
    time: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(now),
    date: new Intl.DateTimeFormat(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    }).format(now),
  };
}

function syncCopy(sync) {
  if (!sync) return { tone: 'mute', label: 'DEVICE ONLY', detail: 'Local storage active' };
  const label = sync.tone === 'ok' ? 'SYNCED'
    : sync.tone === 'warn' ? 'OFFLINE'
      : sync.tone === 'bad' ? 'SYNC ISSUE'
        : sync.active ? 'SYNCING' : 'DEVICE ONLY';
  let detail = sync.label || '';
  if (detail === 'this device only') detail = 'Local storage active';
  if (sync.at) {
    detail = `Refreshed ${new Intl.DateTimeFormat(undefined, {
      hour: 'numeric', minute: '2-digit', second: '2-digit',
    }).format(new Date(sync.at))}`;
  }
  return { tone: sync.tone || 'mute', label, detail };
}

function monitorHeader(sync) {
  const now = new Date();
  const clock = clockParts(now);
  const shift = shiftStatusAt(now);
  const shiftText = shift.shift ? `${shift.shift.label} · ${shift.shift.range}` : 'Off shift · Day starts 07:00';
  const connection = syncCopy(sync);
  const page = cycle % CYCLE_PAGES + 1;

  return el('header.monitor-header', {},
    el('div.monitor-identity', {},
      brandLockup(),
      el('div.monitor-product', {},
        el('strong', {}, 'BV CUTTING'),
        el('span.monitor-shift-label', {}, shiftText))),
    el('time.monitor-clock', {}, clock.time),
    el('div.monitor-health', {},
      el(`strong.${connection.tone}`, {}, connection.label),
      el('span.monitor-refresh', {}, `${connection.detail || 'Status current'} · ${clock.date}`)),
    el('div.monitor-cycle', { 'aria-label': `Automatic rotation page ${page} of ${CYCLE_PAGES}` },
      el('b', {}, String(page)), ` of ${CYCLE_PAGES}`));
}

function pulse(board, all, done, blocked) {
  const completion = all.length ? Math.round((done / all.length) * 100) : 0;
  const activeMachines = MACHINES.filter((machine) => !machine.queue && visibleMachine(machine.key)
    && runningNow(machine.key).length).length;
  const stat = (value, label, tone = '') => el(`div.monitor-pulse-stat${tone ? '.' + tone : ''}`, {},
    el('strong', {}, value), el('span', {}, label));

  return el('section.monitor-pulse', { 'aria-label': 'Department pulse' },
    stat(`${completion}%`, 'schedule complete'),
    stat(String(activeMachines), 'machines running', 'work'),
    stat(fmtNum(board.dueToday.length), 'due today'),
    stat(fmtNum(blocked), 'blocked', blocked ? 'bad' : 'ok'));
}

export function renderMonitorDashboard(sync) {
  const ref = today();
  const board = todayBoard(ref);
  const all = tasksInScope().map(resolveTask).filter((task) => !isParked(task));
  const done = all.filter((task) => effectiveTaskStatus(task).key === 'DONE').length;
  const down = MACHINES.filter((machine) => !machine.queue && shiftUpdateFor(machine.key)?.down).length;
  const blocked = board.backOrders.length + down;

  if (!all.length) {
    return el('main.monitor-shell', {},
      monitorHeader(sync),
      el('section.monitor-no-data', {},
        el('strong', {}, 'NO PRODUCTION SCHEDULE LOADED'),
        el('span', {}, 'Load the machine workbooks from Setup on an operator device.')));
  }

  return el('main.monitor-shell', {},
    monitorHeader(sync),
    pulse(board, all, done, blocked),
    el('div.monitor-body.monitor-cycle-enter', {},
      el('section.monitor-now', { 'aria-label': 'Running now' },
        el('div.monitor-band-label', {}, 'NOW'),
        el('div.monitor-now-grid', {}, ...GROUPS.map(groupCard))),
      attention(board, ref)),
    nextWork());
}

export function armMonitorRotation(rerender) {
  if (cycleTimer) return;
  cycleTimer = setInterval(() => {
    cycle = (cycle + 1) % CYCLE_PAGES;
    rerender();
  }, 20000);
}

export function refreshMonitorClock() {
  const clock = document.querySelector('.monitor-clock');
  const shiftLabel = document.querySelector('.monitor-shift-label');
  if (clock) clock.textContent = clockParts().time;
  if (shiftLabel) {
    const shift = shiftStatusAt();
    shiftLabel.textContent = shift.shift
      ? `${shift.shift.label} · ${shift.shift.range}`
      : 'Off shift · Day starts 07:00';
  }
}
