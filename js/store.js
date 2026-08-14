/* App state, persistence, and the shared-file sync.

   Two layers of storage:
   - localStorage: always on, instant, per-device. The app works with nothing else.
   - a shared JSON file on the network drive (File System Access API): optional,
     and what makes the department see each other's updates.

   Sync is a per-record merge, not whole-file last-write-wins. Every record
   carries an `at` timestamp and the newer one wins, so two people editing
   different orders at the same time both keep their work. */

const LS_KEY = 'bv.cutting.v1';
const IDB_NAME = 'bv-cutting';
const IDB_STORE = 'handles';

export const state = {
  meta: { revision: null, importedAt: null, fileName: null },
  orders: [],
  wip: [],
  prep: [],
  screens: [],
  progress: {},   // `${orderId}|${opKey}` -> { done, at, by, note }
  material: {},   // `${orderId}|${profileKey}` -> { status, note, at, by }
  history: [],    // every change, newest first — the traceability record
  manualOrders: {}, // id -> order added by hand, e.g. service orders
  tasks: [],        // machine-schedule rows: the base for scheduling
  machineMeta: {},  // kind -> { fileName, importedAt, count }
  taskStatus: {},   // `${machine}|${wo}|${die}` -> { status, at, by }
  shiftLogs: {},  // id -> log
  plan: {},       // `${date}|${shift}` -> { ids, at, by }
  guide: {},      // id -> doc
  people: [],
  audit: [],
  settings: { me: null, activeOnly: true },
  lastImportReport: null,
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

/* ---------- audit ---------- */

export function log(what, detail) {
  state.audit.unshift({ at: now(), who: me(), what, detail });
  if (state.audit.length > 800) state.audit.length = 800;
}

/** Append to the per-order traceability record. Unlike `audit`, this is keyed
    by order so an order's whole history can be shown on the order itself. */
export function trace(orderId, kind, from, to, note) {
  state.history.unshift({
    id: uid(), orderId, kind, from: from ?? null, to: to ?? null,
    note: note || null, at: now(), by: me(),
  });
  if (state.history.length > 5000) state.history.length = 5000;
}

export function historyFor(orderId) {
  return state.history.filter((h) => h.orderId === orderId);
}

/* ---------- mutations ---------- */

export function setProgress(orderId, opKey, done, note) {
  const key = `${orderId}|${opKey}`;
  const prev = state.progress[key];
  state.progress[key] = { done, at: now(), by: me(), note: note ?? prev?.note ?? null };
  log('progress', `${orderId} ${opKey} → ${done}`);
  trace(orderId, `cut:${opKey}`, prev?.done ?? null, done, note);
  save();
}

export function setMaterial(orderId, profileKey, status, note) {
  const key = `${orderId}|${profileKey}`;
  const prev = state.material[key];
  state.material[key] = { status, note: note ?? null, at: now(), by: me() };
  log('material', `${orderId} ${profileKey} → ${status}`);
  trace(orderId, `material:${profileKey}`, prev?.status ?? null, status, note);
  save();
}

/** Status of a single machine-schedule line, e.g. Not started / In Progress /
    Done. Keyed by machine+wo+die rather than the task's own id, because the
    id embeds a sheet row number that shifts on every re-import — keying on
    the row would silently orphan an operator's update the next time the
    Rolling or CNC workbook is reloaded. */
export function setTaskStatus(key, status) {
  const prev = state.taskStatus[key];
  state.taskStatus[key] = { status, at: now(), by: me() };
  log('task status', `${key} → ${status}`);
  trace(key, 'task', prev?.status ?? null, status);
  save();
}

export function clearProgress(orderId, opKey) {
  const key = `${orderId}|${opKey}`;
  if (!state.progress[key]) return;
  // Tombstone rather than delete, so the removal survives a merge.
  state.progress[key] = { done: null, at: now(), by: me(), deleted: true };
  save();
}

export function saveShiftLog(entry) {
  const id = entry.id || uid();
  state.shiftLogs[id] = { ...entry, id, at: now(), by: entry.by || me() };
  log('shift log', `${entry.date} ${entry.shift}`);
  save();
  return id;
}

export function deleteShiftLog(id) {
  if (state.shiftLogs[id]) state.shiftLogs[id] = { id, at: now(), by: me(), deleted: true };
  save();
}

export function setPlan(date, shift, ids) {
  state.plan[`${date}|${shift}`] = { ids, at: now(), by: me() };
  save();
}

export function saveGuideDoc(doc) {
  const id = doc.id || uid();
  state.guide[id] = { ...doc, id, at: now(), by: me() };
  log('guide', doc.title || id);
  save();
  return id;
}

export function deleteGuideDoc(id) {
  if (state.guide[id]) state.guide[id] = { id, at: now(), by: me(), deleted: true };
  save();
}

/** Orders added by hand — service orders and anything not on the schedule.
    Kept separate from imported rows so a re-import never wipes them. */
export function saveManualOrder(o) {
  const id = o.id || `manual:${uid()}`;
  state.manualOrders[id] = { ...o, id, manual: true, at: now(), by: o.by || me() };
  log('manual order', `${o.wo || id}`);
  trace(id, 'order', null, o.wo || 'created', o.notes);
  save();
  return id;
}

export function deleteManualOrder(id) {
  if (state.manualOrders[id]) {
    state.manualOrders[id] = { id, at: now(), by: me(), deleted: true };
  }
  save();
}

/** Load a machine workbook. Tasks for that workbook's machines are replaced;
    the other workbook's tasks are left alone, so Rolling and CNC can be
    imported independently. */
export function setMachineImport({ tasks, report }) {
  const machines = new Set(tasks.map((t) => t.machine));
  state.tasks = state.tasks
    .filter((t) => t.source !== report.kind && !machines.has(t.machine))
    .concat(tasks.map((t) => ({ ...t, source: report.kind })));
  state.machineMeta = {
    ...state.machineMeta,
    [report.kind]: { fileName: report.fileName, importedAt: report.importedAt, count: tasks.length },
  };
  log('import', `${report.fileName} — ${tasks.length} machine tasks`);
  save();
}

export function setImport({ orders, wip, prep, screens, report }) {
  state.orders = orders;
  state.wip = wip;
  state.prep = prep;
  state.screens = screens;
  state.meta = {
    revision: report.fileName,
    importedAt: report.importedAt,
    fileName: report.fileName,
  };
  state.lastImportReport = report;
  log('import', `${report.fileName} — ${orders.length} orders`);
  save();
}

/* ---------- local persistence ---------- */

function snapshot() {
  return {
    v: 1,
    meta: state.meta,
    orders: state.orders,
    wip: state.wip,
    prep: state.prep,
    screens: state.screens,
    progress: state.progress,
    material: state.material,
    history: state.history,
    manualOrders: state.manualOrders,
    tasks: state.tasks,
    machineMeta: state.machineMeta,
    taskStatus: state.taskStatus,
    shiftLogs: state.shiftLogs,
    plan: state.plan,
    guide: state.guide,
    people: state.people,
    audit: state.audit,
    settings: state.settings,
    lastImportReport: state.lastImportReport,
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
    if (raw) apply(JSON.parse(raw));
  } catch (e) {
    console.warn('could not read local data', e);
  }
}

/* ---------- shared file ---------- */

let fileHandle = null;
let lastFileWrite = 0;

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
  state.progress = mergeRecords(state.progress, remote.progress);
  state.material = mergeRecords(state.material, remote.material);
  state.manualOrders = mergeRecords(state.manualOrders, remote.manualOrders);
  state.taskStatus = mergeRecords(state.taskStatus, remote.taskStatus);

  // History is append-only, so merge by id and re-sort newest first.
  const haveIds = new Set(state.history.map((h) => h.id));
  for (const h of remote.history || []) if (!haveIds.has(h.id)) state.history.push(h);
  state.history.sort((a, b) => (a.at < b.at ? 1 : -1));
  if (state.history.length > 5000) state.history.length = 5000;
  state.shiftLogs = mergeRecords(state.shiftLogs, remote.shiftLogs);
  state.plan = mergeRecords(state.plan, remote.plan);
  state.guide = mergeRecords(state.guide, remote.guide);
  state.people = Array.from(new Set([...(state.people || []), ...(remote.people || [])]));

  // The order list comes from whichever revision was imported most recently.
  // Machine tasks come from whichever side imported them most recently.
  for (const kind of ['rolling', 'cnc']) {
    const mine = state.machineMeta?.[kind]?.importedAt || '';
    const theirs = remote.machineMeta?.[kind]?.importedAt || '';
    if (theirs > mine && Array.isArray(remote.tasks)) {
      state.tasks = state.tasks.filter((t) => t.source !== kind)
        .concat(remote.tasks.filter((t) => t.source === kind));
      state.machineMeta = { ...state.machineMeta, [kind]: remote.machineMeta[kind] };
    }
  }

  const mineAt = state.meta?.importedAt || '';
  const theirsAt = remote.meta?.importedAt || '';
  if (theirsAt > mineAt && Array.isArray(remote.orders) && remote.orders.length) {
    state.orders = remote.orders;
    state.wip = remote.wip || [];
    state.prep = remote.prep || [];
    state.screens = remote.screens || [];
    state.meta = remote.meta;
    state.lastImportReport = remote.lastImportReport || state.lastImportReport;
  }

  const seen = new Set(state.audit.map((a) => a.at + a.who + a.what));
  for (const a of remote.audit || []) {
    if (!seen.has(a.at + a.who + a.what)) state.audit.push(a);
  }
  state.audit.sort((x, y) => (x.at < y.at ? 1 : -1));
  if (state.audit.length > 800) state.audit.length = 800;
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
      'or use Export / Import on the Data tab instead.'
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
  lastFileWrite = Date.now();
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
