/* App state, persistence, and the shared-file sync.

   Two layers of storage:
   - localStorage: always on, instant, per-device. The app works with nothing else.
   - a shared JSON file on the network drive (File System Access API): optional,
     and what makes the department see each other's updates.

   Sync is a per-record merge, not whole-file last-write-wins. Every record
   carries an `at` timestamp and the newer one wins, so two people updating
   different lines at the same time both keep their work. */

import {
  setCloudConfig, cloudEnabled, cloudHost,
  cloudPull, cloudPush, cloudTest, CLOUD_PARTS,
} from './cloud.js';

export { cloudEnabled, cloudHost, cloudConfig } from './cloud.js';

const LS_KEY = 'bv.cutting.v1';
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
  rush: {},         // same key -> { on, needBy, assignee, reason, at, by }
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
  deletions: {},    // `${map}:${key}` -> { at, by } — see forget()
  people: [],
  settings: { me: null },
};

let saveTimer = null;
const listeners = new Set();

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn();
}

export function now() {
  return new Date().toISOString();
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function me() {
  return state.settings.me || 'Unassigned';
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
  'taskStatus', 'taskNote', 'taskEdit', 'backOrder', 'rush', 'taskAssign',
  'manualTasks', 'todos', 'shiftLogs', 'machineConfig',
];

function forget(map, key) {
  if (!DELETABLE.includes(map)) throw new Error(`forget(): ${map} is not a synced record map`);
  delete state[map][key];
  state.deletions = { ...state.deletions, [`${map}:${key}`]: { at: now(), by: me() } };
}

/** Re-apply every recorded deletion to the merged state. */
function applyDeletions() {
  for (const [k, tomb] of Object.entries(state.deletions || {})) {
    const i = k.indexOf(':');
    const map = k.slice(0, i);
    const key = k.slice(i + 1);
    const rec = state[map]?.[key];
    if (!rec) continue;
    if (rec.at && tomb.at && rec.at > tomb.at) continue;   // re-created since
    delete state[map][key];
  }
}

/* Tombstones are not kept forever. Ninety days is far longer than a device
   here goes without opening the app, and it stops the synced document growing
   by one entry for every note ever cleared. */
const TOMBSTONE_DAYS = 90;

function pruneDeletions() {
  const cutoff = new Date(Date.now() - TOMBSTONE_DAYS * 86400000).toISOString();
  const out = {};
  for (const [k, v] of Object.entries(state.deletions || {})) {
    if ((v.at || '') > cutoff) out[k] = v;
  }
  state.deletions = out;
}

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
  state.taskStatus[key] = { status, at: now(), by: me() };
  if (prev !== status) logChange(key, 'status', null, prev, status);
  save();
}

/** Set several lines at once — a shift finishing a batch should not have to
    click each line. Returns what the previous values were, so it can be undone. */
export function setTaskStatusMany(keys, status) {
  const before = keys.map((k) => ({ key: k, prev: state.taskStatus[k]?.status ?? null }));
  const at = now();
  const by = me();
  for (const k of keys) state.taskStatus[k] = { status, at, by };
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
    else state.taskStatus[key] = { status: prev, at, by };
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
  else state.taskNote[key] = { text: t, at: now(), by: me() };
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

  if (Object.keys(fields).length) state.taskEdit[key] = { fields, at: now(), by: me() };
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
  else state.backOrder[key] = { ...next, at: now(), by: me() };
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
  else state.rush[key] = { ...next, at: now(), by: me() };
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
  else state.taskAssign[key] = { machine, at: now(), by: me() };
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
  const task = {
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
    at: now(),
    by: me(),
  };
  state.manualTasks = { ...state.manualTasks, [id]: task };
  logChange(`${task.machine}|${task.wo}|${task.die || ''}`, 'manual', null, null, 'added');
  save();
  return task;
}

