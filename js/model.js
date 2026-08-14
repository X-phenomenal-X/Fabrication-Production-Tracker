/* Derived views over the imported machine schedules. Everything here works on
   tasks — one row per (work order, die, machine) from the Rolling and CNC
   workbooks. */

import { state, EDITABLE_FIELDS } from './store.js';
import { PARSER_VERSION } from './import-machines.js';

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* ---------- per-line status ---------- */

export const TRACK_STATUS = {
  NOT_STARTED: { key: 'NOT_STARTED', label: 'Not started', tone: 'mute' },
  IN_PROGRESS: { key: 'IN_PROGRESS', label: 'In Progress', tone: 'work' },
  DONE: { key: 'DONE', label: 'Done', tone: 'ok' },
};
export const TRACK_STATUS_ORDER = ['NOT_STARTED', 'IN_PROGRESS', 'DONE'];

export function nextTrackStatus(key) {
  const i = TRACK_STATUS_ORDER.indexOf(key);
  return TRACK_STATUS_ORDER[(i + 1) % TRACK_STATUS_ORDER.length];
}

/** Stable identity for a machine-schedule line. Deliberately excludes the
    sheet row number that `task.id` carries — that number shifts on every
    re-import, which would silently orphan an operator's status update the
    next time the Rolling or CNC workbook is reloaded.

    Built from the *imported* work order and die (`origin`), never the edited
    ones, so correcting a die does not move the line's status, note and
    history to a different key. Note `task.sheet` is already the sheet name
    from the importer, hence `origin` for the pre-edit values. */
export function taskStatusKey(t) {
  const src = t.origin || t;
  return `${t.machine}|${src.wo}|${src.die || ''}`;
}

/** A line as it should be shown: what the workbook says, with any corrections
    laid over it. `origin` keeps the untouched original so the edit dialog can
    show what changed, and `edited` marks which fields differ. */
export function resolveTask(task) {
  const key = taskStatusKey(task);
  const override = state.taskEdit?.[key];
  if (!override?.fields || !Object.keys(override.fields).length) return task;

  const out = { ...task, origin: task.origin || { ...task }, edited: {} };
  for (const { key: f } of EDITABLE_FIELDS) {
    if (f in override.fields) {
      out[f] = override.fields[f];
      out.edited[f] = true;
    }
  }
  out.editedAt = override.at;
  out.editedBy = override.by;
  return out;
}

/** What a line actually shows: an operator's own update always wins. Failing
    that, the imported status collapses to the three tracked buckets. */
export function effectiveTaskStatus(t) {
  const override = state.taskStatus[taskStatusKey(t)];
  if (override?.status && TRACK_STATUS[override.status]) {
    return { ...TRACK_STATUS[override.status], by: override.by, at: override.at, overridden: true };
  }
  let bucket = 'NOT_STARTED';
  if (t.status === 'DONE') bucket = 'DONE';
  else if (t.status === 'IP') bucket = 'IN_PROGRESS';
  return { ...TRACK_STATUS[bucket], overridden: false };
}

/* ---------- queues ---------- */

/** All machine-schedule lines, excluding the Rolling "Complete" archive
    (finished by definition, not part of day-to-day tracking). */
export function tasksInScope() {
  return (state.tasks || []).filter((t) => !t.archived);
}

export function hasTasks() {
  return tasksInScope().length > 0;
}

/** Which machine a line is actually on. The CNC & FMC sheet has no machine
    column, so its lines import into a shared queue and are put on CNC 1, FMC 1
    or FMC 2 by hand. The assignment is an overlay: the line's key still uses
    the machine it was imported under, so moving it keeps its status, note,
    history and shortage. */
export function assignedMachine(task) {
  return state.taskAssign?.[taskStatusKey(task)]?.machine || task.machine;
}

export function isAssigned(task) {
  return !!state.taskAssign?.[taskStatusKey(task)]?.machine;
}

