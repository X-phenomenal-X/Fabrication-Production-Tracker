/* Looking a die up in the Sub-Assembly Section Book.

   A die on the schedule is a *rolled* die — a sub-assembly. It is not one
   extrusion but four: an exterior, an interior, and a thermal break top and
   bottom, combined in the sub-assembly room and then rolled. S80.106 is
   80-113 outside, 84-901 upper and lower, 80-105 inside.

   The schedule and the book write the same number differently, which is the
   only real work here:

     schedule   S80.106     S80.143HT    85.228
     book       SA80-106    SA80-143HT   85-228

   So an `S` prefix means "sub-assembly" and a bare number means a component
   extrusion — and either can be asked for, so both are tried. */

import { SUBASSEMBLIES } from './subassemblies.js';

const PARTS = ['exterior', 'upperTB', 'lowerTB', 'interior'];

export const PART_LABEL = {
  exterior: 'Exterior',
  upperTB: 'Upper T-break',
  lowerTB: 'Lower T-break',
  interior: 'Interior',
};

/** Both readings of a die as written on the schedule: as a sub-assembly, and
    as a bare component extrusion. */
export function dieForms(text) {
  const t = String(text || '').trim().toUpperCase().replace(/\s+/g, '');
  const m = t.match(/^(?:SA|S)?(\d{2})[.\-_](\d{3})([A-Z0-9]*)$/);
  if (!m) return { sa: null, part: null, raw: t };
  const [, group, num, suffix] = m;
  return { sa: `SA${group}-${num}${suffix}`, part: `${group}-${num}${suffix}`, raw: t };
}

const bySa = new Map(SUBASSEMBLIES.map((r) => [r.sa, r]));

/* Which sub-assemblies each component goes into. Built once, on first use —
   the reverse direction is the one staging asks: "where does 80-105 end up". */
let usedIndex = null;
function usedBy() {
  if (usedIndex) return usedIndex;
  usedIndex = new Map();
  for (const r of SUBASSEMBLIES) {
    for (const p of PARTS) {
      const die = r[p];
      if (!die) continue;
      if (!usedIndex.has(die)) usedIndex.set(die, []);
      const list = usedIndex.get(die);
      if (!list.some((x) => x.sa === r.sa)) list.push(r);
    }
  }
  return usedIndex;
}

/** Everything the book knows about one die, however it was written. */
export function lookupDie(text) {
  const forms = dieForms(text);
  if (!forms.sa) return { input: String(text || ''), forms, assembly: null, usedIn: [] };

  // A suffixed number can also appear plain — S80.143HT with no HT entry is
  // still worth answering with SA80-143.
  const assembly = bySa.get(forms.sa)
    || bySa.get(forms.sa.replace(/[A-Z]+$/, ''))
    || null;

  const usedIn = usedBy().get(forms.part) || [];
  return { input: String(text || ''), forms, assembly, usedIn };
}

/** Is this die in the book at all — used to decide whether to offer a lookup. */
export function isKnownDie(text) {
  const { assembly, usedIn } = lookupDie(text);
  return !!assembly || usedIn.length > 0;
}

/** Free-text search across numbers, descriptions and components. */
export function searchDies(q, { limit = 60 } = {}) {
  const term = String(q || '').trim().toUpperCase();
  if (!term) return [];

  const forms = dieForms(term);
  const loose = term.replace(/[.\-_\s]/g, '');
  const hay = (r) => `${r.sa} ${r.desc || ''} ${PARTS.map((p) => r[p] || '').join(' ')}`.toUpperCase();

  const scored = [];
  for (const r of SUBASSEMBLIES) {
    let score = 0;
    if (forms.sa && r.sa === forms.sa) score = 100;
    else if (forms.part && PARTS.some((p) => r[p] === forms.part)) score = 80;
    else if (r.sa.replace(/[-]/g, '').includes(loose)) score = 60;
    else if (hay(r).includes(term)) score = 40;
    if (score) scored.push({ r, score });
  }

  scored.sort((a, b) => (b.score - a.score) || (a.r.sa < b.r.sa ? -1 : 1));
  return scored.slice(0, limit).map((x) => x.r);
}

/** The component list of a sub-assembly, ready to render. The thermal break is
    one part used twice, so it is said that way rather than listed twice. */
export function componentsOf(assembly) {
  if (!assembly) return [];
  const out = [];
  if (assembly.exterior) out.push({ role: 'Exterior', die: assembly.exterior, qty: 1 });
  if (assembly.upperTB && assembly.upperTB === assembly.lowerTB) {
    out.push({ role: 'Thermal break', die: assembly.upperTB, qty: 2, note: 'top and bottom' });
  } else {
    if (assembly.upperTB) out.push({ role: 'Upper T-break', die: assembly.upperTB, qty: 1 });
    if (assembly.lowerTB) out.push({ role: 'Lower T-break', die: assembly.lowerTB, qty: 1 });
  }
  if (assembly.interior) out.push({ role: 'Interior', die: assembly.interior, qty: 1 });
  return out;
}

export { SUBASSEMBLIES };