export function updateManualTask(id, patch) {
  const cur = state.manualTasks?.[id];
  if (!cur) return;
  const next = { ...cur, ...patch, at: now(), by: me() };
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
    [id]: { id, text: body, date, assignee, done: false, at: now(), by: me() },
  };
  save();
  return id;
}

export function setTodo(id, patch) {
  const cur = state.todos?.[id];
  if (!cur) return;
  const next = { ...cur, ...patch, at: now() };
  if (patch.done === true && !cur.done) { next.doneAt = now(); next.doneBy = me(); }
  if (patch.done === false) { next.doneAt = null; next.doneBy = null; }
  state.todos = { ...state.todos, [id]: next };
  save();
}

export function deleteTodo(id) {
  forget('todos', id);
  save();
}

export function saveShiftLog(date, shift, patch) {
  const key = `${date}|${shift}`;
  const cur = state.shiftLogs[key] || { date, shift, rows: {} };
  state.shiftLogs[key] = { ...cur, ...patch, date, shift, at: now(), by: me() };
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
  const next = { ...cur, ...patch, at: now(), by: me() };
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
    [report.kind]: {
      fileName: report.fileName, importedAt: report.importedAt,
      count: tasks.length, parser: report.parser ?? 1,
    },
  };
  if (shiftUpdate) state.shiftUpdate = { ...shiftUpdate, importedAt: report.importedAt };
  save();
  // The imported workbooks are the only thing that puts the heavy half of the
  // snapshot out of date, so this is the one place it gets pushed.
  queueCloudPush({ base: true });
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
    rush: state.rush,
    taskAssign: state.taskAssign,
    taskHistory: state.taskHistory,
    machineConfig: state.machineConfig,
    shiftLogs: state.shiftLogs,
    manualTasks: state.manualTasks,
    todos: state.todos,
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

export function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(snapshot()));
  } catch (e) {
    console.warn('localStorage full or blocked', e);
  }
  emit();
  if (fileHandle) queueFileSave();
  queueCloudPush();
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    apply(data);
    pruneDeletions();
    // Rewrite immediately if the payload still carries retired fields, so the
    // cleanup is visible now rather than waiting for the next incidental save.
    if (RETIRED_KEYS.some((k) => data[k] !== undefined)) {
      localStorage.setItem(LS_KEY, JSON.stringify(snapshot()));
    }
  } catch (e) {
    console.warn('could not read local data', e);
  }
}

/* ---------- shared file ---------- */

let fileHandle = null;

