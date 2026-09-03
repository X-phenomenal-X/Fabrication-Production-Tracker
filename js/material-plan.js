/* Identifying the thing that is actually short.

   A shortage on the floor is reported against whatever the schedule says, and
   the schedule says S80.104 — a rolled sub-assembly. Nobody can order S80.104.
   What is short is one of the extrusions inside it: an exterior, an interior,
   or a thermal break, each a separate part with its own number. Getting that
   step wrong is the expensive mistake in this workflow, because the request
   leaves the department looking complete and comes back weeks later wrong.

   So this module does one job: turn what the schedule wrote into the set of
   real extrusions it could mean, each carrying where that answer came from,
   and refuse to answer at all when the listing cannot support one. Everything
   downstream — the picker, the printed sheet, the pasted row — reads from
   here, so there is one place the guardrail can be checked.

   It is deliberately free of DOM and of app state: it is called by the lazy
   Material Helper view and directly by test/material-helper-check.mjs. */

import {
  componentCoverage, dieForms, listingReferencesOf, lookupDie,
  profileReferenceOf, resolvedComponentsOf,
} from './dies.js';

/* The department's own reason codes, as they are written in the shared
   Material Requests workbook. This app does not invent new ones. */
export const REQUEST_REASONS = [
  'PROD - Production',
  'SH - Pulled Short',
  'RM - Remake',
  'SV - Service',
];

/* The columns of the shared workbook, in its order. The clipboard row exists
   to be pasted into that sheet, so it matches the sheet and nothing else; the
   tracker's own context (pieces short, when it is needed, where the number
   came from) travels on the printed sheet and the exported file instead. */
export const WORKBOOK_COLUMNS = [
  'Date', 'Work order', 'Project', 'Floor', 'Extrusion',
  'Stock length', 'Finish', 'Bars', 'Reason',
];

export const EXPORT_COLUMNS = [
  ...WORKBOOK_COLUMNS, 'Pieces short', 'Needed by', 'Requested by',
  'Scheduled as', 'Component role', 'Source', 'Note',
];

const clean = (value) => String(value ?? '').trim();

/** The schedule writes 80.113; the listing writes 80-113. Requests follow the
    schedule, because that is what the floor and the workbook both read. */
export function dottedDie(value) {
  const part = dieForms(value).part;
  return part ? part.replace(/^(\d{2})-(\d{3})/, '$1.$2') : clean(value).toUpperCase();
}

