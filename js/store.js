/* App state, persistence, and the shared-file sync.

   Two layers of storage:
   - localStorage: always on, instant, per-device. The app works with nothing else.
   - a shared JSON file on the network drive (File System Access API): optional,
     and what makes the department see each other's updates.

   Sync is a per-record merge, not whole-file last-write-wins. New records
   carry a logical revision and device ID, so merge order does not depend on
   computer clocks and two people updating different lines keep their work. */

import {
  setCloudConfig, cloudEnabled, cloudHost,
  cloudPull, cloudPush, cloudTest, CLOUD_PARTS,
} from './cloud.js';

export { cloudEnabled, cloudHost, cloudConfig } from './cloud.js';

const LS_KEY = 'bv.cutting.v1';
const LS_DEVICE = 'bv.cutting.device.v1';
const IDB_NAME = 'bv-cutting';
const IDB_STORE = 'handles';

/* Fields written by earlier versions of this app, before it narrowed to the
   machine schedules. Stripped on load so an existing install — and the shared
   JSON on the network drive — sheds them rather than carrying them forever. */
const RETIRED_KEYS = [
  'meta', 'orders', 'wip', 'prep', 'screens', 'progress', 'material',
  'history', 'manualOrders', 'plan', 'guide', 'audit',
  'lastImportReport',
];

export const state = {
  tasks: [],        // machine-schedule rows: the base for scheduling
  machineMeta: {},  // kind -> { fileName, importedAt, count }
  taskStatus: {},   // `${machine}|${wo}|${die}` -> { status, at, by }
  shiftUpdate: null, // latest Shift Update sheet: { date, shift, machines }
  taskNote: {},     // `${machine}|${wo}|${die}` -> { text, at, by }
  taskEdit: {},     // same key -> { fields: {...}, at, by } — corrections to the sheet
  backOrder: {},    // same key -> { flagged, qty, assignee, note, at, by }
  materialOrders: {}, // id -> order-ready Material Requests row, drafted from a shortage or by hand
  rush: {},         // same key -> { on, needBy, assignee, reason, at, by }
  /* Lines nobody intends to run: a job cancelled, a die remade under another
     work order, an elevation that changed. The workbook goes on listing them
     — it is a schedule, not a record of decisions — and 62 open lines on the
     live books are dated December. Parking takes them out of the queue and the
     counts without deleting anything, because "we decided not to" is worth
     keeping and a deleted line comes back on the next import. */
  parked: {},       // same key -> { on, reason, at, by }
  taskAssign: {},   // same key -> { machine, at, by } — which machine took a queued line
  taskHistory: [],  // every change to a line, newest first
  machineConfig: {}, // machineKey -> { label, note, ops, hidden }
  shiftLogs: {},    // `${date}|${shift}` -> { date, shift, rows, notes, at, by }
  /* Jobs added by hand, kept in their own map rather than in `tasks`.
     setMachineImport() replaces every task belonging to an imported machine,
     so a manual job living in `tasks` would be wiped by the next re-import of
     the workbook covering its machine — which is precisely when someone would
     be relying on it. */
  manualTasks: {},  // id -> task-shaped record, plus { manual, at, by }
  todos: {},        // id -> { text, date, done, assignee, at, by, doneAt, doneBy }
  staging: {},      // line key -> { staged, stageFor, note, at, by }
  deletions: {},    // `${map}:${key}` -> { at, by } — see forget()
  people: [],
  settings: { me: null, theme: null },   // theme: null = follow the device
};

const listeners = new Set();
let localSaveProblem = null;

/* Light or dark, chosen per device rather than taken from the operating system
   and left there.

   Following the OS is the right default and stays the default. It is not
   sufficient on its own here: the same account runs on a wall panel in a bay
   that wants dark, an office PC under strip lighting that wants light, and a
   phone that follows whatever the person set it to. One global preference
   cannot serve those, and neither can the OS setting on a shared machine
   nobody logs out of.

   The stylesheet already resolves all three states — bare :root is light,
   prefers-color-scheme handles the unset case, and data-theme wins over both —
   so this only has to set the attribute. */
export function applyTheme() {
  const choice = state.settings?.theme;
  if (choice === 'light' || choice === 'dark') {
    document.documentElement.dataset.theme = choice;
  } else {
    delete document.documentElement.dataset.theme;
  }
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* Every change to state gets a number.

   Derived views cache expensive work — the per-job stage map in model.js is
   the costly one — and need to know when that work is stale. Counting records
   is not enough and was actively wrong: setting a line In progress and then
   Done rewrites an existing key, so every count stays identical while the
   answer changes completely. An operator starting a station and then finishing
   it is the ordinary way to work, and it was the exact case that went stale.

   A counter cannot miss that. Every mutator ends at save() -> emit(), and the
   bulk paths that replace state outright bump it themselves. */
let rev = 0;
export function stateRev() { return rev; }

function emit() {
  rev++;
  for (const fn of listeners) fn();
}

let lastNow = 0;

export function now() {
  // A clock adjustment on one device must not make its next edit older than
  // its previous one. Cross-device ordering uses logical revisions below;
  // this monotonic wall time remains useful for display and legacy snapshots.
  lastNow = Math.max(Date.now(), lastNow + 1);
  return new Date(lastNow).toISOString();
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function me() {
  return state.settings.me || 'Unassigned';
}

/* ---------- ordering edits across devices ---------- */

/* Wall clocks are not an ordering system: a phone five minutes fast could
   overwrite a genuinely later PC edit forever. Every new synced record now
   carries a Lamport revision — a counter observed from all merged records,
   plus a stable device id for deterministic concurrent-edit ties. `at` stays
   human-readable; `rev` decides which record wins. */
function newDeviceId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readDeviceClock() {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(LS_DEVICE);
    const saved = raw ? JSON.parse(raw) : null;
    if (saved?.id) return { id: String(saved.id), counter: Number(saved.counter) || 0 };
  } catch { /* a save warning is raised when the state itself is persisted */ }
  return { id: newDeviceId(), counter: 0 };
}

const deviceClock = readDeviceClock();

function persistDeviceClock() {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LS_DEVICE, JSON.stringify(deviceClock)); }
  catch { /* save() reports the storage failure in the interface */ }
}

