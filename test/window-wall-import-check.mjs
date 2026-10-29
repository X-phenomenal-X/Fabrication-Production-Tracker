/* Separate Window Wall import regression: awkward headers, collisions, legacy blanks. */
import '../scripts/node-dom.mjs';
import assert from 'node:assert/strict';
import { importDailySchedule } from '../js/import-daily.js';
import { makeWorkbook } from './workbook-fixture.mjs';
import { WINDOW_WALL_FIELDS, windowWallSheet } from '../js/supervisor-board.js';

const heads = {
  1: 'W/O #', 2: 'JOB CODE', 3: 'PROJECT', 4: 'FLOOR', 5: 'QTY',
  6: 'Assembly', 7: 'V e n t', 8: 'De-frames', 9: 'SHIP DATE',
  10: 'CUTTING DATE', 11: 'Ware. house', 12: 'CUT STATUS',
  13: 'H T S', 14: 'Width', 15: 'PUNCH', 16: 'V.T.M.L',
  17: 'S-F-S', 18: 'LVRS / TC PANEL', 19: 'Frame Width',
  20: 'Other Cutting', 21: 'CUT',
};
const values = {
  1: 'WW-1', 2: 'J-1', 3: 'Test Tower', 4: '4', 5: 8,
  6: 'A', 7: 'V', 8: 'D', 9: '2026-10-30', 10: '2026-10-29',
  11: 'W', 12: 'READY', 13: 'H', 14: 'WD', 15: 'P',
  16: 'VT', 17: 'SF', 18: 'LV', 19: 'NOT WIDTHS', 20: 'IGNORE', 21: 'IGNORE CUT',
};
const sheet = [heads, { 1: 'Fixture' }, { 1: '-' }, { 1: '-' }, { 1: '-' }, { 1: '-' }, { 1: 'WINDOW WALL' }, values];
// The parser deliberately skips rows with five or fewer populated cells.
const parsed = await importDailySchedule(makeWorkbook({ 'Daily Sched': sheet }));
assert.equal(parsed.rows.length, 1);
const row = parsed.rows[0];
for (const [key, expected] of Object.entries({
  assembly:'A', vents:'V', deframes:'D', warehouse:'W', hts:'H',
  widths:'WD', punch:'P', vtml:'VT', sfs:'SF', lvrsTcPan:'LV',
})) assert.equal(row[key], expected, key);
assert.equal(row.cutStatus, 'READY');
assert.equal(row.cuttingDate, '2026-10-29');
assert.equal(row.shipDate, '2026-10-30');
assert.equal(parsed.report.columns.widths, 14);
assert.equal(parsed.report.columns.cutStatus, 12);
const legacy = { wo:'WW-OLD', jobCode:'J-OLD', project:'Old', floor:'1', qty:2,
  section:'WINDOW WALL', shipDate:'2026-10-30' };
const groups = windowWallSheet([{ ...row, section:'WINDOW WALL' }, legacy]);
assert.equal(groups.length, 1);
assert.equal(groups[0].qty, 10);
for (const [key] of WINDOW_WALL_FIELDS) {
  if (['wo','jobCode','project','floor','qty','shipDate'].includes(key)) continue;
  assert.equal(legacy[key] ?? '', '', 'old-order print must stay blank: '+key);
}
assert.equal(WINDOW_WALL_FIELDS.length, 18);
console.log('Window Wall odd headers, collision avoidance, and legacy blanks: OK');