/** One machine's lines, each paired with its effective status. Rush lines come
    first — that is the whole point of marking one — then soonest cutting date.
    The view decides whether to hide Done lines. */
export function tasksForMachine(machineKey) {
  return tasksInScope()
    .filter((t) => assignedMachine(t) === machineKey)
    .map((t) => resolveTask(t))
    .map((task) => ({ task, status: effectiveTaskStatus(task), rush: resolveRush(task) }))
    .sort((a, b) => {
      if (a.rush.on !== b.rush.on) return a.rush.on ? -1 : 1;
      return (a.task.cuttingDate || '9999') < (b.task.cuttingDate || '9999') ? -1 : 1;
    });
}

export function openCountFor(machineKey) {
  return tasksForMachine(machineKey).filter((r) => r.status.key !== 'DONE').length;
}

/** Lines actually running on a machine right now — the answer to "what is
    this machine doing", meant to sit at the top of the page rather than be
    found by scrolling the queue. Same order as the queue itself: rush first,
    then soonest cutting date. */
export function runningNow(machineKey) {
  return tasksForMachine(machineKey).filter((r) => r.status.key === 'IN_PROGRESS');
}

/* ---------- date grouping ---------- */

/* Order matters: this is the order the groups render in, urgent first.
   `open` decides whether the group starts expanded — the urgent ones do,
   because they are the answer to "what do I run now". `cap` limits rows shown
   before a "Show more"; every group is capped, since the real data puts 74
   lines in Overdue and 97 in This week on Rolling (Auto) alone. */
export const DATE_GROUPS = [
  { key: 'OVERDUE', label: 'Overdue', tone: 'bad', open: true, cap: 25 },
  { key: 'TODAY', label: 'Today', tone: 'warn', open: true, cap: 25 },
  { key: 'WEEK', label: 'This week', tone: 'mute', open: true, cap: 25 },
  { key: 'LATER', label: 'Later', tone: 'mute', open: false, cap: 25 },
  { key: 'NODATE', label: 'No date', tone: 'mute', open: false, cap: 25 },
];

export function dateGroupOf(task, ref = today()) {
  const d = task.cuttingDate;
  if (!d) return 'NODATE';
  if (d < ref) return 'OVERDUE';
  if (d === ref) return 'TODAY';
  return d <= addDays(ref, 7) ? 'WEEK' : 'LATER';
}

/** A machine's queue, bucketed by cutting date and ready to render. */
export function groupedQueue(machineKey, { showDone = false, q = '', filter = 'ALL', ref = today() } = {}) {
  const term = q.trim().toLowerCase();
  const rows = tasksForMachine(machineKey)
    .filter((r) => showDone || r.status.key !== 'DONE')
    .filter((r) => {
      if (filter === 'ALL') return true;
      if (filter === 'BO') return resolveBackOrder(r.task).on;
      if (filter === 'RUSH') return r.rush.on;
      return r.status.key === filter;
    })
    .filter((r) => {
      if (!term) return true;
      const note = taskNoteFor(taskStatusKey(r.task))?.text || '';
      const hay = [r.task.wo, r.task.project, r.task.floor, r.task.die, r.task.comments, note]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(term);
    });

  const byKey = new Map(DATE_GROUPS.map((g) => [g.key, []]));
  for (const r of rows) byKey.get(dateGroupOf(r.task, ref)).push(r);

  return DATE_GROUPS
    .map((g) => ({ ...g, rows: byKey.get(g.key) }))
    .filter((g) => g.rows.length);
}

/** Headline counts for a machine, for the strip under the sub-tabs. */
export function machineSummary(machineKey, ref = today()) {
  const all = tasksForMachine(machineKey);
  const open = all.filter((r) => r.status.key !== 'DONE');
  return {
    total: all.length,
    open: open.length,
    inProgress: open.filter((r) => r.status.key === 'IN_PROGRESS').length,
    overdue: open.filter((r) => dateGroupOf(r.task, ref) === 'OVERDUE').length,
    backOrder: open.filter((r) => resolveBackOrder(r.task).on).length,
    rush: open.filter((r) => r.rush.on).length,
    done: all.length - open.length,
  };
}