function parseRevision(rev) {
  const m = /^(\d+)@(.+)$/.exec(String(rev || ''));
  return m ? { counter: Number(m[1]), device: m[2] } : null;
}

function observeRevision(rev) {
  const parsed = parseRevision(rev);
  if (parsed) deviceClock.counter = Math.max(deviceClock.counter, parsed.counter);
}

function nextRevision() {
  deviceClock.counter++;
  persistDeviceClock();
  return `${deviceClock.counter}@${deviceClock.id}`;
}

function changed(fields, { at = now(), by = me() } = {}) {
  return { ...fields, at, by, rev: nextRevision() };
}

/* ---------- removing a record ---------- */

/* Deleting cannot mean simply removing the key.

   Sync merges per record and reads "missing on my side" as "the other device
   knows something I do not", so a plain delete is undone by the next sync from
   any device that still holds the record — a cleared rush reappears, a deleted
   job comes back. Every removal is therefore written down: the key goes, and a
   tombstone carrying the time it went takes its place in `deletions`.

   mergeSnapshot() applies those after merging, so a deletion beats any copy of
   the record older than itself, while a genuinely newer edit still wins — which
   is right, because that is somebody re-flagging a rush after you cleared it. */
const DELETABLE = [
  'taskStatus', 'taskNote', 'taskEdit', 'backOrder', 'rush', 'taskAssign', 'parked',
  'manualTasks', 'todos', 'shiftLogs', 'machineConfig', 'staging', 'materialOrders',
];

function forget(map, key) {
  if (!DELETABLE.includes(map)) throw new Error(`forget(): ${map} is not a synced record map`);
  delete state[map][key];
  state.deletions = { ...state.deletions, [`${map}:${key}`]: changed({}) };
}

/** Re-apply every recorded deletion to the merged state. */
function applyDeletions() {
  for (const [k, tomb] of Object.entries(state.deletions || {})) {
    const i = k.indexOf(':');
    const map = k.slice(0, i);
    const key = k.slice(i + 1);
    const rec = state[map]?.[key];
    if (!rec) continue;
    if (recordWins(rec, tomb)) continue;   // re-created since
    delete state[map][key];
  }
}

/* Tombstones are deliberately retained. Expiring one after an arbitrary
   number of days lets a tablet that was in a drawer longer than that bring a
   deleted rush, note or manual job back on its next sync. Safe compaction
   would require acknowledgement from every device; this app has no device
   registry, so keeping the small deletion record is the honest choice. */

/* ---------- history ---------- */

const HISTORY_CAP = 4000;

/** Record one change to one line. `key` is the stable line key, so an entry
    stays attached to its line across re-imports. */
export function logChange(key, kind, field, from, to) {
  state.taskHistory.unshift({
    id: uid(), key, kind, field: field || null,
    from: from ?? null, to: to ?? null,
    at: now(), by: me(),
  });
  if (state.taskHistory.length > HISTORY_CAP) state.taskHistory.length = HISTORY_CAP;
}

export function historyFor(key) {
  return (state.taskHistory || []).filter((h) => h.key === key);
}

/* ---------- mutations ---------- */

/** Status of a single machine-schedule line: Not started / In Progress / Done.
    Keyed by machine+wo+die rather than the task's own id, because that id
    embeds a sheet row number that shifts on every re-import — keying on the
    row would silently orphan an operator's update the next time the Rolling
    or CNC workbook is reloaded. */
export function setTaskStatus(key, status) {
  const prev = state.taskStatus[key]?.status ?? null;
  state.taskStatus[key] = changed({ status });
  if (prev !== status) logChange(key, 'status', null, prev, status);
  save();
}

/** Set several lines at once — a shift finishing a batch should not have to
    click each line. Returns what the previous values were, so it can be undone. */
export function setTaskStatusMany(keys, status) {
  const before = keys.map((k) => ({ key: k, prev: state.taskStatus[k]?.status ?? null }));
  const at = now();
  const by = me();
  for (const k of keys) state.taskStatus[k] = changed({ status }, { at, by });
  for (const { key, prev } of before) {
    if (prev !== status) logChange(key, 'status', null, prev, status);
  }
  save();
  return before;
}

/** Restore a set of lines to what they were before the last change. */
export function restoreTaskStatus(before) {
  const at = now();
  const by = me();
  for (const { key, prev } of before) {
    const cur = state.taskStatus[key]?.status ?? null;
    if (prev == null) forget('taskStatus', key);
    else state.taskStatus[key] = changed({ status: prev }, { at, by });
    if (cur !== prev) logChange(key, 'undo', null, cur, prev);
  }
  save();
}

/** A free-text note an operator can leave on a line — why it is stuck, what
    was short, anything the next shift needs. Empty text clears it. */
export function setTaskNote(key, text) {
  const t = String(text || '').trim();
  const prev = state.taskNote[key]?.text ?? null;
  if (!t) forget('taskNote', key);
  else state.taskNote[key] = changed({ text: t });
  if (prev !== (t || null)) logChange(key, 'note', null, prev, t || null);
  save();
}

/* Fields of a line that can be corrected by hand. The work order is not among
   them: it is half the line's identity, and the stable key is built from the
   *imported* work order and die, never the edited values — otherwise editing a
   die would orphan that line's status, note and history at the same moment. */
