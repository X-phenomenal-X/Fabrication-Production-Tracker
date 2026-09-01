/* The cover sheet for an incoming shift.

   This page stores nothing. It is a briefing assembled from the same queues,
   shortages, rush flags and shift logs the working pages already use, so its
   priorities cannot drift into a second version of the schedule. */

import { el, chip, icon, fmtDate, fmtNum, fmtWhen } from '../ui.js';
import { state, me } from '../store.js';
import {
  addDays, assignedMachine, effectiveTaskStatus, hasTasks, machineConfig,
  resolveBackOrder, resolveRush, resolveTask, shiftUpdateFor, taskNoteFor,
  taskStatusKey, tasksInScope, today, todayBoard,
} from '../model.js';
import { MACHINES, MACHINE_BY_KEY } from '../machines.js';
import { SHIFTS, shiftContextAt } from '../shifts.js';
import { focusCentreTask, setAnimatedStatus } from './centre.js';

const GROUP_PAGE = { Rolling: 'rolling', FOM: 'fom', CNC: 'cnc', Punch: 'punch' };
/* Which shift handed over to this one. Nights were retired, so the Day crew's
   handoff now comes from yesterday's Afternoon — but shift logs written while
   nights still ran are still on file, so a Midnight log for the same date is
   read in preference when one exists. */
const PREVIOUS_SHIFT = {
  DAY: { key: 'AFT', day: -1, legacy: 'NIGHT' },
  AFT: { key: 'DAY', day: 0 },
  NIGHT: { key: 'AFT', day: 0 },
};

function longDate(iso) {
  const date = new Date(iso + 'T00:00:00');
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(date);
}

function previousHandoff(date, shiftKey) {
  /* An unrecognised shift key would take the whole page down with it, and this
     is the page the app opens on. Falling back to the Day handoff shows
     something slightly wrong instead of nothing at all. */
  const previous = PREVIOUS_SHIFT[shiftKey] || PREVIOUS_SHIFT.DAY;
  const previousDate = addDays(date, previous.day);
  const log = state.shiftLogs?.[`${previousDate}|${previous.key}`]
    || (previous.legacy ? state.shiftLogs?.[`${previousDate}|${previous.legacy}`] : null)
    || null;
  const source = log?.rows || {};
  const usefulRow = Object.entries(source).find(([, row]) =>
    String(row?.notes || row?.next || row?.done || '').trim());
  const rowText = usefulRow
    ? String(usefulRow[1].notes || usefulRow[1].next || usefulRow[1].done || '').trim().split('\n')[0]
    : '';
  return {
    key: previous.key,
    label: SHIFTS[previous.key].label,
    date: previousDate,
    log,
    text: String(log?.notes || '').trim() || rowText || 'No written handoff for this shift yet.',
  };
}

function machineLabel(key) {
  const machine = MACHINE_BY_KEY[key];
  return machine ? machineConfig(machine).label : key || 'Unassigned';
}

