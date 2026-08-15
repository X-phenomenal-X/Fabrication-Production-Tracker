/* Search over the individual extrusion masters.

   This is deliberately separate from dies.js: a rolled S/SA die is a
   sub-assembly made from several individual extrusions, while this library is
   the source profile card for one 20-/80-/89- part. */

import { EXTRUSIONS } from './extrusion-records.js';

const compact = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function extrusionForm(value) {
  const raw = String(value || '').trim().toUpperCase();
  const m = raw.match(/^(\d{2})[.\-_]?(\d{2,3})([A-Z]\d?)?$/);
  if (!m) return { raw, id: raw, compact: compact(raw) };
  return {
    raw,
    id: `${m[1]}-${m[2]}${m[3] ? `-${m[3]}` : ''}`,
    compact: `${m[1]}${m[2]}${m[3] || ''}`,
  };
}

export function lookupExtrusions(value) {
  const form = extrusionForm(value);
  return EXTRUSIONS.filter((record) => compact(record.id) === form.compact);
}

export function searchExtrusions(value, { limit = 80 } = {}) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return [];
  const seriesMatch = raw.match(/^SERIES:(2000|8\d{3})$/);
  const form = extrusionForm(raw);
  const loose = form.compact;
  const scored = [];

  for (const record of EXTRUSIONS) {
    const id = compact(record.id);
    const haystack = `${record.id} ${record.description} ${record.supplier} `
      + `${record.proposed} ${record.finalDie} ${record.status} ${record.series}`.toUpperCase();
    let score = 0;
    if (seriesMatch && record.series === seriesMatch[1]) score = 95;
    else if (loose && id === loose) score = 120;
    else if (loose && id.startsWith(loose)) score = 90;
    else if (loose && id.includes(loose)) score = 70;
    else if (haystack.includes(raw)) score = 50;
    if (score) scored.push({ record, score });
  }

  scored.sort((a, b) => (b.score - a.score)
    || a.record.series.localeCompare(b.record.series)
    || a.record.id.localeCompare(b.record.id, undefined, { numeric: true })
    || a.record.page - b.record.page);
  return scored.slice(0, limit).map((item) => item.record);
}

export function extrusionCount() {
  return EXTRUSIONS.length;
}

export function extrusionSeriesCounts() {
  const counts = new Map();
  for (const record of EXTRUSIONS) counts.set(record.series, (counts.get(record.series) || 0) + 1);
  return counts;
}

export { EXTRUSIONS };