export const EDITABLE_FIELDS = [
  { key: 'project', label: 'Project', type: 'text' },
  { key: 'floor', label: 'Floor / Tag', type: 'text' },
  { key: 'die', label: 'Die', type: 'text' },
  { key: 'qty', label: 'Qty', type: 'number' },
  { key: 'cuttingDate', label: 'Cutting date', type: 'date' },
];

/** Apply corrections to a line. `sheet` is what the workbook currently says,
    used to record what each value changed from and to drop an override that
    matches the sheet again. */
export function setTaskFields(key, patch, sheet = {}) {
  const cur = state.taskEdit[key]?.fields || {};
  const fields = { ...cur };

  for (const { key: f } of EDITABLE_FIELDS) {
    if (!(f in patch)) continue;
    const next = patch[f];
    const shown = f in cur ? cur[f] : (sheet[f] ?? null);
    const same = (a, b) => (a ?? null) === (b ?? null);
    if (same(next, shown)) continue;

    if (same(next, sheet[f])) delete fields[f];   // back in step with the sheet
    else fields[f] = next;
    logChange(key, 'field', f, shown, next);
  }

  if (Object.keys(fields).length) state.taskEdit[key] = changed({ fields });
  else forget('taskEdit', key);
  save();
}

/* Fields of a back-order record. `flagged` is deliberately tri-state:
   undefined follows whatever the workbook says, true flags a line the sheet
   does not, false clears one the sheet does. Without that third state there is
   no way to record that a shortage the workbook still reports has actually
   been resolved. */
export const BACKORDER_FIELDS = ['flagged', 'qty', 'assignee', 'note'];

/** Flag, assign, count and annotate a shortage on a line. */
export function setBackOrder(key, patch) {
  const cur = state.backOrder[key] || {};
  const next = { ...cur };

  for (const f of BACKORDER_FIELDS) {
    if (!(f in patch)) continue;
    let v = patch[f];
    if (f === 'assignee' || f === 'note') v = String(v ?? '').trim() || null;
    if (f === 'qty') v = v === '' || v == null ? null : Number(v);
    if ((cur[f] ?? null) === (v ?? null)) continue;
    next[f] = v;
    logChange(key, 'backorder', f, cur[f] ?? null, v);
  }

  // A record with nothing meaningful left in it is not worth keeping.
  const empty = next.flagged == null && next.qty == null
    && !next.assignee && !next.note;
  if (empty) forget('backOrder', key);
  else state.backOrder[key] = changed(next);
  save();
}

/** Remove the whole record, so the line falls back to what the sheet says. */
export function clearBackOrder(key) {
  const cur = state.backOrder[key];
  if (!cur) return;
  for (const f of BACKORDER_FIELDS) {
    if (cur[f] != null && cur[f] !== '') logChange(key, 'backorder', f, cur[f], null);
  }
  forget('backOrder', key);
  save();
}

/* ---------- material order drafts ---------- */

/** Save one or several rows in the exact business shape used by the shared
    Material Requests workbook. A row is intentionally an extrusion, never a
    rolled S/SA subassembly; the Materials view owns that guarded expansion. */
export function saveMaterialOrders(rows) {
  const ids = [];
  const at = now();
  const by = me();
  for (const row of rows || []) {
    const id = row.id || uid();
    const cur = state.materialOrders?.[id] || {};
    state.materialOrders = {
      ...state.materialOrders,
      [id]: changed({
        ...cur,
        ...row,
        id,
        requestedBy: String(row.requestedBy || cur.requestedBy || by).trim(),
      }, { at, by }),
    };
    logChange(row.sourceTaskKey || `material:${id}`, 'material-order', null,
      cur.status || null, row.status || 'DRAFT');
    ids.push(id);
  }
  if (ids.length) save();
  return ids;
}

export function setMaterialOrderStatus(id, status) {
  const cur = state.materialOrders?.[id];
  if (!cur) return false;
  if (!['DRAFT', 'READY', 'ENTERED'].includes(status)) {
    throw new Error(`Unknown material-order status: ${status}`);
  }
  // "Entered" means somebody has put this row in the shared workbook. An
  // incomplete draft cannot skip the Ready guardrail and acquire that claim.
  if (status === 'ENTERED' && cur.status !== 'READY') return false;
  const next = {
    ...cur,
    status,
    enteredAt: status === 'ENTERED' ? now() : null,
    enteredBy: status === 'ENTERED' ? me() : null,
  };
  state.materialOrders = { ...state.materialOrders, [id]: changed(next) };
  logChange(cur.sourceTaskKey || `material:${id}`, 'material-order', 'status', cur.status || null, status);
  save();
  return true;
}

export function deleteMaterialOrder(id) {
  const cur = state.materialOrders?.[id];
  if (!cur) return;
  forget('materialOrders', id);
  logChange(cur.sourceTaskKey || `material:${id}`, 'material-order', null, cur.status || 'DRAFT', null);
  save();
}

/* Fields of a rush record. A rush is a human decision — nothing in the
   workbook says "this one first" — so unlike a back order there is no sheet
   value to fall back to and `on` is a plain boolean. */
export const RUSH_FIELDS = ['on', 'needBy', 'assignee', 'reason'];

/** Mark a line as rush: needed by a date, optionally put on someone, with the
    reason (a shipping gate, a site call) written down. */
export function setRush(key, patch) {
  const cur = state.rush[key] || {};
  const next = { ...cur };

  for (const f of RUSH_FIELDS) {
    if (!(f in patch)) continue;
    let v = patch[f];
    if (f === 'on') v = !!v;
    else if (f === 'needBy') v = String(v ?? '').trim() || null;
    else v = String(v ?? '').trim() || null;
    if ((cur[f] ?? null) === (v ?? null)) continue;
    next[f] = v;
    logChange(key, 'rush', f, cur[f] ?? null, v);
  }

  if (!next.on) forget('rush', key);
  else state.rush[key] = changed(next);
  save();
}