function rowFor(task, ref) {
  const resolved = resolveTask(task);
  return {
    task: resolved,
    machine: assignedMachine(resolved),
    status: effectiveTaskStatus(resolved),
    rush: resolveRush(resolved, ref),
    bo: resolveBackOrder(resolved),
  };
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = taskStatusKey(row.task);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function urgency(a, b) {
  if (a.rush.on !== b.rush.on) return a.rush.on ? -1 : 1;
  if (a.bo.on !== b.bo.on) return a.bo.on ? -1 : 1;
  if (a.status.key !== b.status.key) {
    if (a.status.key === 'IN_PROGRESS') return -1;
    if (b.status.key === 'IN_PROGRESS') return 1;
  }
  const ad = a.task.cuttingDate || '9999-99-99';
  const bd = b.task.cuttingDate || '9999-99-99';
  return ad === bd ? String(a.task.wo).localeCompare(String(b.task.wo), undefined, { numeric: true })
    : ad.localeCompare(bd);
}

function openTask(row, go) {
  const page = focusCentreTask(row.task);
  go(page || GROUP_PAGE[MACHINE_BY_KEY[row.machine]?.group] || 'today');
}

function taskContext(row) {
  const note = taskNoteFor(taskStatusKey(row.task))?.text;
  return row.rush.reason || row.bo.note || note || row.task.comments || '';
}

function taskBadges(row) {
  return [
    row.task.die ? el('span.die', {}, row.task.die) : null,
    row.rush.on ? chip('Rush', row.rush.late ? 'bad' : 'warn') : null,
    row.bo.on ? chip('B/O', 'bad') : null,
  ];
}

function dueText(task, ref) {
  if (!task.cuttingDate) return 'No cutting date';
  const prefix = task.cuttingDate < ref ? 'Due' : task.cuttingDate === ref ? 'Due today' : 'Due';
  return `${prefix} ${fmtDate(task.cuttingDate)}`;
}

function primaryWork(row, ref, go, rerender) {
  if (!row) return el('div.overview-empty', {},
    icon('check', { size: 24 }),
    el('div', {}, el('strong', {}, 'Nothing overdue'),
      el('div.small.muted', {}, 'The next scheduled lines are shown below.')));

  const context = taskContext(row);
  return el('div.overview-focus-card', { 'data-motion-key': taskStatusKey(row.task) },
    el('div.overview-focus-icon' + (row.bo.on ? '.bad' : row.rush.on ? '.warn' : ''), {},
      icon(row.rush.on ? 'bolt' : 'alert', { size: 28 })),
    el('div.overview-focus-copy', {},
      el('div.overview-task-id', {},
        el('strong.mono', {}, row.task.wo),
        ...taskBadges(row)),
      el('div.overview-project', {},
        row.task.project || 'No project',
        row.task.floor ? el('span.muted', {}, ` · ${row.task.floor}`) : null),
      context ? el('div.overview-context', {}, context) : null),
    el('div.overview-focus-qty', {},
      el('strong.mono', {}, fmtNum(row.task.qty)),
      el('span', {}, 'pcs'),
      el('small', {}, dueText(row.task, ref))),
    row.status.key === 'IN_PROGRESS'
      ? el('button.overview-done', {
          title: `Mark work order ${row.task.wo} done`,
          'aria-label': `Mark work order ${row.task.wo} done`,
          onclick: (event) => setAnimatedStatus(row, 'DONE', rerender,
            event.currentTarget, event.currentTarget.closest('.overview-focus-card')),
        },
          el('span.overview-done-mark', {}, icon('check', { size: 32 })),
          el('span', {}, el('strong', {}, 'Done'), el('small', {}, 'Mark complete')))
      : el('button.primary.overview-open', {
          onclick: () => openTask(row, go),
          'aria-label': `Open work order ${row.task.wo}`,
        }, icon('arrow', { size: 18 }), el('span', {}, 'Open W/O', el('b.mono', {}, row.task.wo))));
}

function upcomingRow(row, ref, go) {
  return el('button.overview-upcoming-row', {
    onclick: () => openTask(row, go),
    'aria-label': `Open work order ${row.task.wo}`,
  },
    el('span.overview-row-icon', {}, icon('clock', { size: 18 })),
    el('span.overview-row-main', {},
      el('span', {}, el('strong.mono', {}, row.task.wo), ...taskBadges(row)),
      el('span', {}, row.task.project || 'No project', row.task.floor ? ` · ${row.task.floor}` : '')),
    el('span.overview-row-qty', {}, el('strong.mono', {}, fmtNum(row.task.qty)), ' pcs'),
    el('span.overview-row-date', {}, dueText(row.task, ref)),
    icon('chevron', { size: 17 }));
}

function watchTask(label, row, tone, iconName, go, targetPage = null) {
  if (!row) return null;
  const context = taskContext(row);
  return el('button.overview-watch-row.' + tone, {
    onclick: () => targetPage ? go(targetPage) : openTask(row, go),
    'aria-label': `${label}: open work order ${row.task.wo}`,
  },
    el('span.overview-watch-icon', {}, icon(iconName, { size: 20 })),
    el('span.overview-watch-label', {}, label),
    el('span.overview-watch-main', {},
      el('strong', {}, row.task.wo, ' ', row.task.project || ''),
      el('span', {}, context || machineLabel(row.machine))),
    el('span.overview-watch-qty.mono', {}, `${fmtNum(row.task.qty)} pcs`),
    icon('chevron', { size: 17 }));
}

function machineIssue(go) {
  for (const machine of MACHINES.filter((item) => !item.queue)) {
    const update = shiftUpdateFor(machine.key);
    if (!update?.down && !update?.staleDown) continue;
    const note = update.notes?.[0] || (update.staleDown
      ? `Down status carried from ${fmtDate(update.staleDown)}` : 'Reported down in the latest shift update.');
    return el('button.overview-watch-row.warn', {
      onclick: () => go(GROUP_PAGE[machine.group]),
      'aria-label': `Open ${machineConfig(machine).label}`,
    },
      el('span.overview-watch-icon', {}, icon('gear', { size: 20 })),
      el('span.overview-watch-label', {}, 'Machine issue'),
      el('span.overview-watch-main', {},
        el('strong', {}, machineConfig(machine).label),
        el('span', {}, note)),
      el('span.overview-watch-qty', {}, 'Down'),
      icon('chevron', { size: 17 }));
  }
  return null;
}

function band(step, title, hint, tone, body) {
  return el('section.overview-band.' + tone, {},
    el('header.overview-band-head', {},
      el('span.overview-step', {}, String(step)),
      el('h2', {}, title),
      el('span', {}, hint)),
    body);
}

function healthStat(iconName, value, label, tone = 'work', detail = '') {
  return el(`div.overview-health-stat.${tone}`, {},
    el('span.overview-health-icon', { 'aria-hidden': 'true' }, icon(iconName, { size: 22 })),
    el('div', {},
      el('strong.mono', {}, value),
      el('span', {}, label),
      detail ? el('small', {}, detail) : null));
}

function quickStart(label, detail, iconName, page, go, on) {
  return el('button.overview-quick' + (on ? '.on' : ''), {
    onclick: () => go(page),
  },
    el('span.overview-quick-icon', {}, icon(iconName, { size: 24 })),
    el('span', {}, el('strong', {}, label), el('small', {}, detail)),
    icon('chevron', { size: 18 }));
}

export function renderOverview(rerender, go, sync = null) {
  const ref = today();
  const shiftContext = shiftContextAt(ref);
  const handoff = previousHandoff(shiftContext.date, shiftContext.key);
  const shift = shiftContext.shift;

  /* The crew line used to read shift.crew, a field the two-shift rewrite
     removed, so it silently said "Full crew" for everybody forever. The real
     number is in the machine list: `ops` per machine, from the department's own
     Shift Assignment sheet and editable in Setup. Machines that are hidden or
     down are left out, because the point of the line is how many people are
     actually on the floor. */
  const staffed = MACHINES
    .map(machineConfig)
    .filter((m) => !m.queue && !m.hidden && !m.down);
  const heads = staffed.reduce((n, m) => n + (Number(m.ops) || 0), 0);
  const crew = heads
    ? `${heads} operator${heads === 1 ? '' : 's'} across ${staffed.length} machines`
    : 'Crew not set';

  const all = tasksInScope().map((task) => rowFor(task, ref));
  const open = all.filter((row) => row.status.key !== 'DONE').sort(urgency);
  const done = all.length - open.length;
  const donePct = all.length ? Math.round((done / all.length) * 100) : 0;

  const board = hasTasks() ? todayBoard(ref) : {
    overdue: [], rushNow: [], dueToday: [], running: [], backOrders: [], finishedToday: [],
  };
  const urgent = uniqueRows([
    ...board.overdue, ...board.rushNow, ...board.dueToday, ...board.running,
  ]).sort(urgency);
  // Running work is the hero of a live command surface. An overdue or rush
  // line still appears in Needs attention, but it does not replace the line
  // the operator is physically cutting right now.
  const first = board.running[0] || urgent[0] || open[0] || null;
  const firstKey = first ? taskStatusKey(first.task) : null;
  const coming = open
    .filter((row) => taskStatusKey(row.task) !== firstKey)
    .filter((row) => !row.task.cuttingDate || row.task.cuttingDate >= ref)
    .slice(0, 2);
  const backOrder = board.backOrders.find((row) => taskStatusKey(row.task) !== firstKey) || null;
  const rush = board.rushNow.find((row) => taskStatusKey(row.task) !== firstKey) || null;
  const runningMachines = new Set(board.running
    .map((row) => assignedMachine(row.task))
    .filter(Boolean)).size;
  const syncState = sync || {
    label: 'this device only', tone: 'mute', icon: 'cloud', detail: 'Local copy',
    configured: false, pending: 0, active: false, at: null,
  };
  const syncValue = syncState.active ? 'SYNCING'
    : syncState.tone === 'ok' ? 'LIVE'
      : syncState.tone === 'bad' ? 'ERROR'
        : syncState.tone === 'warn' ? 'OFFLINE'
          : syncState.pending ? `${syncState.pending} PENDING` : 'LOCAL';
  const healthStrip = el('section.overview-health-strip', {
    'aria-label': 'Current shift health',
  },
    healthStat('check', `${donePct}%`, 'Schedule complete', 'ok', `${fmtNum(done)} / ${fmtNum(all.length)} lines`),
    healthStat('factory', String(runningMachines), 'Machines running', 'work', `${fmtNum(board.running.length)} active lines`),
    healthStat('calendar', String(board.dueToday.length), 'Due today', 'warn'),
    healthStat('alert', String(board.backOrders.length), 'Blocked', 'bad'),
    healthStat(syncState.icon || 'cloud', syncValue, 'Sync', syncState.tone || 'mute',
      syncState.at ? fmtWhen(syncState.at) : syncState.label));

  const handoffCard = el('section.overview-handoff' + (handoff.log ? '' : '.empty'), {},
    el('span.overview-handoff-icon', {}, icon('clipboard', { size: 21 })),
    el('div.overview-handoff-title', {}, `Handoff from ${handoff.label}`),
    handoff.log ? el('div.overview-handoff-by', {},
      el('strong', {}, handoff.log.by || 'Previous shift'),
      el('span', {}, fmtWhen(handoff.log.at))) : null,
    el('p', {}, handoff.text),
    el('button.ghost', { onclick: () => go('shift') },
      handoff.log ? 'View full handoff' : 'Write a handoff', icon('chevron', { size: 16 })));

  const brief = el('header.overview-brief', {},
    el('div.overview-intro', {},
      el('div.overview-kicker', {}, 'Kinetic command stack'),
      el('div.overview-date', {}, longDate(shiftContext.date)),
      /* `range` is the shift's own printed hours. This read shift.from/shift.to,
         which the two-shift rewrite removed, so the headline of the page the
         app opens on said "undefined:00–undefined:00".

         When no shift is running the page still has to name one — it is
         summarising a shift's work — but it must not imply a crew is standing
         there while the header chip says Off shift. So it says which shift this
         was. */
      el('div.overview-shift', {},
        el('strong', {}, `${shift.label} shift`),
        shift.range ? el('span', {}, `· ${shift.range}`) : null,
        shiftContext.live ? null : el('span.chip.mute.overview-ended', {}, 'ended')),
      el('div.overview-crew', {}, icon('dot', { size: 12 }),
        shiftContext.live ? crew : 'Nobody on the floor right now',
        me() ? ` · ${me()}` : '')),
    handoffCard,
    healthStrip);

  const currentLog = state.shiftLogs?.[`${shiftContext.date}|${shiftContext.key}`] || null;
  const loggedMachines = currentLog ? Object.keys(currentLog.rows || {}).length : 0;
  const shiftRail = el('section.overview-shift-rail', {
    'aria-label': 'Current shift update',
  },
    el('span.overview-shift-rail-icon', {}, icon('pencil', { size: 18 })),
    el('strong', {}, 'Shift update'),
    el('span.overview-shift-rail-state.' + (currentLog ? 'ok' : 'warn'), {},
      currentLog ? 'Written here' : 'Not written yet'),
    currentLog ? el('span.overview-shift-rail-detail', {},
      `${currentLog.by || 'Previous operator'} · ${loggedMachines} machine${loggedMachines === 1 ? '' : 's'}`)
      : el('span.overview-shift-rail-detail', {}, 'Leave the next crew one clear handoff.'),
    el('button.ghost', { onclick: () => go('shift') },
      currentLog ? 'View all' : 'Write now', icon('chevron', { size: 16 })));

  const quick = el('aside.overview-quickstarts', {},
    el('h2', {}, 'Quick starts'),
    quickStart('Today', 'View today’s plan', 'calendar', 'today', go),
    quickStart('Stage material', 'Prepare upcoming work', 'staging', 'staging', go),
    quickStart('Die lookup', 'Search dies and components', 'search', 'dies', go),
    quickStart('Write shift update', 'Share notes for the next crew', 'pencil', 'shift', go,
      !state.shiftLogs?.[`${shiftContext.date}|${shiftContext.key}`]));

  if (!hasTasks()) {
    return el('div.overview', {},
      brief,
      el('div.overview-layout', {},
        el('div.overview-main', {},
          el('section.overview-no-data', {},
            icon('upload', { size: 30 }),
            el('h2', {}, 'Load the schedules to start the briefing'),
            el('p', {}, 'The cover page will show the most urgent work, upcoming handoffs, rush lines and shortages.'),
            el('button.primary', { onclick: () => go('setup') }, 'Go to Setup'))),
        quick));
  }

  const keepWatch = [
    // A shortage is acted on in the department-wide chase list; opening only
    // its machine queue leaves ownership and the other shortages out of view.
    watchTask('Back order', backOrder, 'bad', 'alert', go, 'backorders'),
    watchTask('Rush line', rush, 'warn', 'bolt', go),
    machineIssue(go),
  ].filter(Boolean);

  return el('div.overview', {},
    brief,
    el('div.overview-layout', {},
      el('div.overview-main', {},
        band(1, first?.status?.key === 'IN_PROGRESS' ? 'Running now' : 'Do now',
          first?.status?.key === 'IN_PROGRESS'
            ? `On ${machineLabel(first.machine)} · the line moving on the floor.`
            : 'One thing to focus on first.',
          'work', primaryWork(first, ref, go, rerender)),
        band(2, 'Coming next', 'Scheduled handoffs to keep the floor moving.', 'accent',
          coming.length
            ? el('div.overview-upcoming', {}, ...coming.map((row) => upcomingRow(row, ref, go)))
            : el('div.overview-empty', {}, icon('check', { size: 22 }), 'No additional work is due next.')),
        band(3, 'Keep an eye on', 'Items that may affect the shift.', 'bad',
          keepWatch.length
            ? el('div.overview-watch', {}, ...keepWatch)
            : el('div.overview-empty', {}, icon('check', { size: 22 }), 'No active rush, shortage or machine issue.'))),
      quick),
    shiftRail);
}