/* ---------- rush ---------- */

export function rushFor(key) {
  return state.rush?.[key] || null;
}

/** A line's rush marking, plus how close its needed-by date is. `late` and
    `soon` are what turn the badge red rather than amber. */
export function resolveRush(task, ref = today()) {
  const rec = rushFor(taskStatusKey(task));
  if (!rec?.on) return { on: false };
  const needBy = rec.needBy || null;
  return {
    on: true,
    needBy,
    late: !!needBy && needBy < ref,
    soon: !!needBy && needBy >= ref && needBy <= addDays(ref, 2),
    assignee: rec.assignee || null,
    reason: rec.reason || null,
    at: rec.at || null,
    by: rec.by || null,
  };
}

/** Every rush line still open, across all machines, most urgent first. */
export function allRush(ref = today()) {
  const rows = [];
  for (const t of tasksInScope()) {
    const task = resolveTask(t);
    const rush = resolveRush(task, ref);
    if (!rush.on) continue;
    if (effectiveTaskStatus(task).key === 'DONE') continue;
    rows.push({ task, rush, machine: assignedMachine(task) });
  }
  return rows.sort((a, b) =>
    ((a.rush.needBy || a.task.cuttingDate || '9999') <
     (b.rush.needBy || b.task.cuttingDate || '9999') ? -1 : 1));
}

/* ---------- back orders ---------- */

export function backOrderFor(key) {
  return state.backOrder?.[key] || null;
}

/** A line's shortage, combining what someone recorded with what the workbook
    says. The recorded `flagged` is tri-state, so an explicit false clears a
    shortage the sheet still reports. */
export function resolveBackOrder(task) {
  const rec = backOrderFor(taskStatusKey(task)) || {};
  const fromSheet = !!task.backOrder;
  const on = rec.flagged == null ? fromSheet : !!rec.flagged;
  return {
    on,
    fromSheet,
    // Only a recorded count is trustworthy as "pieces short": the sheet's B/O
    // column counts BARS, and on FOM2/FOM3 writes them as text ("3 BARS").
    // That is kept separately as context rather than shown as a piece count.
    qty: rec.qty ?? null,
    sheetShort: task.boRaw || task.boStat || null,
    assignee: rec.assignee || null,
    note: rec.note || null,
    recorded: !!rec.at,
    at: rec.at || null,
    by: rec.by || null,
  };
}

/** Every flagged line across all machines, grouped by who is chasing it.
    Unassigned sorts last — it is the pile that needs an owner. */
export function allBackOrders() {
  const rows = [];
  for (const t of tasksInScope()) {
    const task = resolveTask(t);
    const bo = resolveBackOrder(task);
    if (!bo.on) continue;
    if (effectiveTaskStatus(task).key === 'DONE') continue;
    rows.push({ task, bo, machine: assignedMachine(task) });
  }

  const groups = new Map();
  for (const r of rows) {
    const who = r.bo.assignee || '';
    if (!groups.has(who)) groups.set(who, []);
    groups.get(who).push(r);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => ((a.task.cuttingDate || '9999') < (b.task.cuttingDate || '9999') ? -1 : 1));
  }

  return Array.from(groups.entries())
    .map(([assignee, list]) => ({ assignee, rows: list }))
    .sort((a, b) => {
      if (!a.assignee) return 1;
      if (!b.assignee) return -1;
      return a.assignee.localeCompare(b.assignee);
    });
}

/* ---------- notes & machine config ---------- */

export function taskNoteFor(key) {
  return state.taskNote?.[key] || null;
}

/** A machine as the department has configured it: the built-in definition
    with any local overrides (renamed, re-noted, different crew) applied. */