/** Take a line out of the queue, or put it back. The reason is the point —
    a parked line with no reason is indistinguishable from one somebody
    mis-clicked, and the next person to look has no way to tell. */
export function setParked(key, on, reason = null) {
  const cur = state.parked[key] || {};
  const next = !!on;
  const text = String(reason ?? '').trim() || null;
  if ((!!cur.on) === next && (cur.reason ?? null) === text) return;
  if (!!cur.on !== next) logChange(key, 'parked', 'on', !!cur.on, next);
  if ((cur.reason ?? null) !== text) logChange(key, 'parked', 'reason', cur.reason ?? null, text);
  if (!next) forget('parked', key);
  else state.parked[key] = changed({ on: true, reason: text });
  save();
}

/** Park or unpark several lines at once, with one reason between them.

    Reviewing a stale pile is a batch job by nature — 62 lines on the live books
    are dated December and share one reason — and a dialog per line is how a
    cleanup gets abandoned halfway. Returns what each line was, so the whole
    batch can be undone in one go. */
export function setParkedMany(keys, on, reason = null) {
  const before = keys.map((k) => ({
    key: k,
    prev: state.parked[k]?.on ? { on: true, reason: state.parked[k].reason ?? null } : null,
  }));
  const at = now();
  const by = me();
  const text = String(reason ?? '').trim() || null;
  for (const { key, prev } of before) {
    if (!!prev === !!on && (prev?.reason ?? null) === text) continue;
    if (!!prev !== !!on) logChange(key, 'parked', 'on', !!prev, !!on);
    if (on && (prev?.reason ?? null) !== text) logChange(key, 'parked', 'reason', prev?.reason ?? null, text);
    if (!on) forget('parked', key);
    else state.parked[key] = changed({ on: true, reason: text }, { at, by });
  }
  save();
  return before;
}

/** Put a parked batch back exactly as it was. */
export function restoreParked(before) {
  const at = now();
  const by = me();
  for (const { key, prev } of before) {
    const cur = state.parked[key]?.on ? { on: true, reason: state.parked[key].reason ?? null } : null;
    if (!prev) forget('parked', key);
    else state.parked[key] = changed({ on: true, reason: prev.reason }, { at, by });
    if (!!cur !== !!prev) logChange(key, 'undo', 'parked', !!cur, !!prev);
  }
  save();
}

export function clearRush(key) {
  const cur = state.rush[key];
  if (!cur) return;
  for (const f of RUSH_FIELDS) {
    if (cur[f] != null && cur[f] !== '' && cur[f] !== false) logChange(key, 'rush', f, cur[f], null);
  }
  forget('rush', key);
  save();
}

/** Put a queued line on a machine. The line's key never changes — it stays
    built from the machine the workbook imported it under — so assigning a line
    does not orphan its status, note, history or shortage. `null` sends it back
    to the shared queue. */
function assignOne(key, machine, importedMachine) {
  const cur = state.taskAssign[key]?.machine || importedMachine || null;
  const next = machine || importedMachine || null;
  if (cur === next) return;
  if (!machine || machine === importedMachine) forget('taskAssign', key);
  else state.taskAssign[key] = changed({ machine });
  logChange(key, 'machine', null, cur, next);
}

export function setTaskMachine(key, machine, importedMachine) {
  assignOne(key, machine, importedMachine);
  save();
}

/** Assign a whole selection at once — one save, not one per line.

    `importedMachine` may be a function of the key. It has to be, for "put
    these back where the sheet had them" across a mixed selection: half the
    lines might have come from FOM 1 and half from FOM 2, and one machine name
    cannot stand for both. */
export function setTaskMachineMany(keys, machine, importedMachine) {
  const originOf = typeof importedMachine === 'function'
    ? importedMachine
    : () => importedMachine;
  for (const key of keys) assignOne(key, machine, originOf(key));
  save();
}

/** Drop every correction on a line and go back to what the workbook says. */
export function clearTaskEdits(key, sheet = {}) {
  const cur = state.taskEdit[key]?.fields || {};
  for (const [f, v] of Object.entries(cur)) logChange(key, 'field', f, v, sheet[f] ?? null);
  forget('taskEdit', key);
  save();
}

/** Save (or update) the shift update for one date and shift. */
/* ---------- jobs added by hand ---------- */

export const MANUAL_FIELDS = ['wo', 'project', 'floor', 'die', 'qty', 'cuttingDate', 'comments'];

/** Add a job the workbook does not have. It is task-shaped, so every overlay —
    status, note, rush, back order, assignment, history — works on it with no
    special casing anywhere downstream. */
export function addManualTask(fields) {
  const id = uid();
  const task = changed({
    id: `manual:${id}`,
    manual: true,
    machine: fields.machine,
    sheet: 'Added by hand',
    row: null,
    wo: String(fields.wo || '').trim(),
    project: fields.project?.trim() || null,
    floor: fields.floor?.trim() || null,
    die: fields.die?.trim() || null,
    qty: fields.qty == null || fields.qty === '' ? null : Number(fields.qty),
    status: null,
    cuttingDate: fields.cuttingDate || null,
    shipDate: null,
    material: null,
    comments: fields.comments?.trim() || null,
    setup: null,
    rollingEta: null,
    dayShift: null,
    shifts: null,
    pinHole: null,
    bo: null,
    boRaw: null,
    boStat: null,
    backOrder: false,
    archived: false,
  });
  state.manualTasks = { ...state.manualTasks, [id]: task };
  logChange(`${task.machine}|${task.wo}|${task.die || ''}`, 'manual', null, null, 'added');
  save();
  return task;
}

