/* Derived views over the imported machine schedules. Everything here works on
   tasks — one row per (work order, die, machine) from the Rolling and CNC
   workbooks. */

import { state, EDITABLE_FIELDS, stateRev } from './store.js';
import { PARSER_VERSION } from './import-machines.js';
import { MACHINES } from './machines.js';
import { sopMachine } from './routing.js';
import { SHIFTS, normalizeShift } from './shifts.js';

/* machineKey -> centre, for keeping a learned route inside its own centre. */
const MACHINE_GROUP = Object.fromEntries(MACHINES.map((m) => [m.key, m.group]));

export function today(date = new Date()) {
  // Operational dates are Toronto shop dates, not UTC dates. During the
  // Afternoon shift, UTC crosses midnight hours before the crew does.
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    + `-${String(date.getDate()).padStart(2, '0')}`;
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

/* ---------- one job, several stations ---------- */

/* A work order and die is one job, and it is worked at more than one station:
   the material is rolled, then cut, then punched, then machined. The workbooks
   carry a row per station, and those rows go stale independently — 609 of the
   3,228 jobs on the current schedules span two or three machines, and 99 of
   them have a later station finished while an earlier one still reads IP, or
   nothing at all.

   W/O 30996 S80.104 is the shape of it: `roll-auto: IP`, `fom2: DONE`. It
   cannot have been cut at FOM 2 without having been rolled first. Rolling's row
   is simply stale, and every open count, staging list and shift update that
   reads it is wrong by the same amount.

   So a finished station finishes the ones before it. The stages are the SOP's
   own order collapsed to the part that is a straight line — every route in
   SOP-WW-CUT-008 runs rolling, then a cut, then a punch, then machining, and
   the branches differ only in which station fills each slot. */
const STAGE = {
  'roll-auto': 1, 'roll-man': 1,
  saw: 2, fom1: 2, fom2: 2, fom3: 2,
  multipunch: 3,
  cncfmc: 4, cnc1: 4, fmc1: 4, fmc2: 4,
};

/** One job, wherever it appears. Deliberately not the status key — that is
    per-station by design, and this is what the stations have in common. */
function jobKey(t) {
  const src = t.origin || t;
  return `${src.wo}|${src.die || ''}`;
}

/** A line's status before anything is inferred: the operator's own update, or
    what the workbook says. Kept separate from effectiveTaskStatus so the
    inference stands on solid ground and cannot feed itself. */
function baseStatusKey(t) {
  const override = state.taskStatus[taskStatusKey(t)];
  if (override?.status && TRACK_STATUS[override.status]) return override.status;
  if (t.status === 'DONE') return 'DONE';
  if (t.status === 'IP') return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

/* Per job: the furthest stage anybody has finished, and the furthest anybody
   has started. Both are needed — a finished station downstream is proof the
   ones before it are finished, while a merely *started* one is only proof they
   are no longer untouched. */
let stageCache = null;
let stageCacheAt = null;

function stages() {
  /* Keyed on the store's change counter, not on record counts. Counting missed
     the ordinary case: a station set In progress and then Done rewrites one
     existing key, so every count stayed the same while the answer changed, and
     the stations upstream kept showing the old one. */
  const stamp = stateRev();
  if (stageCache && stageCacheAt === stamp) return stageCache;

  const map = new Map();
  for (const t of tasksInScope()) {
    const stage = STAGE[t.machine];
    if (!stage) continue;
    const status = baseStatusKey(t);
    if (status === 'NOT_STARTED') continue;

    const k = jobKey(t);
    let rec = map.get(k);
    if (!rec) { rec = { done: 0, started: 0, doneAt: null, startedAt: null }; map.set(k, rec); }
    if (status === 'DONE' && stage > rec.done) { rec.done = stage; rec.doneAt = t.machine; }
    if (stage > rec.started) { rec.started = stage; rec.startedAt = t.machine; }
  }
  stageCache = map;
  stageCacheAt = stamp;
  return map;
}

/** What a later station proves about this one, or null.

    Only ever *forward* along the line, and only from a strictly later stage:
    two rows at the same station are two real pieces of work — one job can have
    two FOM 2 rows for different elevations — and neither finishes the other. */
export function impliedStatus(t) {
  const stage = STAGE[t.machine];
  if (!stage) return null;
  const rec = stages().get(jobKey(t));
  if (!rec) return null;

  if (rec.done > stage) {
    return { status: 'DONE', from: rec.doneAt, why: 'finished further down the line' };
  }
  /* Started downstream says the material got there, so this station is not
     untouched — but it does not say this station *finished*, and claiming that
     would be the same stale-data mistake pointing the other way. */
  if (rec.started > stage) {
    return { status: 'IN_PROGRESS', from: rec.startedAt, why: 'already running further down the line' };
  }
  return null;
}

/** Every station this job appears at, and how far each has got.

    The route panel used to shade its steps by position alone — everything
    before the line's own station drawn as finished, on the assumption that
    material moves in a straight line and nothing is ever skipped or waiting.
    This is the same thing measured instead of assumed.

    Where a station has two rows for one job — different elevations, usually —
    the station is only as far along as its *least* finished row. Calling a
    station done while half of it is still on the rack is exactly the error
    this whole section exists to stop. */
export function jobStations(task) {
  const k = jobKey(task);
  const out = {};
  for (const t of tasksInScope()) {
    if (jobKey(t) !== k) continue;
    const s = effectiveTaskStatus(t).key;
    const prev = out[t.machine];
    if (!prev || TRACK_STATUS_ORDER.indexOf(s) < TRACK_STATUS_ORDER.indexOf(prev)) {
      out[t.machine] = s;
    }
  }
  return out;
}

/** What a line actually shows.

    An operator's own update always wins — somebody looked at the material and
    said so, and no inference outranks that. Failing that, a later station can
    finish this one. Failing both, the workbook. */
export function effectiveTaskStatus(t) {
  const override = state.taskStatus[taskStatusKey(t)];
  if (override?.status && TRACK_STATUS[override.status]) {
    return { ...TRACK_STATUS[override.status], by: override.by, at: override.at, overridden: true };
  }

  let bucket = 'NOT_STARTED';
  if (t.status === 'DONE') bucket = 'DONE';
  else if (t.status === 'IP') bucket = 'IN_PROGRESS';

  const implied = impliedStatus(t);
  // Only ever forward. Where the sheet already says more than the inference
  // does, the sheet is the better answer and the inference adds nothing.
  if (implied && TRACK_STATUS_ORDER.indexOf(implied.status) > TRACK_STATUS_ORDER.indexOf(bucket)) {
    return {
      ...TRACK_STATUS[implied.status],
      overridden: false,
      implied: true,
      impliedFrom: implied.from,
      impliedWhy: implied.why,
    };
  }
  return { ...TRACK_STATUS[bucket], overridden: false };
}

/* ---------- the whole work order ---------- */

/* The app is organised by machine because the workbooks are, and because an
   operator stands at one. Nobody *asks* about a machine, though. They ask
   where W/O 31817 has got to, and in the live schedules that is a question
   about four machines at once: 201 of the 272 work orders touch more than one
   centre, covering 3,167 of the 3,521 lines. Answering it meant opening four
   tabs and holding the result in your head.

   Everything below is derived — no new records, nothing stored. A job is just
   its lines seen together, which is the only way to be sure this page and the
   centre pages can never disagree. */

/** Stations in the order material moves, not the order the workbooks list
    them: the stage first, then the department's own machine order inside it.
    A station with no rows for this job is left out entirely — a job that never
    goes near the saw should not show an empty saw. */
const STATION_ORDER = MACHINES.map((m) => m.key)
  .sort((a, b) => (STAGE[a] || 9) - (STAGE[b] || 9)
    || MACHINES.findIndex((m) => m.key === a) - MACHINES.findIndex((m) => m.key === b));

function blankStation(machine) {
  return { machine, lines: [], total: 0, done: 0, running: 0, waiting: 0, pieces: 0 };
}

function countInto(bucket, statusKey, qty) {
  bucket.total++;
  bucket.pieces += qty || 0;
  if (statusKey === 'DONE') bucket.done++;
  else if (statusKey === 'IN_PROGRESS') bucket.running++;
  else bucket.waiting++;
}

let jobCache = null;
let jobCacheAt = null;

function jobTable() {
  const map = new Map();

  for (const t of tasksInScope()) {
    /* Keyed on the *imported* work order for the same reason taskStatusKey is:
       correcting a typo in a W/O must not split a job in two, nor silently
       merge it with another one. */
    const wo = String((t.origin || t).wo ?? t.wo ?? '').trim();
    if (!wo) continue;

    let job = map.get(wo);
    if (!job) {
      job = {
        wo, lines: [], dies: [], stations: [], projects: [], floors: [],
        total: 0, done: 0, running: 0, waiting: 0, pieces: 0,
        rush: 0, backOrders: 0, shortPieces: 0, notes: 0, parked: 0,
        firstCut: null, lastCut: null, undated: 0,
      };
      map.set(wo, job);
    }

    const status = effectiveTaskStatus(t);
    const machine = assignedMachine(t);
    const key = taskStatusKey(t);
    const bo = resolveBackOrder(t);
    const rush = resolveRush(t);
    const parked = isParked(t);
    const row = { task: t, status, machine, key, bo, rush, parked, note: taskNoteFor(key) };

    job.lines.push(row);
    /* A parked line still belongs to the job — hiding it would make a job look
       finished when part of it was written off, which is the opposite of
       seeing the work order whole. It is counted apart from the work that is
       still going to happen. */
    if (parked) job.parked++;
    else countInto(job, status.key, t.qty);
    if (rush.on) job.rush++;
    if (bo.on) { job.backOrders++; job.shortPieces += bo.qty || 0; }
    if (row.note?.text) job.notes++;

    const project = String(t.project || '').trim();
    if (project && !job.projects.includes(project)) job.projects.push(project);
    const floor = String(t.floor || '').trim();
    if (floor && !job.floors.includes(floor)) job.floors.push(floor);

    /* Dates come from the lines still to do. A job whose remaining work is due
       next week is not "eight months late" because one finished line was. */
    if (status.key !== 'DONE' && !parked) {
      const cut = t.cuttingDate || null;
      if (!cut) job.undated++;
      else {
        if (!job.firstCut || cut < job.firstCut) job.firstCut = cut;
        if (!job.lastCut || cut > job.lastCut) job.lastCut = cut;
      }
    }
  }

  for (const job of map.values()) {
    job.open = job.total - job.done;

    const byDie = new Map();
    const byStation = new Map();
    for (const row of job.lines) {
      const die = row.task.die || '';
      if (!byDie.has(die)) byDie.set(die, { die, lines: [], stations: new Map(), qty: 0, ...blankStation(null) });
      const d = byDie.get(die);
      d.lines.push(row);
      d.qty += row.task.qty || 0;
      if (!row.parked) countInto(d, row.status.key, row.task.qty);
      /* Two rows at one station are two real pieces of work — different
         elevations, usually — so the station is only as far along as its least
         finished row. Calling it done while half of it is on the rack is the
         error the whole inference section exists to prevent. */
      const seen = d.stations.get(row.machine);
      const rank = TRACK_STATUS_ORDER.indexOf(row.status.key);
      // A parked row cannot hold a station back — nobody is waiting on work
      // that has been written off.
      if (!row.parked && (!seen || rank < TRACK_STATUS_ORDER.indexOf(seen.key))) {
        d.stations.set(row.machine, row.status);
      }

      if (!byStation.has(row.machine)) byStation.set(row.machine, blankStation(row.machine));
      const st = byStation.get(row.machine);
      st.lines.push(row);
      if (!row.parked) countInto(st, row.status.key, row.task.qty);
    }

    /* A die's lines in the order material moves through them, not the order
       the workbooks happened to list them. Anything picking "the next station
       that has not finished" depends on this being the real sequence. */
    for (const d of byDie.values()) {
      d.lines.sort((a, b) => STATION_ORDER.indexOf(a.machine) - STATION_ORDER.indexOf(b.machine));
    }
    job.dies = [...byDie.values()].sort((a, b) => a.die.localeCompare(b.die));
    job.stations = STATION_ORDER.filter((k) => byStation.has(k)).map((k) => byStation.get(k));
  }

  return map;
}

function jobs() {
  const stamp = stateRev();
  if (jobCache && jobCacheAt === stamp) return jobCache;
  jobCache = jobTable();
  jobCacheAt = stamp;
  return jobCache;
}

/** One work order seen whole, or null when nothing carries that number. */
export function jobFor(wo) {
  return jobs().get(String(wo ?? '').trim()) || null;
}

/** The job a line belongs to. */
export function jobOf(task) {
  return jobFor((task.origin || task).wo ?? task.wo);
}

/** Every work order, newest work first.

    Sorted by what a scheduler chases: rush, then shortages, then the earliest
    remaining cutting date. Finished jobs sink whether or not they are shown —
    they are history, and history does not need to be near the top. */
export function allJobs({ q = '', openOnly = true } = {}) {
  let list = [...jobs().values()];
  if (openOnly) list = list.filter((j) => j.open > 0);

  const needle = String(q || '').trim().toLowerCase();
  if (needle) {
    list = list.filter((j) => j.wo.toLowerCase().includes(needle)
      || j.projects.some((p) => p.toLowerCase().includes(needle))
      || j.floors.some((f) => f.toLowerCase().includes(needle))
      || j.dies.some((d) => d.die.toLowerCase().includes(needle)));
  }

  return list.sort((a, b) =>
    (b.open > 0) - (a.open > 0)
    || (b.rush > 0) - (a.rush > 0)
    || (b.backOrders > 0) - (a.backOrders > 0)
    || String(a.firstCut || '9999').localeCompare(String(b.firstCut || '9999'))
    || a.wo.localeCompare(b.wo, undefined, { numeric: true }));
}

/* ---------- queues ---------- */

/** All machine-schedule lines, excluding the Rolling "Complete" archive
    (finished by definition, not part of day-to-day tracking). */
/** Every line the app schedules: the imported ones, plus the jobs added by
    hand. A manual job is dropped once the workbook catches up and imports a
    line with the same key — the workbook's version then carries the status,
    note and history the manual one had, because the key is identical. */
export function tasksInScope() {
  const imported = (state.tasks || []).filter((t) => !t.archived);
  const manual = Object.values(state.manualTasks || {});
  if (!manual.length) return imported;

  const have = new Set(imported.map(taskStatusKey));
  return imported.concat(manual.filter((t) => !t.archived && !have.has(taskStatusKey(t))));
}

/** The stored record behind a manual job, by its task id. */
export function manualIdFor(task) {
  if (!task?.manual) return null;
  return String(task.id).replace(/^manual:/, '');
}

/** A manual job whose work order and die now also arrive in the workbook. It
    is hidden from the queues by tasksInScope(); this is what lets Setup say so
    rather than leaving someone wondering where their line went. */
export function supersededManualTasks() {
  const have = new Set((state.tasks || []).filter((t) => !t.archived).map(taskStatusKey));
  return Object.values(state.manualTasks || {}).filter((t) => have.has(taskStatusKey(t)));
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
  return tasksForMachine(machineKey)
    .filter((r) => !isParked(r.task) && r.status.key !== 'DONE').length;
}

/** Lines actually running on a machine right now — the answer to "what is
    this machine doing", meant to sit at the top of the page rather than be
    found by scrolling the queue. Same order as the queue itself: rush first,
    then soonest cutting date. */
export function runningNow(machineKey) {
  return tasksForMachine(machineKey)
    .filter((r) => !isParked(r.task) && r.status.key === 'IN_PROGRESS');
}

/* ---------- date grouping ---------- */

/* Order matters: this is the order the groups render in, urgent first.
   `open` decides whether the group starts expanded — the urgent ones do,
   because they are the answer to "what do I run now". `cap` limits rows shown
   before a "Show more"; every group is capped, since the real data puts 74
   lines in Overdue and 97 in This week on Rolling (Auto) alone.

   Late work is split three ways rather than tipped into one Overdue bucket.
   The measured reason: on the live schedules 649 of the 756 open dated lines
   are past their cutting date — 86%, which is the same as painting the board
   red and calling it a signal. Split by how late, the same lines separate into
   271 recently due, 221 weeks behind and 157 months behind, and the last of
   those includes 62 lines dated December — work nobody is going to run, which
   was being counted in the same breath as this morning's.

   The boundaries are the data's own shape, not calendar intuition: there is
   nothing at all between 0 and 11 days, the median is 25, and the tail runs to
   270. Fourteen and sixty days sit in the gaps.

   MONTHS starts folded shut for the same reason Later does — it is a list to
   review, not to work from. */
export const DATE_GROUPS = [
  { key: 'OVERDUE', label: 'Overdue', tone: 'bad', open: true, cap: 25 },
  { key: 'WEEKS', label: 'Weeks behind', tone: 'bad', open: true, cap: 25 },
  { key: 'MONTHS', label: 'Months behind', tone: 'mute', open: false, cap: 25 },
  { key: 'TODAY', label: 'Today', tone: 'warn', open: true, cap: 25 },
  { key: 'WEEK', label: 'This week', tone: 'mute', open: true, cap: 25 },
  { key: 'LATER', label: 'Later', tone: 'mute', open: false, cap: 25 },
  { key: 'NODATE', label: 'No date', tone: 'mute', open: false, cap: 25 },
];

const WEEKS_BEHIND = 14;
const MONTHS_BEHIND = 60;

/** How many days past its cutting date a line is. Negative means it is still
    ahead of it, null when there is no date to be late against. */
export function daysLate(task, ref = today()) {
  const d = task.cuttingDate;
  if (!d) return null;
  return Math.round((Date.parse(ref + 'T00:00:00Z') - Date.parse(d + 'T00:00:00Z')) / 86400000);
}

export function dateGroupOf(task, ref = today()) {
  const d = task.cuttingDate;
  if (!d) return 'NODATE';
  if (d < ref) {
    const late = daysLate(task, ref);
    if (late > MONTHS_BEHIND) return 'MONTHS';
    return late > WEEKS_BEHIND ? 'WEEKS' : 'OVERDUE';
  }
  if (d === ref) return 'TODAY';
  return d <= addDays(ref, 7) ? 'WEEK' : 'LATER';
}

/** Every bucket that means "past its date". Counts and filters ask this rather
    than testing one key, so splitting the bucket did not quietly drop two
    thirds of the overdue count off every summary that reads it. */
const LATE_GROUPS = new Set(['OVERDUE', 'WEEKS', 'MONTHS']);
export function isLate(task, ref = today()) {
  return LATE_GROUPS.has(dateGroupOf(task, ref));
}

/** A machine's queue, bucketed by cutting date and ready to render. */
export function groupedQueue(machineKey, { showDone = false, q = '', filter = 'ALL', ref = today() } = {}) {
  const term = q.trim().toLowerCase();
  const rows = tasksForMachine(machineKey)
    /* Parked lines are out of the queue everywhere except the filter that
       exists to review them. They are not deleted and not archived — somebody
       decided they are not going to run, and that decision has to be visible
       and reversible, which "hidden forever" is not. */
    .filter((r) => (filter === 'PARKED' ? isParked(r.task) : !isParked(r.task)))
    .filter((r) => showDone || r.status.key !== 'DONE')
    .filter((r) => {
      if (filter === 'ALL' || filter === 'PARKED') return true;
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
  const everything = tasksForMachine(machineKey);
  const parked = everything.filter((r) => isParked(r.task));
  // Every count below is of work that is still going to happen, so a parked
  // line is out of all of them — leaving it in the open count is exactly what
  // parking is meant to stop.
  const all = everything.filter((r) => !isParked(r.task));
  const open = all.filter((r) => r.status.key !== 'DONE');
  return {
    parked: parked.length,
    total: all.length,
    open: open.length,
    inProgress: open.filter((r) => r.status.key === 'IN_PROGRESS').length,
    overdue: open.filter((r) => isLate(r.task, ref)).length,
    backOrder: open.filter((r) => resolveBackOrder(r.task).on).length,
    rush: open.filter((r) => r.rush.on).length,
    done: all.length - open.length,
  };
}

/* ---------- rush ---------- */

export function rushFor(key) {
  return state.rush?.[key] || null;
}

/* ---------- parked ---------- */

export function parkedFor(key) {
  return state.parked?.[key] || null;
}

/** A line somebody has decided is not going to run. Purely user-owned — the
    workbook has no opinion about it, and keeps listing the line either way. */
export function isParked(task) {
  return !!parkedFor(taskStatusKey(task))?.on;
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
    // Nobody needs to chase material for a line that is not going to run.
    if (isParked(task)) continue;
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
/** The machine's entry as the imported workbook has it. */
function sheetShiftUpdateFor(machineKey) {
  const su = state.shiftUpdate;
  if (!su?.machines) return null;
  const entry = su.machines[machineKey];
  if (!entry) return null;
  // Entries carry their own date and shift: they no longer all come from one
  // block, since FMC 1 and FMC 2 only appear on a different one.
  return { date: su.date, shift: su.shift, ...entry };
}

/* Shift updates written on the Shift Update page are stored as one record per
   (date, shift) with a text box per machine. This pulls one machine's entry
   back out of the newest one that actually says something about it. */
const SHIFT_RANK = { DAY: 0, AFT: 1, NIGHT: 2 };

function rank(date, shift) {
  return `${date || ''}#${SHIFT_RANK[normalizeShift(shift)] ?? 0}`;
}

function lines(v) {
  return String(v || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

function writtenShiftUpdateFor(machineKey) {
  let best = null;
  for (const log of Object.values(state.shiftLogs || {})) {
    const row = log?.rows?.[machineKey];
    if (!row) continue;
    const done = lines(row.done);
    const next = lines(row.next);
    const notes = lines(row.notes);
    if (!done.length && !next.length && !notes.length) continue;
    if (best && rank(log.date, log.shift) <= rank(best.date, best.shift)) continue;
    best = {
      date: log.date, shift: log.shift,
      ops: row.ops === '' || row.ops == null ? null : Number(row.ops),
      done, next, notes, down: false,
      by: log.by, at: log.at,
    };
  }
  return best;
}

/** What to show as this machine's last shift update.

    Two things can answer that and they are not the same thing. The workbook's
    `Shift Update` sheet is a snapshot from whenever the file was last saved.
    An update written on the Shift Update page is the department's own record,
    typed during the shift it describes.

    Whichever is more recent wins, and the result says which it was — a machine
    page that keeps showing yesterday's workbook entry after today's update has
    been written in the app is showing the wrong thing, however correctly it
    parsed the sheet. */
export function shiftUpdateFor(machineKey) {
  const sheet = sheetShiftUpdateFor(machineKey);
  const written = writtenShiftUpdateFor(machineKey);

  if (written && (!sheet || rank(written.date, written.shift) > rank(sheet.date, sheet.shift))) {
    return {
      ...written,
      source: 'written',
      // The workbook is the only one of the two that records a machine as
      // down, so a newer written update must not silently clear it. Carried
      // across with its own date, for the panel to caveat.
      staleDown: sheet?.down ? sheet.date : null,
    };
  }
  return sheet ? { ...sheet, source: 'workbook' } : null;
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

/* The active schedule is Day 07:00–15:30 and Afternoon 15:30–00:00. The
   historical NIGHT definition is retained only so old saved logs still have
   the correct window. Times are local, matching how the floor talks. */
export function shiftWindow(date, shift) {
  const mk = (d, minutes) => {
    const x = new Date(d + 'T00:00:00');
    x.setMinutes(minutes, 0, 0);
    return x.getTime();
  };
  const key = normalizeShift(shift);
  const selected = SHIFTS[key] || SHIFTS.DAY;
  const endDate = selected.end <= selected.start ? addDays(date, 1) : date;
  return [mk(date, selected.start), mk(endDate, selected.end)];
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

/* ---------- today ---------- */

/** The day's own list: everything dated today, plus anything still unfinished
    from before. An open job does not stop mattering at midnight — it follows
    the day forward, marked with the day it was written, so the list is a real
    account of what is outstanding rather than a fresh empty page each morning. */
export function openTodos(ref = today()) {
  const all = Object.values(state.todos || {});
  const mine = all.filter((t) => t.date <= ref);
  const open = mine.filter((t) => !t.done)
    .sort((a, b) => (a.date === b.date ? (a.at < b.at ? -1 : 1) : (a.date < b.date ? -1 : 1)));
  const done = all.filter((t) => t.done && t.date === ref)
    .sort((a, b) => ((a.doneAt || '') < (b.doneAt || '') ? 1 : -1));
  return { open, done, carried: open.filter((t) => t.date < ref).length };
}

/** What the schedules themselves say needs attention today, across every
    machine. Derived — nothing here is stored, so it cannot drift from the
    pages it points at. */
export function todayBoard(ref = today()) {
  const rows = tasksInScope().map((t) => {
    const task = resolveTask(t);
    return {
      task,
      machine: assignedMachine(task),
      status: effectiveTaskStatus(task),
      rush: resolveRush(task, ref),
      bo: resolveBackOrder(task),
    };
  });
  const open = rows.filter((r) => r.status.key !== 'DONE' && !isParked(r.task));

  return {
    running: open.filter((r) => r.status.key === 'IN_PROGRESS'),
    dueToday: open.filter((r) => r.task.cuttingDate === ref),
    /* The day's list, so "overdue" here means recently due — the work somebody
       could actually pick up this shift. Everything past its date would be 649
       lines on the live schedules, most of them weeks or months old, and a
       briefing that opens with 649 items is not a briefing. The rest is still
       counted, and named, so nothing goes quietly missing. */
    overdue: open.filter((r) => dateGroupOf(r.task, ref) === 'OVERDUE'),
    longOverdue: open.filter((r) => ['WEEKS', 'MONTHS'].includes(dateGroupOf(r.task, ref))),
    rushNow: open.filter((r) => r.rush.on && (!r.rush.needBy || r.rush.needBy <= ref)),
    backOrders: open.filter((r) => r.bo.on),
    finishedToday: rows.filter((r) => r.status.key === 'DONE'
      && String(r.status.at || '').slice(0, 10) === ref),
  };
}

/** Whether the current shift has been written up yet — the one thing on the
    day's list that has a deadline attached to the shift rather than the job. */
export function shiftWritten(date, shift) {
  const log = state.shiftLogs?.[`${date}|${shift}`];
  return !!(log && (Object.keys(log.rows || {}).length || (log.notes || '').trim()));
}

/* ---------- learned routing ---------- */

/* The CNC & FMC sheet says nothing about which machine runs a line, so every
   one of them is put on a machine by hand. The same components come back week
   after week, and the floor already knows where each one goes — that knowledge
   just lived in somebody's head and got re-applied 81 times per import.

   So it is read back out of what people actually did. Every hand assignment is
   a decision about a die; count them per die and the app can say "this one
   usually goes on FMC 1, seven times out of eight" and offer to do it.

   Derived, never stored. There is no learned-routes table to drift out of date
   or to sync: it is a view over the assignments themselves, so correcting a
   habit corrects the suggestion, and clearing an assignment un-teaches it. */

function routeTable() {
  const byDie = new Map();

  for (const t of tasksInScope()) {
    const key = taskStatusKey(t);
    const assigned = state.taskAssign?.[key]?.machine;
    if (!assigned) continue;                       // only decisions someone made
    const die = (t.origin || t).die;
    if (!die) continue;                            // nothing to recognise it by

    if (!byDie.has(die)) byDie.set(die, new Map());
    const counts = byDie.get(die);
    counts.set(assigned, (counts.get(assigned) || 0) + 1);
  }
  return byDie;
}

let routeCache = null;
let routeCacheAt = null;

/** Invalidated by any change to state — cheap enough to rebuild, but a queue
    of 80 lines would otherwise rebuild it 80 times per render.

    Counting assignments was not "any change": moving an already-assigned line
    from FOM 1 to FOM 2 rewrites one existing key, so the count held still while
    the habit this table reads changed, and every other line carrying that die
    kept being pointed at the old machine. */
function routes() {
  const stamp = stateRev();
  if (routeCache && routeCacheAt === stamp) return routeCache;
  routeCache = routeTable();
  routeCacheAt = stamp;
  return routeCache;
}

/** Where this line's component usually ends up, if it is recognised and the
    line has not already been put somewhere. Returns null when there is nothing
    worth suggesting — one sighting is a coincidence, not a habit. */
export function suggestedMachine(task, { minSeen = 2 } = {}) {
  if (isAssigned(task)) return null;
  // A finished line has nowhere left to go, and offering to route it would put
  // the badge on rows nobody is deciding about.
  if (effectiveTaskStatus(task).key === 'DONE') return null;

  const group = MACHINE_GROUP[task.machine];

  /* The department's own written routing comes first. SOP-WW-CUT-008 states
     where window wall and vents go and why; counting what people did is how
     the app coped before there was a rule to read, and it stays for the work
     the SOP does not cover — which is the whole CNC sheet. */
  const sop = sopMachine(task, group);
  if (sop) return sop;

  const die = (task.origin || task).die;
  if (!die) return null;

  const counts = routes().get(die);
  if (!counts) return null;

  // Only machines in this line's own centre: a die seen on FOM 2 says nothing
  // about which CNC should take it.
  const options = [...counts.entries()]
    .filter(([m]) => MACHINE_GROUP[m] === group && m !== task.machine)
    .sort((a, b) => b[1] - a[1]);

  if (!options.length) return null;
  const [machine, seen] = options[0];
  const total = options.reduce((a, [, n]) => a + n, 0);
  if (seen < minSeen) return null;

  return { machine, seen, total, die, sure: seen === total };
}

/** Every unassigned line in a centre that has a suggestion, so the whole queue
    can be routed in one go rather than one line at a time. */
export function suggestionsIn(group) {
  const out = [];
  for (const t of tasksInScope()) {
    const task = resolveTask(t);
    if (MACHINE_GROUP[task.machine] !== group) continue;
    const s = suggestedMachine(task);
    if (s) out.push({ task, ...s });
  }
  return out;
}

/* ---------- what is running, for the shift update ---------- */

/** Lines the schedules say are in process on a machine right now, phrased the
    way the shift update is written. Separate from workInShift(): that is what
    moved during one shift's hours as recorded in the app, this is the standing
    state of the machine however it got there — including lines the workbook
    itself marks IP, which is most of them until everyone is using the app. */
export function inProgressLines(machineKey) {
  return runningNow(machineKey).map(({ task }) => {
    const what = task.project || task.wo;
    const where = task.floor ? ` ${task.floor}` : '';
    const die = task.die ? ` (${task.die})` : '';
    return `${what}${where}${die}-I.P`;
  });
}

/* ---------- staging ---------- */

/* Prepping material for rolling: the step before the schedule's first machine,
   and the one the department judges by whether the next shift starts clean.
   It is an overlay on the rolling lines rather than a queue of its own, so a
   line is the same line whether you are staging it or rolling it. */

export function stagingFor(key) {
  return state.staging?.[key] || null;
}

export function isStaged(task) {
  return !!stagingFor(taskStatusKey(task))?.staged;
}

/** Every rolling line that is not finished, split by whether it has been
    staged. Ordered by cutting date, because that is the order it is needed in. */
export function stagingQueue({ q = '', ref = today() } = {}) {
  const term = q.trim().toLowerCase();
  const rows = [];

  for (const t of tasksInScope()) {
    if (MACHINE_GROUP[t.machine] !== 'Rolling') continue;
    const task = resolveTask(t);
    const status = effectiveTaskStatus(task);
    /* Anything already running or finished on rolling is past staging — the
       material is on the machine. Excluding only DONE meant every in-progress
       line still showed as needing prep, so a roller working through twenty
       lines had all twenty of them on the stager's list at the same time. */
    if (status.key !== 'NOT_STARTED') continue;

    if (term) {
      const hay = [task.wo, task.project, task.die, task.floor].join(' ').toLowerCase();
      if (!hay.includes(term)) continue;
    }

    const key = taskStatusKey(task);
    rows.push({
      task, key, status,
      machine: assignedMachine(task),
      staging: stagingFor(key),
      rush: resolveRush(task, ref),
    });
  }

  rows.sort((a, b) => {
    if (a.rush.on !== b.rush.on) return a.rush.on ? -1 : 1;
    return (a.task.cuttingDate || '9999') < (b.task.cuttingDate || '9999') ? -1 : 1;
  });

  return {
    todo: rows.filter((r) => !r.staging?.staged),
    staged: rows.filter((r) => r.staging?.staged),
  };
}