export function sharedFileName() {
  return fileHandle ? fileHandle.name : null;
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

/* Merge two snapshots record-by-record, newest timestamp wins. */
function mergeRecords(mine = {}, theirs = {}) {
  const out = { ...mine };
  for (const [k, v] of Object.entries(theirs)) {
    const a = out[k];
    if (!a || !a.at || (v.at && v.at > a.at)) out[k] = v;
  }
  return out;
}

function mergeSnapshot(remote) {
  if (!remote) return;
  state.taskStatus = mergeRecords(state.taskStatus, remote.taskStatus);
  state.taskNote = mergeRecords(state.taskNote, remote.taskNote);
  state.taskEdit = mergeRecords(state.taskEdit, remote.taskEdit);
  state.backOrder = mergeRecords(state.backOrder, remote.backOrder);
  state.rush = mergeRecords(state.rush, remote.rush);
  state.taskAssign = mergeRecords(state.taskAssign, remote.taskAssign);

  // History is append-only: merge by id and keep it newest-first.
  const seen = new Set(state.taskHistory.map((h) => h.id));
  for (const h of remote.taskHistory || []) if (!seen.has(h.id)) state.taskHistory.push(h);
  state.taskHistory.sort((a, b) => (a.at < b.at ? 1 : -1));
  if (state.taskHistory.length > HISTORY_CAP) state.taskHistory.length = HISTORY_CAP;
  state.machineConfig = mergeRecords(state.machineConfig, remote.machineConfig);
  state.shiftLogs = mergeRecords(state.shiftLogs, remote.shiftLogs);
  state.manualTasks = mergeRecords(state.manualTasks, remote.manualTasks);
  state.todos = mergeRecords(state.todos, remote.todos);
  // Merge the tombstones, then re-apply them: a record the other device
  // still holds must not walk back in after being deleted here.
  state.deletions = mergeRecords(state.deletions, remote.deletions);
  applyDeletions();
  state.people = Array.from(new Set([...(state.people || []), ...(remote.people || [])]));

  // Machine tasks come from whichever side imported them most recently.
  for (const kind of ['rolling', 'cnc']) {
    const mine = state.machineMeta?.[kind]?.importedAt || '';
    const theirs = remote.machineMeta?.[kind]?.importedAt || '';
    if (theirs > mine && Array.isArray(remote.tasks)) {
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
  await writeSharedFile();
  emit();
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
    localStorage.setItem(LS_KEY, JSON.stringify(snapshot()));
    emit();
    return true;
  } catch (e) {
    console.warn('could not read shared file', e);
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
let cloudState = { on: false, at: null, error: null, pushing: false };

export function cloudStatus() {
  return { ...cloudState, on: cloudEnabled(), where: cloudHost() };
}

function setCloudState(patch) {
  cloudState = { ...cloudState, ...patch };
  emit();
}

/** Merge whatever the cloud has into local state. Safe to call any time. */
export async function pullCloud({ parts = CLOUD_PARTS } = {}) {
  if (!cloudEnabled() || cloudBusy) return false;
  cloudBusy = true;
  try {
    const remote = await cloudPull(parts);
    // Each document is a partial snapshot; mergeSnapshot ignores absent keys.
    if (remote?.work) mergeSnapshot(remote.work);
    if (remote?.base) mergeSnapshot(remote.base);
    localStorage.setItem(LS_KEY, JSON.stringify(snapshot()));
    setCloudState({ at: now(), error: null });
    return true;
  } catch (e) {
    setCloudState({ error: e.message });
    return false;
  } finally {
    cloudBusy = false;
  }
}

/** Push, merging the cloud's copy in first so a concurrent edit is not lost.
    `base` rides along only when this device imported more recently. */
async function pushCloud(withBase) {
  if (!cloudEnabled()) return;
  setCloudState({ pushing: true });
  try {
    const remote = await cloudPull(withBase ? CLOUD_PARTS : ['work']);
    if (remote?.work) mergeSnapshot(remote.work);
    if (withBase && remote?.base) mergeSnapshot(remote.base);

    const docs = { work: cloudDoc('work') };
    if (withBase) docs.base = cloudDoc('base');
    await cloudPush(docs);

    localStorage.setItem(LS_KEY, JSON.stringify(snapshot()));
    setCloudState({ at: now(), error: null, pushing: false });
  } catch (e) {
    setCloudState({ error: e.message, pushing: false });
  }
}

let cloudBaseDirty = false;

function queueCloudPush({ base = false } = {}) {
  if (!cloudEnabled()) return;
  if (base) cloudBaseDirty = true;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    const withBase = cloudBaseDirty;
    cloudBaseDirty = false;
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
  setCloudState({ on: false, at: null, error: null });
}

/* Poll rather than subscribe: it is a handful of bytes a minute, it needs no
   websocket to survive the shop's network, and a tracker that is thirty
   seconds stale is not a tracker anybody notices is stale. */
function startCloudPolling() {
  clearInterval(cloudPoll);
  if (!cloudEnabled()) return;
  cloudPoll = setInterval(() => {
    if (document.visibilityState === 'visible') pullCloud({ parts: ['work'] });
  }, 30000);
}

/** Called once at boot. Reconnects silently if this device is already set up. */
export async function initCloud() {
  if (!cloudEnabled()) return null;
  setCloudState({ on: true });
  await pullCloud();
  startCloudPolling();
  return cloudHost();
}

function queueFileSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeSharedFile().catch((e) => console.warn('shared file write failed', e));
  }, 1200);
}

export function disconnectSharedFile() {
  fileHandle = null;
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
