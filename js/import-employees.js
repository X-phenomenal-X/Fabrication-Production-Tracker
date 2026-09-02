/* Narrow employee roster import for Abhay's active direct crew.

   The public app never ships a real roster. A supervisor loads the internal
   workbook from the Employees page; only display names are returned. Position
   IDs, departments, shirt sizes and all source rows are discarded. */

import { readXlsx } from './xlsx.js';

export const EMPLOYEE_ROSTER_PARSER_VERSION = 1;
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
  const wanted = {
    status: 'STATUS',
    name: 'NAME',
    supervisor: 'SUPERVISOR LEGAL NAME',
  };
  const found = {};
  for (const [field, heading] of Object.entries(wanted)) {
    const index = headings.findIndex((value) => key(value) === heading);
    if (index >= 0) found[field] = index;
  }
  const missing = Object.keys(wanted).filter((field) => found[field] == null);
  if (missing.length) throw new Error(`${CREW_SHEET} is missing ${missing.join(', ')} column${missing.length === 1 ? '' : 's'}.`);
  return found;
}

export async function importEmployeeRoster(arrayBuffer, { fileName = 'Employee listing.xlsx' } = {}) {
  const workbook = await readXlsx(arrayBuffer, { only: [CREW_SHEET], maxRows: 2000 });
  const sheet = workbook.sheets[CREW_SHEET];
  if (!sheet) {
    throw new Error(`This workbook has no "${CREW_SHEET}" sheet. Sheets found: ${workbook.sheetNames.join(', ')}`);
  }

  const cols = columns(sheet);
  const names = new Map();
  let inactive = 0;
  let otherSupervisor = 0;

  for (const row of sheet.rows) {
    if (row.r <= 1 || row.empty) continue;
    if (key(row.cells[cols.status]) !== 'ACTIVE') { inactive++; continue; }
    if (key(row.cells[cols.supervisor]) !== key(CREW_SUPERVISOR)) { otherSupervisor++; continue; }
    const name = employeeDisplayName(row.cells[cols.name]);
    if (name) names.set(name.toLocaleLowerCase(), name);
  }

  const people = [...names.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  if (!people.length) throw new Error(`No active employees supervised by ${CREW_SUPERVISOR} were found.`);

  return {
    people,
    report: {
      fileName,
      importedAt: new Date().toISOString(),
      parser: EMPLOYEE_ROSTER_PARSER_VERSION,
      supervisor: CREW_SUPERVISOR,
      count: people.length,
      inactive,
      otherSupervisor,
    },
  };
}
