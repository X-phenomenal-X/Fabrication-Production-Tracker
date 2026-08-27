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
const RECOVERABLE_PARTS = ['exterior', 'interior'];

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

/* The Listings are uneven. A few HT / HTX pages carry the aluminium profile
   numbers while their matching standard page leaves the same cell blank (and
   sometimes the reverse). Exterior and interior shapes are shared by those
   variants; the thermal breaks are deliberately *not* recovered because the
   material changes between standard, HT and HTX assemblies.

   A recovered number is never presented as if it came from the current row.
   The UI names the sibling it came from, keeping the engineering provenance
   visible and letting an operator distinguish book data from a safe cross-
   reference. */
const variantStem = (sa) => String(sa || '').replace(/(?:HTX|HT)$/, '');
const byVariant = new Map();
for (const row of SUBASSEMBLIES) {
  const stem = variantStem(row.sa);
  if (!byVariant.has(stem)) byVariant.set(stem, []);
  byVariant.get(stem).push(row);
}

export function recoveredComponentsOf(assembly) {
  if (!assembly) return [];
  const siblings = (byVariant.get(variantStem(assembly.sa)) || [])
    .filter((row) => row !== assembly);
  const recovered = [];

  for (const part of RECOVERABLE_PARTS) {
    if (assembly[part]) continue;
    const values = [...new Set(siblings.map((row) => row[part]).filter(Boolean))];
    if (values.length !== 1) continue;
    const source = siblings.find((row) => row[part] === values[0]);
    recovered.push({
      role: PART_LABEL[part], die: values[0], qty: 1,
      source: 'variant', sourceSa: source.sa, verified: false,
    });
  }
  return recovered;
}

/* Some older Listing rows put a component number in the description instead
   of in one of the four component columns. Those references used to disappear
   from the lookup entirely. Keep them as references rather than assigning an
   exterior/interior role the source never stated. */
export function listingReferencesOf(assembly) {
  if (!assembly?.desc) return [];
  const assigned = new Set([
    ...PARTS.map((part) => assembly[part]).filter(Boolean),
    ...recoveredComponentsOf(assembly).map((part) => part.die),
  ]);
  const refs = assembly.desc.match(/\b\d{2}-\d{3}[A-Z]*\b/g) || [];
  return [...new Set(refs)]
    .filter((die) => !assigned.has(die))
    .map((die) => ({ role: 'Listing reference', die, qty: 1, source: 'description', verified: false }));
}

/* Which sub-assemblies each component goes into. Built once, on first use —
   the reverse direction is the one staging asks: "where does 80-105 end up". */
let usageIndex = null;
let usedIndex = null;
function indexedUsage() {
  if (usageIndex) return usageIndex;
  usageIndex = new Map();
  const add = (die, usage) => {
    if (!die) return;
    if (!usageIndex.has(die)) usageIndex.set(die, []);
    const list = usageIndex.get(die);
    const token = `${usage.assembly.sa}|${usage.source}|${usage.role}|${usage.sourceSa || ''}`;
    if (!list.some((item) => item.token === token)) list.push({ ...usage, token });
  };

  for (const assembly of SUBASSEMBLIES) {
    for (const component of componentsOf(assembly)) {
      add(component.die, {
        assembly, role: component.role, qty: component.qty,
        source: 'listing', sourceSa: assembly.sa,
      });
    }
    for (const component of recoveredComponentsOf(assembly)) {
      add(component.die, {
        assembly, role: component.role, qty: component.qty,
        source: component.source, sourceSa: component.sourceSa,
      });
    }
    for (const reference of listingReferencesOf(assembly)) {
      add(reference.die, {
        assembly, role: reference.role, qty: 1,
        source: reference.source, sourceSa: assembly.sa,
      });
    }
  }
  return usageIndex;
}

function usedBy() {
  if (usedIndex) return usedIndex;
  const rows = new Map();
  for (const [die, usages] of indexedUsage()) {
    rows.set(die, [...new Map(usages.map((usage) =>
      [usage.assembly.sa, usage.assembly])).values()]);
  }
  usedIndex = rows;
  return usedIndex;
}

/** Provenance-aware reverse usage for an extrusion profile. */
export function componentUsageOf(text) {
  const forms = dieForms(text);
  if (!forms.part) return [];
  return (indexedUsage().get(forms.part) || []).map(({ token, ...usage }) => usage);
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
  const asksForAssembly = /^S(?:A)?\s*\d/i.test(term);
  const loose = term.replace(/[.\-_\s]/g, '');
  const hay = (r) => `${r.sa} ${r.desc || ''} ${PARTS.map((p) => r[p] || '').join(' ')}`.toUpperCase();

  const scored = [];
  for (const r of SUBASSEMBLIES) {
    let score = 0;
    if (forms.sa && r.sa === forms.sa) score = 100;
    else if (!asksForAssembly && forms.part && PARTS.some((p) => r[p] === forms.part)) score = 80;
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

/** Verified Listing columns plus conservative, provenance-labelled recovery. */
export function resolvedComponentsOf(assembly) {
  return [
    ...componentsOf(assembly).map((component) => ({
      ...component, source: 'listing', sourceSa: assembly?.sa || null, verified: true,
    })),
    ...recoveredComponentsOf(assembly),
  ];
}

/** Coverage facts used by the unified lookup and the data-quality audit. */
export function componentCoverage(assembly) {
  if (!assembly) return {
    verified: 0, recovered: 0, references: 0, missingRoles: [...PARTS], complete: false,
  };
  const verified = PARTS.filter((part) => assembly[part]).length;
  const recovered = recoveredComponentsOf(assembly);
  const recoveredRoles = new Set(recovered.map((part) => part.role));
  const missingRoles = PARTS
    .filter((part) => !assembly[part] && !recoveredRoles.has(PART_LABEL[part]));
  const references = listingReferencesOf(assembly).length;
  return {
    verified, recovered: recovered.length, references, missingRoles,
    complete: missingRoles.length === 0,
  };
}

export function componentAudit() {
  const audit = {
    assemblies: SUBASSEMBLIES.length,
    complete: 0,
    incomplete: 0,
    recoveredRows: 0,
    recoveredFields: 0,
    listingReferenceRows: 0,
    listingReferences: 0,
  };
  for (const assembly of SUBASSEMBLIES) {
    const coverage = componentCoverage(assembly);
    if (coverage.complete) audit.complete += 1;
    else audit.incomplete += 1;
    if (coverage.recovered) {
      audit.recoveredRows += 1;
      audit.recoveredFields += coverage.recovered;
    }
    if (coverage.references) {
      audit.listingReferenceRows += 1;
      audit.listingReferences += coverage.references;
    }
  }
  return audit;
}

export { SUBASSEMBLIES };
