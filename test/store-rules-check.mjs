/* Sync rules that do not need a browser or the real schedules.
   Run: node test/store-rules-check.mjs */

import { mergeRecords } from '../js/store.js';
import { shiftWindow, today } from '../js/model.js';
import { SHIFT_ORDER, breakRanges, shiftAt, shiftStatusAt } from '../js/shifts.js';
import { HINGES_PER_8560_VENT, hingeRequirement, is8560VentTask } from '../js/material-rules.js';

const localTime = (hour, minute = 0) => new Date(2026, 7, 28, hour, minute, 0, 0);

// The department currently runs exactly two shifts, with a half-hour handoff.
if (SHIFT_ORDER.join(',') !== 'DAY,AFT') throw new Error('an inactive shift is still selectable');
if (shiftAt(localTime(7)) !== 'DAY' || shiftAt(localTime(15, 29)) !== 'DAY') {
  throw new Error('Day shift is not 07:00–15:30');
}
if (shiftAt(localTime(15, 30)) !== 'AFT' || shiftAt(localTime(23, 59)) !== 'AFT') {
  throw new Error('Afternoon shift is not 15:30–00:00');
}
if (shiftAt(localTime(0)) !== null || shiftAt(localTime(6, 59)) !== null) {
  throw new Error('the app claims a production shift is active overnight');
}
if (today(localTime(23, 59)) !== '2026-08-28') {
  throw new Error('the Afternoon shift date changed early because UTC reached tomorrow');
}

const dayBreaks = breakRanges('DAY').join(',');
const aftBreaks = breakRanges('AFT').join(',');
if (dayBreaks !== '09:15–09:30,12:30–13:00,14:15–14:30'
    || aftBreaks !== '18:00–18:15,20:00–20:30,23:00–23:15') {
  throw new Error('the production break schedule is wrong');
}
if (!shiftStatusAt(localTime(9, 15)).onBreak || shiftStatusAt(localTime(9, 30)).onBreak) {
  throw new Error('a Day break does not start and stop at the stated minute');
}

// 8560 is a literal schedule signal, not another name for any pin-hole row.
const hingeTask = { machine: 'fom2', pinHole: '8560 HT', qty: 17 };
const hinge = hingeRequirement(hingeTask);
if (HINGES_PER_8560_VENT !== 1 || hinge?.vents !== 17 || hinge?.hinges !== 17) {
  throw new Error('the one-hinge-per-8560-vent rule is wrong');
}
if (is8560VentTask({ machine: 'fom2', pinHole: 'P:Y', qty: 17 })
    || is8560VentTask({ machine: 'fom2', pinHole: '8550', qty: 17 })
    || is8560VentTask({ machine: 'fom1', pinHole: '8560', qty: 17 })) {
  throw new Error('a non-8560 FOM 2 row created a hinge requirement');
}
if (hingeRequirement({ machine: 'fom2', pinHole: '8560', qty: '' })?.hinges !== null) {
  throw new Error('a missing vent count was silently treated as zero hinges');
}

const [dayFrom, dayTo] = shiftWindow('2026-08-28', 'DAY').map((v) => new Date(v));
const [aftFrom, aftTo] = shiftWindow('2026-08-28', 'AFTERNOON').map((v) => new Date(v));
if (dayFrom.getHours() !== 7 || dayFrom.getMinutes() !== 0
    || dayTo.getHours() !== 15 || dayTo.getMinutes() !== 30
    || aftFrom.getHours() !== 15 || aftFrom.getMinutes() !== 30
    || aftTo.getDate() !== 29 || aftTo.getHours() !== 0 || aftTo.getMinutes() !== 0) {
  throw new Error('shift history windows do not match the two-shift schedule');
}

// Device B's wall clock is years behind, but it observed A's revision before
// editing. The logical revision, not the displayed timestamp, must win.
const skewed = mergeRecords(
  { line: { status: 'OLD', at: '2099-01-01T00:00:00.000Z', rev: '8@device-a' } },
  { line: { status: 'NEW', at: '2026-08-14T12:00:00.000Z', rev: '9@device-b' } },
);
if (skewed.line.status !== 'NEW') throw new Error('device clock skew decided a merge');

// Concurrent edits based on the same revision converge deterministically,
// whichever device performs the merge.
const a = { line: { status: 'A', at: '2026-08-14T12:00:00.000Z', rev: '10@device-a' } };
const b = { line: { status: 'B', at: '2026-08-14T12:00:00.000Z', rev: '10@device-b' } };
const ab = mergeRecords(a, b);
const ba = mergeRecords(b, a);
if (JSON.stringify(ab) !== JSON.stringify(ba)) throw new Error('concurrent edits did not converge');

// A revision-aware record must not be resurrected by an old cached build that
// still sends timestamp-only records.
const migrated = mergeRecords(
  { line: { status: 'CURRENT', at: '2026-08-14T12:00:00.000Z', rev: '11@device-a' } },
  { line: { status: 'STALE', at: '2099-01-01T00:00:00.000Z' } },
);
if (migrated.line.status !== 'CURRENT') throw new Error('a legacy record beat a revisioned record');

console.log('Store rules: OK');