export function updateManualTask(id, patch) {
  const cur = state.manualTasks?.[id];
  if (!cur) return;
  const next = changed({ ...cur, ...patch });
  state.manualTasks = { ...state.manualTasks, [id]: next };
  save();
}

export function deleteManualTask(id) {
  const cur = state.manualTasks?.[id];
  if (!cur) return;
  forget('manualTasks', id);
  logChange(`${cur.machine}|${cur.wo}|${cur.die || ''}`, 'manual', null, 'added', 'removed');
  save();
}

/* ---------- today's list ---------- */

/** A job to do that no schedule knows about: chase a supplier, change a blade,
    walk a drawing over. Dated, so the list is about a day rather than growing
    forever, but an unfinished one follows the day forward — see openTodos(). */
export function addTodo(text, { date, assignee = null } = {}) {
  const body = String(text || '').trim();
  if (!body) return null;
  const id = uid();
  state.todos = {
    ...state.todos,
    [id]: changed({ id, text: body, date, assignee, done: false }),
  };
  save();
  return id;
}

export function setTodo(id, patch) {
  const cur = state.todos?.[id];
  if (!cur) return;
  const next = changed({ ...cur, ...patch });
  if (patch.done === true && !cur.done) { next.doneAt = now(); next.doneBy = me(); }
  if (patch.done === false) { next.doneAt = null; next.doneBy = null; }
  state.todos = { ...state.todos, [id]: next };
  save();
}

export function deleteTodo(id) {
  forget('todos', id);
  save();
}

/* ---------- staging ---------- */

/* Prepping material for rolling. It is judged on whether the next shift walks
   in to a job that is ready, so what matters is not just "done" but "staged
   for which shift" — that is how the department's own staging sheet reads. */
export function setStaging(key, patch) {
  const cur = state.staging[key] || {};
  const next = changed({ ...cur, ...patch });
  if (cur.staged !== next.staged) {
    logChange(key, 'staging', null, cur.staged ? 'staged' : null, next.staged ? 'staged' : null);
  }
  if ((cur.stageFor || null) !== (next.stageFor || null)) {
    logChange(key, 'staging', 'stage for', cur.stageFor || null, next.stageFor || null);
  }
  state.staging[key] = next;
  save();
}

export function clearStaging(key) {
  if (!state.staging[key]) return;
  logChange(key, 'staging', null, 'staged', null);
  forget('staging', key);
  save();
}

export function saveShiftLog(date, shift, patch) {
  const key = `${date}|${shift}`;
  const cur = state.shiftLogs[key] || { date, shift, rows: {} };
  state.shiftLogs[key] = changed({ ...cur, ...patch, date, shift });
  save();
  return key;
}

export function deleteShiftLog(key) {
  forget('shiftLogs', key);
  save();
}

/** Per-machine overrides: display name, note and usual operator count. */
/** Put a machine back to its built-in name, note and crew. Recorded as a
    deletion so another device does not sync the old override back in. */
export function resetMachineConfig(key) {
  if (!state.machineConfig?.[key]) return;
  forget('machineConfig', key);
  save();
}

export function setMachineConfig(key, patch) {
  const cur = state.machineConfig[key] || {};
  const next = changed({ ...cur, ...patch });
  for (const k of ['label', 'note']) {
    if (next[k] != null && !String(next[k]).trim()) delete next[k];
  }
  state.machineConfig[key] = next;
  save();
}

/** Load a machine workbook. Tasks for that workbook's machines are replaced;
    the other workbook's tasks are left alone, so Rolling and CNC can be
    imported independently. */
export function setMachineImport({ tasks, shiftUpdate, report }) {
  const machines = new Set(tasks.map((t) => t.machine));
  state.tasks = state.tasks
    .filter((t) => t.source !== report.kind && !machines.has(t.machine))
    .concat(tasks.map((t) => ({ ...t, source: report.kind })));
  state.machineMeta = {
    ...state.machineMeta,
    [report.kind]: changed({
      fileName: report.fileName, importedAt: report.importedAt,
      count: tasks.length, parser: report.parser ?? 1,
    }),
  };
  if (shiftUpdate) state.shiftUpdate = { ...shiftUpdate, importedAt: report.importedAt };
  save();
  // The imported workbooks are the only thing that puts the heavy half of the
  // snapshot out of date, so this is the one place it gets pushed.
  queueCloudPush({ base: true, change: false });
}

/* ---------- local persistence ---------- */

function snapshot() {
  return {
    v: 2,
    tasks: state.tasks,
    machineMeta: state.machineMeta,
    taskStatus: state.taskStatus,
    shiftUpdate: state.shiftUpdate,
    taskNote: state.taskNote,
    taskEdit: state.taskEdit,
    backOrder: state.backOrder,
    materialOrders: state.materialOrders,
    rush: state.rush,
    taskAssign: state.taskAssign,
    parked: state.parked,
    taskHistory: state.taskHistory,
    machineConfig: state.machineConfig,
    shiftLogs: state.shiftLogs,
    manualTasks: state.manualTasks,
    todos: state.todos,
    staging: state.staging,
    deletions: state.deletions,
    people: state.people,
    settings: state.settings,
  };
}

function apply(data) {
  if (!data || typeof data !== 'object') return;
  for (const k of Object.keys(snapshot())) {
    if (k === 'v') continue;
    if (data[k] !== undefined) state[k] = data[k];
  }
  state.shiftLogs = onlyShiftLogs(state.shiftLogs);
  observeSnapshot(state);
  // Replacing state wholesale — a boot, a restored backup, a cloud pull — is
  // the one path that does not reach emit() on its own.
  rev++;
}

/* An earlier version of the app also wrote `shiftLogs`, in a different shape.
   Keep only entries in the current shape so a stale install does not render
   a half-formed update. */
