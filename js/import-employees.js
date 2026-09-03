/* Narrow employee roster import for Abhay's active direct crew.

   The public app never ships a real roster. A supervisor loads the internal
   workbook from the Employees page; only the operational directory fields —
   display name, department and shift — are returned. Position IDs, clothing
   sizes and all source rows are discarded. */

import { readXlsx } from './xlsx.js';

export const EMPLOYEE_ROSTER_PARSER_VERSION = 2;
export const CREW_SHEET = 'Abhay';
export const CREW_SUPERVISOR = 'Badhwar, Abhay';

function text(value) {
  if (value == null || value instanceof Date || typeof value === 'object') return '';
  return String(value).trim().replace(/\s+/g, ' ');
}

function key(value) {
  return text(value).replace(/\s*\([^)]*\)\s*$/, '').toUpperCase();
}

export function employeeDisplayName(value) {
  const source = text(value);
  if (!source.includes(',')) return source;
  const [family, ...given] = source.split(',').map((part) => part.trim()).filter(Boolean);
  return given.length ? `${given.join(' ')} ${family}` : family;
}

function columns(sheet) {
  const headings = sheet.rows.find((row) => row.r === 1)?.cells || [];
  const required = {
    status: 'STATUS',
    name: 'NAME',
    supervisor: 'SUPERVISOR LEGAL NAME',
  };
  const optional = {
    department: 'DEPT NAME',
    shift: 'SHIFT',
  };
  const found = {};
  for (const [field, heading] of Object.entries({ ...required, ...optional })) {
    const index = headings.findIndex((value) => key(value) === heading);
    if (index >= 0) found[field] = index;
  }
  const missing = Object.keys(required).filter((field) => found[field] == null);
  if (missing.length) throw new Error(`${CREW_SHEET} is missing ${missing.join(', ')} column${missing.length === 1 ? '' : 's'}.`);
  return found;
}

function shift(value) {
  const valueKey = key(value);
  if (valueKey === 'AFT' || valueKey.includes('AFTERNOON')) return 'AFTERNOON';
  if (valueKey.includes('DAY')) return 'DAY';
  return '';
}

export async function importEmployeeRoster(arrayBuffer, { fileName = 'Employee listing.xlsx' } = {}) {
  const workbook = await readXlsx(arrayBuffer, { only: [CREW_SHEET], maxRows: 2000 });
  const sheet = workbook.sheets[CREW_SHEET];
  if (!sheet) {
    throw new Error(`This workbook has no "${CREW_SHEET}" sheet. Sheets found: ${workbook.sheetNames.join(', ')}`);
  }

  const cols = columns(sheet);
  const records = new Map();
  let inactive = 0;
  let otherSupervisor = 0;

  for (const row of sheet.rows) {
    if (row.r <= 1 || row.empty) continue;
    if (key(row.cells[cols.status]) !== 'ACTIVE') { inactive++; continue; }
    if (key(row.cells[cols.supervisor]) !== key(CREW_SUPERVISOR)) { otherSupervisor++; continue; }
    const name = employeeDisplayName(row.cells[cols.name]);
    if (name) records.set(name.toLocaleLowerCase(), {
      name,
      department: cols.department == null ? '' : text(row.cells[cols.department]),
      shift: cols.shift == null ? '' : shift(row.cells[cols.shift]),
      role: 'EMPLOYEE',
      active: true,
      appAccess: false,
    });
  }

  const employees = [...records.values()]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  if (!employees.length) throw new Error(`No active employees supervised by ${CREW_SUPERVISOR} were found.`);

  return {
    employees,
    // Kept for older callers while the structured employee directory rolls
    // out. New code consumes `employees` above.
    people: employees.map((employee) => employee.name),
    report: {
      fileName,
      importedAt: new Date().toISOString(),
      parser: EMPLOYEE_ROSTER_PARSER_VERSION,
      supervisor: CREW_SUPERVISOR,
      count: employees.length,
      inactive,
      otherSupervisor,
    },
  };
}
