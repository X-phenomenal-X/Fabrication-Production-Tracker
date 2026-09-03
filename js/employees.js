/* Employee-directory writes are kept behind the lazy Employees page. The
   production shell only needs the compact read helpers in store.js. */

import {
  state, save, changedEmployee,
  cleanEmployeeName, employeeNameKey, employeeShift, employeeRole,
  employeeRecordNames, employeeDirectory, employeeCanUseApp,
} from './store.js';

function employeeIdForName(name) {
  /* Deterministic IDs let two supervisors import the same internal roster
     without creating duplicate records when their changes meet in the cloud. */
  let hash = 2166136261;
  for (const char of employeeNameKey(name)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `employee-${(hash >>> 0).toString(36)}`;
}

function employeeEntryByName(value) {
  const wanted = employeeNameKey(value);
  return Object.entries(state.employees || {}).find(([, record]) =>
    employeeRecordNames(record).some((name) => employeeNameKey(name) === wanted));
}

function uniqueEmployeeId(preferred, name) {
  let id = preferred || employeeIdForName(name);
  let suffix = 2;
  while (state.employees?.[id]) id = `${employeeIdForName(name)}-${suffix++}`;
  return id;
}

function employeeComparable(record) {
  if (!record) return '';
  const fields = { ...record };
  delete fields.at;
  delete fields.by;
  delete fields.rev;
  return JSON.stringify(fields);
}

/** Add or edit one employee. UI edits are marked as manual so a later roster
    refresh cannot silently undo a corrected name, department, shift or role. */
export function upsertEmployee(fields = {}) {
  const name = cleanEmployeeName(fields.name);
  if (!name) throw new Error('Enter the employee name.');

  const suppliedId = String(fields.id || '');
  const direct = suppliedId && !suppliedId.startsWith('legacy:')
    ? state.employees?.[suppliedId] : null;
  const matched = direct ? [suppliedId, direct] : employeeEntryByName(fields.originalName || name);
  const existingId = matched?.[0] || null;
  const existing = matched?.[1] || null;
  const duplicate = employeeEntryByName(name);
  const visibleDuplicate = employeeDirectory().find((record) =>
    employeeNameKey(record.name) === employeeNameKey(name)
    && record.id !== existingId && record.id !== suppliedId);
  if ((duplicate && duplicate[0] !== existingId) || visibleDuplicate) {
    throw new Error(`${cleanEmployeeName(duplicate?.[1]?.name || visibleDuplicate.name)} is already in the directory.`);
  }

  const previousName = cleanEmployeeName(existing?.name || fields.originalName);
  const aliases = new Map();
  for (const alias of [...(existing?.aliases || []), ...(fields.aliases || []), previousName]) {
    const clean = cleanEmployeeName(alias);
    if (clean && employeeNameKey(clean) !== employeeNameKey(name)) aliases.set(employeeNameKey(clean), clean);
  }
  const role = employeeRole(fields.role);
  const active = fields.active !== false;
  const appAccess = active && role !== 'EMPLOYEE' && !!fields.appAccess;
  const id = existingId || uniqueEmployeeId(
    suppliedId && !suppliedId.startsWith('legacy:') ? suppliedId : null, previousName || name);
  const record = changedEmployee({
    ...(existing || {}),
    id,
    name,
    department: cleanEmployeeName(fields.department),
    shift: employeeShift(fields.shift),
    role,
    active,
    appAccess,
    archived: false,
    aliases: [...aliases.values()],
    source: existing?.source || fields.source || 'manual',
    manualFields: ['name', 'department', 'shift', 'role', 'active', 'appAccess'],
  });

  state.employees = { ...(state.employees || {}), [id]: record };
  state.people ||= [];
  if (!state.people.some((person) => employeeNameKey(person) === employeeNameKey(name))) {
    state.people.push(name);
  }
  if (state.settings.me && [previousName, ...(existing?.aliases || [])]
      .some((person) => employeeNameKey(person) === employeeNameKey(state.settings.me))) {
    state.settings.me = employeeCanUseApp(record) ? name : null;
  }
  save();
  return record;
}

/** Import the deliberately narrow operational subset returned by the roster
    reader. New roster employees never receive tracker access automatically. */
export function importEmployees(rows = []) {
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let peopleChanged = false;

  for (const source of rows) {
    const sourceName = cleanEmployeeName(source?.name);
    if (!sourceName) continue;
    const matched = employeeEntryByName(sourceName);
    const id = matched?.[0] || uniqueEmployeeId(null, sourceName);
    const existing = matched?.[1] || null;
    const manual = new Set(existing?.manualFields || []);
    const name = manual.has('name') ? cleanEmployeeName(existing.name) : sourceName;
    const aliases = new Map();
    for (const alias of [...(existing?.aliases || []), sourceName]) {
      const clean = cleanEmployeeName(alias);
      if (clean && employeeNameKey(clean) !== employeeNameKey(name)) aliases.set(employeeNameKey(clean), clean);
    }
    const role = existing?.role ? employeeRole(existing.role) : 'EMPLOYEE';
    const active = manual.has('active') ? existing.active !== false : source.active !== false;
    const draft = {
      ...(existing || {}),
      id,
      name,
      department: manual.has('department')
        ? cleanEmployeeName(existing.department) : cleanEmployeeName(source.department),
      shift: manual.has('shift') ? employeeShift(existing.shift) : employeeShift(source.shift),
      role,
      active,
      appAccess: active && role !== 'EMPLOYEE' && !!existing?.appAccess,
      archived: existing?.archived === true,
      aliases: [...aliases.values()],
      source: 'abhay-roster',
      manualFields: existing?.manualFields || [],
    };
    if (existing && employeeComparable(existing) === employeeComparable(draft)) {
      unchanged++;
    } else {
      state.employees = { ...(state.employees || {}), [id]: changedEmployee(draft) };
      existing ? updated++ : added++;
    }
    state.people ||= [];
    if (!state.people.some((person) => employeeNameKey(person) === employeeNameKey(name))) {
      state.people.push(name);
      peopleChanged = true;
    }
  }

  if (added || updated || peopleChanged) save();
  return { added, updated, unchanged, total: added + updated + unchanged };
}

export function archiveEmployee(recordOrId) {
  const candidate = typeof recordOrId === 'object' ? recordOrId : null;
  const suppliedId = String(candidate?.id || recordOrId || '');
  const existing = suppliedId && !suppliedId.startsWith('legacy:')
    ? state.employees?.[suppliedId] : null;
  const name = cleanEmployeeName(existing?.name || candidate?.name);
  if (!name) return false;
  const id = existing ? suppliedId : uniqueEmployeeId(null, name);
  const record = changedEmployee({
    ...(existing || {}), id, name,
    department: cleanEmployeeName(existing?.department || candidate?.department),
    shift: employeeShift(existing?.shift || candidate?.shift),
    role: employeeRole(existing?.role || candidate?.role),
    active: false,
    appAccess: false,
    archived: true,
    aliases: [...new Set([...(existing?.aliases || []), ...(candidate?.aliases || [])]
      .map(cleanEmployeeName).filter(Boolean))],
    source: existing?.source || 'manual',
    manualFields: ['name', 'department', 'shift', 'role', 'active', 'appAccess'],
  });
  state.employees = { ...(state.employees || {}), [id]: record };
  if (employeeNameKey(state.settings.me) === employeeNameKey(name)) state.settings.me = null;
  save();
  return true;
}
