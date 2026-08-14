/* Domain rules that must hold even when the real workbooks are unavailable.
   Run: node test/importer-rules-check.mjs */

import {
  isWorkOrder, PARSER_VERSION, SHIFT_UPDATE_SHEET,
} from '../js/import-machines.js';

const accepted = [
  32127,
  'MU2026-012',
  'DAN 509',
  '29038so',
  'PARCEL29-SWD',
  'TRIMS',
  'PREP',
];

const rejected = [
  null,
  '',
  '   ',
  'WO#',
  'W/O #',
  'Work Order',
  'TOTAL',
  'Service Orders',
  '---',
  new Date('2026-07-03T00:00:00Z'),
  { error: '#N/A' },
];

for (const value of accepted) {
  if (!isWorkOrder(value)) throw new Error(`rejected legitimate work order: ${String(value)}`);
}
for (const value of rejected) {
  if (isWorkOrder(value)) throw new Error(`accepted non-work-order row: ${String(value)}`);
}

if (SHIFT_UPDATE_SHEET !== 'Shift Update') {
  throw new Error(`shift update source changed to ${SHIFT_UPDATE_SHEET}`);
}
if (PARSER_VERSION < 5) {
  throw new Error('the importer change will not prompt existing devices to re-import');
}

console.log('Importer rules: OK');
