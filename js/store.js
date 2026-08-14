/* App state, persistence, and the shared-file sync.

   Two layers of storage:
   - localStorage: always on, instant, per-device. The app works with nothing else.
   - a shared JSON file on the network drive (File System Access API): optional,
     and what makes the department see each other's updates.

   Sync is a per-record merge, not whole-file last-write-wins. Every record
   carries an `at` timestamp and the newer one wins, so two people updating
   different lines at the same time both keep their work. */

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
  taskHistory: [],  // every change to a line, newest first
  machineConfig: {}, // machineKey -> { label, note, ops, hidden }
  shiftLogs: {},    // `${date}|${shift}` -> { date, shift, rows, notes, at, by }
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
    if (prev == null) delete state.taskStatus[key];
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
  if (!t) delete state.taskNote[key];
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
  else delete state.taskEdit[key];
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
  if (empty) delete state.backOrder[key];
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
  delete state.backOrder[key];
  save();
}

/** Drop every correction on a line and go back to what the workbook says. */
export function clearTaskEdits(key, sheet = {}) {
  const cur = state.taskEdit[key]?.fields || {};
  for (const [f, v] of Object.entries(cur)) logChange(key, 'field', f, v, sheet[f] ?? null);
  delete state.taskEdit[key];
  save();
}

/** Save (or update) the shift update for one date and shift. */
export function saveShiftLog(date, shift, patch) {
  const key = `${date}|${shift}`;
  const cur = state.shiftLogs[key] || { date, shift, rows: {} };
  state.shiftLogs[key] = { ...cur, ...patch, date, shift, at: now(), by: me() };
  save();
  return key;
}

export function deleteShiftLog(key) {
  delete state.shiftLogs[key];
  save();
}

/** Per-machine overrides: display name, note and usual operator count. */
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
    [report.kind]: { fileName: report.fileName, importedAt: report.importedAt, count: tasks.length },
  };
  if (shiftUpdate) state.shiftUpdate = { ...shiftUpdate, importedAt: report.importedAt };
  save();
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
    taskHistory: state.taskHistory,
    machineConfig: state.machineConfig,
    shiftLogs: state.shiftLogs,
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

  // History is append-only: merge by id and keep it newest-first.
  const seen = new Set(state.taskHistory.map((h) => h.id));
  for (const h of remote.taskHistory || []) if (!seen.has(h.id)) state.taskHistory.push(h);
  state.taskHistory.sort((a, b) => (a.at < b.at ? 1 : -1));
  if (state.taskHistory.length > HISTORY_CAP) state.taskHistory.length = HISTORY_CAP;
  state.machineConfig = mergeRecords(state.machineConfig, remote.machineConfig);
  state.shiftLogs = mergeRecords(state.shiftLogs, remote.shiftLogs);
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
