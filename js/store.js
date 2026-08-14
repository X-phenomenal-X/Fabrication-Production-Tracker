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
  'history', 'manualOrders', 'shiftLogs', 'plan', 'guide', 'audit',
  'lastImportReport',
];

export const state = {
  tasks: [],        // machine-schedule rows: the base for scheduling
  machineMeta: {},  // kind -> { fileName, importedAt, count }
  taskStatus: {},   // `${machine}|${wo}|${die}` -> { status, at, by }
  shiftUpdate: null, // latest Shift Update sheet: { date, shift, machines }
  taskNote: {},     // `${machine}|${wo}|${die}` -> { text, at, by }
  machineConfig: {}, // machineKey -> { label, note, ops, hidden }
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

/* ---------- mutations ---------- */

/** Status of a single machine-schedule line: Not started / In Progress / Done.
    Keyed by machine+wo+die rather than the task's own id, because that id
    embeds a sheet row number that shifts on every re-import — keying on the
    row would silently orphan an operator's update the next time the Rolling
    or CNC workbook is reloaded. */
export function setTaskStatus(key, status) {
  state.taskStatus[key] = { status, at: now(), by: me() };
  save();
}

/** Set several lines at once — a shift finishing a batch should not have to
    click each line. Returns what the previous values were, so it can be undone. */
export function setTaskStatusMany(keys, status) {
  const before = keys.map((k) => ({ key: k, prev: state.taskStatus[k]?.status ?? null }));
  const at = now();
  const by = me();
  for (const k of keys) state.taskStatus[k] = { status, at, by };
  save();
  return before;
}

/** Restore a set of lines to what they were before the last change. */
export function restoreTaskStatus(before) {
  const at = now();
  const by = me();
  for (const { key, prev } of before) {
    if (prev == null) delete state.taskStatus[key];
    else state.taskStatus[key] = { status: prev, at, by };
  }
  save();
}

/** A free-text note an operator can leave on a line — why it is stuck, what
    was short, anything the next shift needs. Empty text clears it. */
export function setTaskNote(key, text) {
  const t = String(text || '').trim();
  if (!t) delete state.taskNote[key];
  else state.taskNote[key] = { text: t, at: now(), by: me() };
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
    machineConfig: state.machineConfig,
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
  state.machineConfig = mergeRecords(state.machineConfig, remote.machineConfig);
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
