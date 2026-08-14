/* Sync rules that do not need a browser or the real schedules.
   Run: node test/store-rules-check.mjs */

import { mergeRecords } from '../js/store.js';

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