/** Stock length is a number of feet. Operators write 18, 18', 18 ft. */
export function cleanLength(value) {
  return clean(value).replace(/[′'"]/g, '').replace(/\s*(?:FT|FEET)$/i, '').trim();
}

const asksForAssembly = (value) => /^S(?:A)?\s*\d/i.test(clean(value));

/** Human wording for where a component number came from, so an uncertain
    answer is never presented as a certain one. */
export function provenanceLabel(candidate) {
  if (!candidate) return '';
  if (candidate.provenance === 'variant') {
    return `Recovered from ${candidate.provenanceSa} — not printed on this listing row`;
  }
  if (candidate.provenance === 'description') return 'Named in the listing description, not in a component column';
  if (candidate.provenance === 'direct') return 'Entered directly as an extrusion';
  return `Listed on ${candidate.provenanceSa || 'the listing'}`;
}

function candidateFrom(component, index) {
  return {
    key: `${component.die}:${component.role}:${index}`,
    role: component.role,
    die: dottedDie(component.die),
    listingDie: component.die,
    perAssembly: component.qty || 1,
    provenance: component.source || 'listing',
    provenanceSa: component.sourceSa || null,
    verified: component.verified !== false,
  };
}

/* Every reason this can decline to produce an orderable number, with the
   wording the view shows. Blocked kinds carry no candidates at all, so a
   caller cannot accidentally fall through to "order the S-number". */
const BLOCKED = {
  empty: {
    title: 'Enter the die or extrusion from the schedule.',
    detail: 'For example S80.104 as the schedule writes it, or 80.113 for a bare extrusion.',
  },
  unrecognised: {
    title: 'That is not a die or extrusion number.',
    detail: 'Numbers look like 80.113 or 84-901. Check the schedule row, or search Engineering Lookup.',
  },
  'unknown-assembly': {
    title: 'This sub-assembly is not in the Section Book.',
    detail: 'Do not order the S-number. Find its extrusion components in Engineering Lookup first, '
      + 'then enter the extrusion itself here.',
  },
  'assembly-without-components': {
    title: 'The listing row for this sub-assembly names no extrusions.',
    detail: 'Its component columns are blank and nothing could be recovered from a sibling row. '
      + 'Confirm the components against the drawing before anything is ordered.',
  },
};

/** What a schedule die or a typed number could actually mean, in orderable
    terms. Returns either a blocked result with no candidates, or the set of
    extrusions to choose from — never the sub-assembly number itself. */
export function identifyMaterial(text) {
  const input = clean(text);
  const blocked = (kind) => ({
    kind, input, blocked: true, ...BLOCKED[kind],
    assembly: null, coverage: null, candidates: [], references: [],
  });

  if (!input) return blocked('empty');

  const forms = dieForms(input);
  if (!forms.part) return blocked('unrecognised');

  if (asksForAssembly(input)) {
    const { assembly } = lookupDie(input);
    if (!assembly) return blocked('unknown-assembly');

    /* A few Listing rows are not four-part assemblies at all: they point at
       one individual profile. That is a real, verified answer and is offered
       as one, rather than being reported as four missing parts. */
    const profile = profileReferenceOf(assembly);
    const components = profile
      ? [{ ...profile, source: 'description', sourceSa: assembly.sa }]
      : resolvedComponentsOf(assembly);
    if (!components.length) return blocked('assembly-without-components');

    const coverage = componentCoverage(assembly);
    return {
      kind: 'assembly',
      input,
      blocked: false,
      assembly,
      coverage,
      candidates: components.map(candidateFrom),
      /* Numbers the listing text mentions without saying what they are. They
         are shown so the operator knows they exist, and are deliberately not
         offered as choices — assigning them a role the source never stated is
         exactly the guess this module exists to avoid. */
      references: profile ? [] : listingReferencesOf(assembly)
        .map((reference) => ({ die: dottedDie(reference.die), role: reference.role })),
    };
  }

  return {
    kind: 'extrusion',
    input,
    blocked: false,
    assembly: null,
    coverage: null,
    candidates: [candidateFrom({
      die: forms.part, role: 'Extrusion', qty: 1, source: 'direct', verified: true,
    }, 0)],
    references: [],
  };
}

/* ---------- the request draft ---------- */

/* Four different quantities live on one request and they are not
   interchangeable: how many finished pieces the floor is short, how many bars
   that means ordering, how long each bar is, and the date the work needs it
   by. The workbook has a column for each, people say "short six" meaning any
   of the first two, and collapsing them is how a request comes back as six
   18-foot bars for a six-piece shortage. They are separate fields here, and
   separate columns everywhere they are written out. */
const REQUIRED = [
  ['work order', (row) => clean(row.workOrder)],
  ['project', (row) => clean(row.project)],
  ['extrusion', (row) => clean(row.die)],
  ['stock length', (row) => cleanLength(row.stockLength)],
  ['finish', (row) => clean(row.finish)],
  ['bars', (row) => Number(row.bars) > 0],
  ['reason', (row) => clean(row.reason)],
  ['requested by', (row) => clean(row.requestedBy)],
];

/** Which fields the external Material Requests process still needs. */
export function missingRequestFields(row) {
  return REQUIRED.filter(([, present]) => !present(row || {})).map(([label]) => label);
}

export function requestComplete(row) {
  return missingRequestFields(row).length === 0;
}

/** Build a draft from a chosen candidate plus the job and quantity facts. The
    sub-assembly is recorded as context — what the schedule said — and never as
    the thing being asked for. */
export function makeRequestDraft({ job = {}, identified = null, candidate, quantities = {}, request = {} }) {
  if (!candidate) throw new Error('a material request needs an identified extrusion');
  return {
    id: `mh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    preparedAt: new Date().toISOString(),
    sourceTaskKey: job.taskKey || null,
    workOrder: clean(job.workOrder),
    project: clean(job.project),
    floor: clean(job.floor),
    requiredBy: clean(job.requiredBy) || null,
    /* Context, not an order line. */
    scheduledAs: clean(identified?.input) || null,
    sourceAssembly: identified?.assembly?.sa || null,
    die: dottedDie(candidate.die),
    role: candidate.role,
    provenance: candidate.provenance,
    provenanceSa: candidate.provenanceSa || null,
    verified: candidate.verified !== false,
    piecesShort: quantities.piecesShort === '' || quantities.piecesShort == null
      ? null : Number(quantities.piecesShort),
    bars: quantities.bars === '' || quantities.bars == null ? null : Number(quantities.bars),
    stockLength: cleanLength(quantities.stockLength),
    finish: clean(quantities.finish).toUpperCase(),
    reason: clean(request.reason),
    requestedBy: clean(request.requestedBy),
    note: clean(request.note),
  };
}

/* ---------- what leaves the app ---------- */

function excelDate(iso) {
  if (!iso) return '';
  const [year, month, day] = String(iso).split('-').map(Number);
  return year && month && day ? `${month}/${day}/${year}` : String(iso);
}

const cell = (value) => clean(value).replace(/[\t\r\n]+/g, ' ');

export function workbookRow(row) {
  return [
    excelDate(String(row.preparedAt || '').slice(0, 10)),
    row.workOrder, row.project, row.floor, row.die,
    row.stockLength, row.finish, row.bars ?? '', row.reason,
  ].map(cell);
}

/** Tab-separated, for pasting straight into the shared workbook at its Date
    column. Nothing is sent anywhere: the clipboard is the transport. */
export function workbookTsv(rows) {
  return rows.map((row) => workbookRow(row).join('\t')).join('\n');
}

export function exportRow(row) {
  return [
    ...workbookRow(row),
    row.piecesShort ?? '', row.requiredBy || '', row.requestedBy,
    row.scheduledAs || '', row.role || '', provenanceLabel(row), row.note,
  ].map(cell);
}

const csvCell = (value) => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));

/** A full record of what was prepared, including where each number came from.
    This is the copy somebody keeps, not the copy that goes in the workbook. */
export function requestCsv(rows) {
  return [EXPORT_COLUMNS, ...rows.map(exportRow)]
    .map((line) => line.map(csvCell).join(','))
    .join('\r\n');
}