function onlyShiftLogs(logs) {
  const out = {};
  for (const [k, v] of Object.entries(logs || {})) {
    if (v && typeof v === 'object' && v.rows && typeof v.rows === 'object'
        && !Array.isArray(v.rows) && v.date && v.shift) {
      out[k] = v;
    }
  }
  return out;
}

export function storageStatus() {
  return localSaveProblem
    ? { ok: false, ...localSaveProblem }
    : { ok: true, error: null, at: null };
}

function persistLocal(data = snapshot()) {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    localSaveProblem = null;
    return true;
  } catch (e) {
    console.warn('localStorage full or blocked', e);
    localSaveProblem = {
      error: 'This device could not save its local copy.',
      detail: e?.message || 'Browser storage is full or blocked.',
      at: now(),
    };
    return false;
  }
}

export function save() {
  persistLocal();
  if (fileHandle) queueFileSave();
  queueCloudPush();
  // Queueing first makes the render caused by this save see the pending work.
  // Otherwise the header briefly says "synced" after the operator has changed
  // something, until the debounce starts the upload several seconds later.
  emit();
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    apply(data);
    // Rewrite immediately if the payload still carries retired fields, so the
    // cleanup is visible now rather than waiting for the next incidental save.
    if (RETIRED_KEYS.some((k) => data[k] !== undefined)) {
      persistLocal();
    }
  } catch (e) {
    console.warn('could not read local data', e);
    localSaveProblem = {
      error: 'This device could not read its saved copy.',
      detail: e?.message || 'Browser storage is unavailable or damaged.',
      at: now(),
    };
  }
}

/* ---------- shared file ---------- */

let fileHandle = null;
let fileTimer = null;
let fileWritePromise = null;
let fileChangeId = 0;
let fileAckId = 0;
let fileState = { at: null, error: null, writing: false };

export function sharedFileName() {
  return fileHandle ? fileHandle.name : null;
}

export function sharedFileStatus() {
  return {
    ...fileState,
    on: !!fileHandle,
    where: sharedFileName(),
    pending: Math.max(0, fileChangeId - fileAckId),
  };
}

function setFileState(patch) {
  fileState = { ...fileState, ...patch };
  emit();
}

export function supportsSharedFile() {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window;
}

function idb() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function rememberHandle(handle) {
  const db = await idb();
  await new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, 'shared');
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