export function machineConfig(machine) {
  const cfg = state.machineConfig?.[machine.key] || {};
  return {
    ...machine,
    label: cfg.label || machine.label,
    note: cfg.note !== undefined ? cfg.note : machine.note,
    ops: cfg.ops !== undefined && cfg.ops !== null ? cfg.ops : machine.ops,
    hidden: !!cfg.hidden,
    customised: !!(cfg.label || cfg.note !== undefined || cfg.ops != null),
  };
}

/* ---------- stale imports ---------- */

/** Workbooks whose stored data was parsed by an older version of the importer.
    Their rows are not wrong so much as *out of date with the code*: a parsing
    fix only takes effect on the next import, so until then the app is showing
    what the old parser made of the file. Returns the kinds needing a re-import. */
export function staleImports() {
  return ['rolling', 'cnc'].filter((kind) => {
    const meta = state.machineMeta?.[kind];
    return meta && (meta.parser ?? 1) < PARSER_VERSION;
  });
}

/* ---------- shift update ---------- */

/** The latest word on a machine from the CNC workbook's Shift Update sheet:
    what ran, what is next, and whether the machine is down. */
export function shiftUpdateFor(machineKey) {
  const su = state.shiftUpdate;
  if (!su?.machines) return null;
  const entry = su.machines[machineKey];
  if (!entry) return null;
  // Entries carry their own date and shift: they no longer all come from one
  // block, since FMC 1 and FMC 2 only appear on a different one.
  return { date: su.date, shift: su.shift, ...entry };
}

/** How old the imported shift update is, in words. A shift update is only
    ever a snapshot of when the workbook was last saved, and "Latest shift
    update" next to a neutral date reads as current even when it is days
    behind — which is exactly how a day-old entry got taken for today's. */
export function shiftUpdateAge(date, ref = today()) {
  if (!date) return null;
  const days = Math.round((Date.parse(ref) - Date.parse(date)) / 86400000);
  if (days <= 0) return { days: 0, label: 'today', tone: 'ok' };
  if (days === 1) return { days, label: 'yesterday', tone: 'warn' };
  return { days, label: `${days} days old`, tone: 'bad' };
}

/* ---------- shift windows ---------- */

/* Day 07:00-15:00, Afternoon 15:00-23:00, Midnight 23:00-07:00 — the last
   crosses into the next day. Times are local, matching how the floor talks. */
export function shiftWindow(date, shift) {
  const mk = (d, h) => {
    const x = new Date(d + 'T00:00:00');
    x.setHours(h, 0, 0, 0);
    return x.getTime();
  };
  if (shift === 'DAY') return [mk(date, 7), mk(date, 15)];
  if (shift === 'AFT') return [mk(date, 15), mk(date, 23)];
  return [mk(date, 23), mk(addDays(date, 1), 7)];
}

/** Look a line up by its stable key, so history entries can be shown as work. */
export function taskByKey(key) {
  for (const t of tasksInScope()) {
    if (taskStatusKey(t) === key) return resolveTask(t);
  }
  return null;
}

/** What actually got tracked on a machine during a shift, reconstructed from
    the history log. This is what makes the update easy to write: the lines
    someone moved are offered rather than typed from memory. */
export function workInShift(machineKey, date, shift) {
  const [from, to] = shiftWindow(date, shift);
  const seen = new Map();

  for (const h of state.taskHistory || []) {
    if (h.kind !== 'status') continue;
    const t = Date.parse(h.at);
    if (!(t >= from && t < to)) continue;
    // Several changes to one line collapse to its latest state in the window.
    if (!seen.has(h.key)) seen.set(h.key, h);
  }

  const out = [];
  for (const [key, h] of seen) {
    const task = taskByKey(key);
    // Matched on where the line is *now*, not the key's prefix: a queued CNC
    // line keeps its `cncfmc|` key after being put on FMC 1.
    if (!task || assignedMachine(task) !== machineKey) continue;
    out.push({ task, to: h.to, by: h.by, at: h.at });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}