async function recallHandle() {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const r = tx.objectStore(IDB_STORE).get('shared');
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  } catch {
    return null;
  }
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableValue(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Whether a candidate record should replace the current one. Logical
    revisions remove device-clock skew from new records. Old snapshots without
    revisions retain timestamp ordering until each record is edited once. */
function recordWins(candidate, current) {
  if (!current) return !!candidate;
  if (!candidate) return false;
  observeRevision(candidate.rev);
  observeRevision(current.rev);
  const a = parseRevision(candidate.rev);
  const b = parseRevision(current.rev);
  if (a && b) {
    if (a.counter !== b.counter) return a.counter > b.counter;
    if (a.device !== b.device) return a.device > b.device;
  } else if (a || b) {
    // Once a line has been written by the revision-aware app, a stale cached
    // build must not put its timestamp-only copy back over it.
    return !!a;
  }
  const atA = candidate.at || '';
  const atB = current.at || '';
  if (atA !== atB) return atA > atB;
  return stableValue(candidate) > stableValue(current);
}

function observeSnapshot(snap) {
  for (const map of [...DELETABLE, 'deletions']) {
    for (const rec of Object.values(snap?.[map] || {})) observeRevision(rec?.rev);
  }
  for (const rec of Object.values(snap?.machineMeta || {})) observeRevision(rec?.rev);
  persistDeviceClock();
}

/* Merge two snapshots record-by-record, newest logical revision wins. */
export function mergeRecords(mine = {}, theirs = {}) {
  const out = { ...mine };
  for (const [k, v] of Object.entries(theirs)) {
    const a = out[k];
    if (recordWins(v, a)) out[k] = v;
  }
  return out;
}

function mergeSnapshot(remote) {
  if (!remote) return;
  state.taskStatus = mergeRecords(state.taskStatus, remote.taskStatus);
  state.taskNote = mergeRecords(state.taskNote, remote.taskNote);
  state.taskEdit = mergeRecords(state.taskEdit, remote.taskEdit);
  state.backOrder = mergeRecords(state.backOrder, remote.backOrder);
  state.materialOrders = mergeRecords(state.materialOrders, remote.materialOrders);
  state.rush = mergeRecords(state.rush, remote.rush);
  state.taskAssign = mergeRecords(state.taskAssign, remote.taskAssign);
  state.parked = mergeRecords(state.parked, remote.parked);

  // History is append-only: merge by id and keep it newest-first.
  const seen = new Set(state.taskHistory.map((h) => h.id));
  for (const h of remote.taskHistory || []) if (!seen.has(h.id)) state.taskHistory.push(h);
  state.taskHistory.sort((a, b) => (a.at < b.at ? 1 : -1));
  if (state.taskHistory.length > HISTORY_CAP) state.taskHistory.length = HISTORY_CAP;
  state.machineConfig = mergeRecords(state.machineConfig, remote.machineConfig);
  state.shiftLogs = mergeRecords(state.shiftLogs, remote.shiftLogs);
  state.manualTasks = mergeRecords(state.manualTasks, remote.manualTasks);
  state.todos = mergeRecords(state.todos, remote.todos);
  state.staging = mergeRecords(state.staging, remote.staging);
  // Merge the tombstones, then re-apply them: a record the other device
  // still holds must not walk back in after being deleted here.
  state.deletions = mergeRecords(state.deletions, remote.deletions);
  applyDeletions();
  state.people = Array.from(new Set([...(state.people || []), ...(remote.people || [])]));

  // Machine tasks come from whichever side imported them most recently.
  for (const kind of ['rolling', 'cnc']) {
    const mine = state.machineMeta?.[kind];
    const theirs = remote.machineMeta?.[kind];
    if (recordWins(theirs, mine) && Array.isArray(remote.tasks)) {
      state.tasks = state.tasks.filter((t) => t.source !== kind)
        .concat(remote.tasks.filter((t) => t.source === kind));
      state.machineMeta = { ...state.machineMeta, [kind]: remote.machineMeta[kind] };
      // The shift update rides along with the CNC workbook.
      if (kind === 'cnc' && remote.shiftUpdate) state.shiftUpdate = remote.shiftUpdate;
    }
  }
}

async function readHandle(handle) {
  const f = await handle.getFile();
  if (!f.size) return null;
  return JSON.parse(await f.text());
}

export async function connectSharedFile({ create = false } = {}) {
  if (!supportsSharedFile()) {
    throw new Error(
      'This browser cannot open a shared file directly. Use Chrome or Edge, ' +
      'or use Export / Import on the Setup tab instead.'
    );
  }
  const opts = {
    types: [{ description: 'Tracker data', accept: { 'application/json': ['.json'] } }],
    suggestedName: 'cutting-tracker-data.json',
  };
  const handle = create
    ? await window.showSaveFilePicker(opts)
    : (await window.showOpenFilePicker({ ...opts, multiple: false }))[0];

  fileHandle = handle;
  await rememberHandle(handle);

  if (!create) {
    const remote = await readHandle(handle);
    mergeSnapshot(remote);
  }
  fileChangeId++;
  await flushSharedFile();
  return handle.name;
}

export async function reconnectSharedFile() {
  const handle = await recallHandle();
  if (!handle) return null;
  const perm = await handle.queryPermission?.({ mode: 'readwrite' });
  if (perm !== 'granted') return { needsPermission: true, name: handle.name, handle };
  fileHandle = handle;
  await pullSharedFile();
  return { name: handle.name };
}

export async function grantSharedFile(handle) {
  const perm = await handle.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') throw new Error('Permission to the shared file was not granted.');
  fileHandle = handle;
  await pullSharedFile();
  return handle.name;
}

export async function pullSharedFile() {
  if (!fileHandle) return false;
  try {
    const remote = await readHandle(fileHandle);
    mergeSnapshot(remote);
    persistLocal();
    setFileState({ at: now(), error: null });
    return true;
  } catch (e) {
    console.warn('could not read shared file', e);
    setFileState({ error: e?.message || 'Could not read the shared file.' });
    return false;
  }
}

async function writeSharedFile() {
  if (!fileHandle) return;
  // Merge whatever is on disk first so a concurrent edit is not overwritten.
  try {
    const remote = await readHandle(fileHandle);
    if (remote) mergeSnapshot(remote);
  } catch { /* first write, or file mid-write elsewhere */ }

  const w = await fileHandle.createWritable();
  await w.write(JSON.stringify(snapshot()));
  await w.close();
}

/* Serialise writes and acknowledge only the edits included in each snapshot.
   If somebody changes another line while a network-drive write is in flight,
   the loop takes a second snapshot instead of letting the first completion
   falsely clear the pending indicator. */
async function flushSharedFile() {
  if (!fileHandle) return false;
  if (fileWritePromise) return fileWritePromise;
  clearTimeout(fileTimer);

  fileWritePromise = (async () => {
    setFileState({ writing: true });
    let ok = true;
    try {
      do {
        const sending = fileChangeId;
        await writeSharedFile();
        fileAckId = Math.max(fileAckId, sending);
        setFileState({ at: now(), error: null });
      } while (fileChangeId > fileAckId);
    } catch (e) {
      ok = false;
      console.warn('shared file write failed', e);
      setFileState({ error: e?.message || 'Could not write to the shared file.' });
    } finally {
      setFileState({ writing: false });
    }
    return ok;
  })();

  try { return await fileWritePromise; }
  finally { fileWritePromise = null; }
}

/* ---------- cloud sync ---------- */

/* The shared file needs the File System Access API, which no phone browser
   has. This is the same merge over HTTPS instead, so the tracker works on a
   phone and a PC at once.

   The snapshot is split in two. `base` is the imported workbooks — about a
   megabyte, changing only on re-import. `work` is what people actually do —
   a few kilobytes, changing constantly. Pushing them together would mean a
   phone uploading the workbooks every time somebody taps Done. */
const CLOUD_BASE_KEYS = ['tasks', 'machineMeta', 'shiftUpdate'];

function cloudDoc(part) {
  const snap = snapshot();
  const pick = (keys) => Object.fromEntries(keys.map((k) => [k, snap[k]]));
  if (part === 'base') return pick(['v', ...CLOUD_BASE_KEYS]);
  return pick(Object.keys(snap).filter((k) => !CLOUD_BASE_KEYS.includes(k)));
}

let cloudTimer = null;
let cloudPoll = null;
let cloudBusy = false;
let cloudPushPromise = null;
let cloudChangeId = 0;
let cloudAckId = 0;
let cloudState = { on: false, at: null, error: null, pushing: false, pulling: false };

export function cloudStatus() {
  return {
    ...cloudState,
    on: cloudEnabled(),
    where: cloudHost(),
    pending: Math.max(0, cloudChangeId - cloudAckId),
  };
}

function setCloudState(patch) {
  cloudState = { ...cloudState, ...patch };
  emit();
}

/** Merge whatever the cloud has into local state. Safe to call any time. */
export async function pullCloud({ parts = CLOUD_PARTS } = {}) {
  if (!cloudEnabled() || cloudBusy) return false;
  cloudBusy = true;
  setCloudState({ pulling: true });
  try {
    const remote = await cloudPull(parts);
    // Each document is a partial snapshot; mergeSnapshot ignores absent keys.
    if (remote?.work) mergeSnapshot(remote.work);
    if (remote?.base) mergeSnapshot(remote.base);
    persistLocal();
    setCloudState({ at: now(), error: null });
    return true;
  } catch (e) {
    setCloudState({ error: e.message });
    return false;
  } finally {
    cloudBusy = false;
    setCloudState({ pulling: false });
  }
}

/** Push, merging the cloud's copy in first so a concurrent edit is not lost.
    `base` rides along only when this device imported more recently. */
let cloudBaseDirty = false;

async function pushCloud(withBase = false) {
  if (!cloudEnabled()) return false;
  if (withBase) cloudBaseDirty = true;
  if (cloudPushPromise) return cloudPushPromise;
  clearTimeout(cloudTimer);

  /* A completion acknowledges the edit generation it actually sent, not the
     current generation. This matters when a second tap lands during the fetch:
     that tap stays pending and the loop sends a fresh snapshot immediately. */
  cloudPushPromise = (async () => {
    setCloudState({ pushing: true });
    let ok = true;
    let attemptedBase = false;
    try {
      do {
        const sending = cloudChangeId;
        const includeBase = cloudBaseDirty;
        attemptedBase = includeBase;
        cloudBaseDirty = false;

        const remote = await cloudPull(includeBase ? CLOUD_PARTS : ['work']);
        if (remote?.work) mergeSnapshot(remote.work);
        if (includeBase && remote?.base) mergeSnapshot(remote.base);

        const docs = { work: cloudDoc('work') };
        if (includeBase) docs.base = cloudDoc('base');
        await cloudPush(docs);

        cloudAckId = Math.max(cloudAckId, sending);
        persistLocal();
        setCloudState({ at: now(), error: null });
      } while (cloudChangeId > cloudAckId || cloudBaseDirty);
    } catch (e) {
      ok = false;
      // If a base upload failed, the next retry still has to carry it. The
      // work half is always sent, so its pending generation remains unacked.
      if (attemptedBase) cloudBaseDirty = true;
      setCloudState({ error: e.message });
    } finally {
      setCloudState({ pushing: false });
    }
    return ok;
  })();

  try { return await cloudPushPromise; }
  finally { cloudPushPromise = null; }
}

function queueCloudPush({ base = false, change = true } = {}) {
  if (!cloudEnabled()) return;
  if (change) cloudChangeId++;
  if (base) cloudBaseDirty = true;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    const withBase = cloudBaseDirty;
    pushCloud(withBase);
  }, base ? 400 : 2500);
}

/** Connect (or reconnect) and start syncing. Returns where it connected to. */
export async function connectCloud(cfg) {
  if (cfg) {
    await cloudTest(cfg);
    setCloudConfig(cfg);
  }
  if (!cloudEnabled()) return null;

  await pullCloud();
  // First device to connect seeds the cloud with whatever it already has.
  await pushCloud(true);
  startCloudPolling();
  setCloudState({ on: true });
  return cloudHost();
}

export function disconnectCloud() {
  setCloudConfig(null);
  clearInterval(cloudPoll);
  cloudPoll = null;
  clearTimeout(cloudTimer);
  cloudChangeId = 0;
  cloudAckId = 0;
  cloudBaseDirty = false;
  setCloudState({ on: false, at: null, error: null });
}

/* Poll rather than subscribe: it is a handful of bytes a minute, it needs no
   websocket to survive the shop's network, and a tracker that is thirty
   seconds stale is not a tracker anybody notices is stale. */
function startCloudPolling() {
  clearInterval(cloudPoll);
  if (!cloudEnabled()) return;
  cloudPoll = setInterval(() => {
    if (document.visibilityState === 'visible') retrySync();
  }, 30000);
}

/** Called once at boot. Reconnects silently if this device is already set up. */
export async function initCloud() {
  if (!cloudEnabled()) return null;
  setCloudState({ on: true });
  await pullCloud();
  // The local copy may contain work recorded offline before a reload. A small
  // merge-first work push on boot is the only reliable way to flush it without
  // waiting for somebody to make another edit.
  await pushCloud();
  startCloudPolling();
  return cloudHost();
}

function queueFileSave() {
  fileChangeId++;
  clearTimeout(fileTimer);
  fileTimer = setTimeout(() => { flushSharedFile(); }, 1200);
}

/** Retry every configured transport. Used by the header, Setup, reconnect and
    the 30-second poll. A pending upload goes out; otherwise this is a refresh. */
export async function retrySync() {
  clearTimeout(cloudTimer);
  clearTimeout(fileTimer);
  const work = [];
  if (cloudEnabled()) {
    work.push(cloudChangeId > cloudAckId || cloudBaseDirty || cloudState.error
      ? pushCloud()
      : pullCloud({ parts: ['work'] }));
  }
  if (fileHandle) {
    work.push(fileChangeId > fileAckId || fileState.error
      ? flushSharedFile()
      : pullSharedFile());
  }
  if (!work.length) return false;
  const results = await Promise.all(work);
  return results.every(Boolean);
}

export function hasUnsyncedChanges() {
  return cloudChangeId > cloudAckId || fileChangeId > fileAckId || cloudBaseDirty;
}

export function disconnectSharedFile() {
  fileHandle = null;
  clearTimeout(fileTimer);
  fileChangeId = 0;
  fileAckId = 0;
  fileState = { at: null, error: null, writing: false };
  emit();
}

/* ---------- export / import fallback ---------- */

export function exportJson() {
  return JSON.stringify(snapshot(), null, 2);
}

export function importJson(text, { merge = true } = {}) {
  const data = JSON.parse(text);
  if (merge) mergeSnapshot(data);
  else apply(data);
  save();
}

export function resetAll() {
  localStorage.removeItem(LS_KEY);
}
