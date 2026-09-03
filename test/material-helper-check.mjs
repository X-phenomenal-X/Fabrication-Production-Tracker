/* The Material Helper's guardrails, measured against the whole Section Book.
   Run: node test/material-helper-check.mjs

   The expensive failure in this workflow is quiet: a request leaves the
   department naming a sub-assembly nobody can order, or naming a component the
   listing never actually stated, and comes back weeks later wrong. Neither
   looks like a bug on screen. So the rules are asserted over all 997 listing
   rows rather than over a handful of examples:

     - an S/SA number never becomes an orderable line;
     - every number offered traces to a component column, a sibling row, or a
       reference the listing itself labelled — and says which;
     - a row that cannot support an answer produces no candidates at all;
     - the four quantities stay four columns from the form to the clipboard.

   No browser and no app state: this is the module the view calls. */

import { SUBASSEMBLIES } from '../js/subassemblies.js';
import { PART_LABEL, recoveredComponentsOf } from '../js/dies.js';
import {
  EXPORT_COLUMNS, REQUEST_REASONS, WORKBOOK_COLUMNS, cleanLength, dottedDie,
  identifyMaterial, makeRequestDraft, missingRequestFields, provenanceLabel,
  requestComplete, requestCsv, workbookRow, workbookTsv,
} from '../js/material-plan.js';

const errors = [];
const note = (m) => console.log('  • ' + m);
const fail = (m) => { errors.push(m); console.log('  ✗ ' + m); };

/* ---------- refusing to answer ---------- */

const BLOCKED_CASES = [
  ['', 'empty'],
  ['   ', 'empty'],
  ['not a die', 'unrecognised'],
  ['80', 'unrecognised'],
  ['S99.999', 'unknown-assembly'],
  ['SA99-999', 'unknown-assembly'],
];
for (const [input, kind] of BLOCKED_CASES) {
  const result = identifyMaterial(input);
  if (result.kind !== kind) fail(`"${input}" resolved as ${result.kind}, expected ${kind}`);
  if (!result.blocked) fail(`"${input}" was not blocked`);
  if (result.candidates.length) {
    fail(`"${input}" offered ${result.candidates.length} orderable candidate(s) while blocked`);
  }
  if (!result.title || !result.detail) fail(`"${input}" was blocked without saying why`);
}
note(`${BLOCKED_CASES.length} unresolvable inputs blocked with no candidates and a stated reason`);

/* ---------- the whole listing ---------- */

const partColumns = ['exterior', 'upperTB', 'lowerTB', 'interior'];
const roles = new Set([...Object.values(PART_LABEL), 'Thermal break', 'Previous section',
  'Listing reference', 'Extrusion']);

let assemblies = 0;
let withoutComponents = 0;
let recoveredRows = 0;
let descriptionRows = 0;
let sameNumberComponents = 0;

for (const row of SUBASSEMBLIES) {
  const result = identifyMaterial(row.sa);
  if (result.blocked) {
    if (result.kind !== 'assembly-without-components') {
      fail(`${row.sa} is in the book but resolved as ${result.kind}`);
    }
    withoutComponents += 1;
    continue;
  }
  assemblies += 1;

  if (result.assembly?.sa !== row.sa) fail(`${row.sa} resolved to ${result.assembly?.sa}`);
  if (!result.candidates.length) fail(`${row.sa} produced an unblocked result with no candidates`);

  const recovered = new Set(recoveredComponentsOf(row).map((part) => part.die));
  const columns = new Set(partColumns.map((part) => row[part]).filter(Boolean));
  const described = new Set((row.desc || '')
    .match(/\b\d{2}[.\-_ ]\d{3}[A-Z0-9]*\b/g)?.map((value) => value.replace(/[._ ]/g, '-')) || []);

  for (const candidate of result.candidates) {
    /* The one thing that must never happen: the S/SA number itself offered as
       something to order. Checked on the emitted value, because that is what
       reaches the clipboard. */
    if (/^S/i.test(candidate.die)) {
      fail(`${row.sa} offered "${candidate.die}" — a sub-assembly number, not an extrusion`);
    }
    if (candidate.die !== dottedDie(candidate.listingDie)) {
      fail(`${row.sa} wrote ${candidate.die} for listing number ${candidate.listingDie}`);
    }
    if (!roles.has(candidate.role)) fail(`${row.sa} gave "${candidate.die}" the unknown role ${candidate.role}`);

    /* Provenance is not decoration. Every number traces to one of exactly
       three sources, and the label says which — an operator has to be able to
       tell a printed value from a cross-reference. */
    const source = candidate.provenance;
    if (source === 'listing') {
      if (!columns.has(candidate.listingDie)) {
        fail(`${row.sa} claims ${candidate.die} is in its component columns, and it is not`);
      }
      if (!candidate.verified) fail(`${row.sa}: a listed component ${candidate.die} is marked unverified`);
    } else if (source === 'variant') {
      if (!recovered.has(candidate.listingDie)) {
        fail(`${row.sa} claims ${candidate.die} was recovered, and it was not`);
      }
      if (candidate.verified) fail(`${row.sa}: recovered ${candidate.die} is presented as verified`);
      if (!candidate.provenanceSa) fail(`${row.sa}: recovered ${candidate.die} does not name its source row`);
      if (!provenanceLabel(candidate).includes(candidate.provenanceSa)) {
        fail(`${row.sa}: the label for ${candidate.die} does not name ${candidate.provenanceSa}`);
      }
      recoveredRows += 1;
    } else if (source === 'description') {
      if (!described.has(candidate.listingDie)) {
        fail(`${row.sa} claims ${candidate.die} is named in its description, and it is not`);
      }
      descriptionRows += 1;
    } else {
      fail(`${row.sa} offered ${candidate.die} with the unexpected provenance "${source}"`);
    }

    // A component that shares its number with the assembly is an engineering
    // fact, not a leak — SA80-104's interior really is 80-104. It is counted
    // so a change in how often it happens is visible.
    if (candidate.listingDie === row.sa.replace(/^SA/, '')) sameNumberComponents += 1;
  }

  /* Numbers the listing mentions without saying what they are stay out of the
     choices. Offering them would mean inventing a role the source never gave. */
  const offered = new Set(result.candidates.map((candidate) => candidate.die));
  for (const reference of result.references) {
    if (offered.has(reference.die)) {
      fail(`${row.sa} offered the unroled reference ${reference.die} as an order choice`);
    }
  }
}

note(`${assemblies} listing rows resolved to extrusions, ${withoutComponents} correctly refused`);
note(`${recoveredRows} recovered components carried their source row; ${descriptionRows} came from a description`);
note(`${sameNumberComponents} components legitimately share their assembly's number`);

if (assemblies + withoutComponents !== SUBASSEMBLIES.length) {
  fail('some listing rows produced neither an answer nor a refusal');
}
if (!assemblies || !withoutComponents || !recoveredRows || !descriptionRows) {
  fail('a provenance path produced no rows at all — the guardrail is not being exercised');
}

/* ---------- the shapes the book actually contains ---------- */

const known = identifyMaterial('S80.106');
if (known.candidates.map((c) => c.die).join(',') !== '80.113,84.901,80.105') {
  fail(`S80.106 resolved to ${known.candidates.map((c) => c.die).join(',')}, expected 80.113,84.901,80.105`);
} else {
  note('S80.106 → 80.113 exterior, 84.901 thermal break, 80.105 interior');
}
if (identifyMaterial('SA80-106').candidates.length !== known.candidates.length) {
  fail('the book spelling SA80-106 and the schedule spelling S80.106 disagree');
}

// A listing row that points at one individual profile rather than four parts.
const profile = identifyMaterial('SA89-083HT');
if (profile.blocked || profile.candidates.length !== 1 || profile.candidates[0].die !== '84.909') {
  fail(`SA89-083HT should resolve to the single profile 84.909, got ${JSON.stringify(profile.candidates)}`);
} else {
  note('SA89-083HT → the one profile its description names, not four missing parts');
}

const bare = identifyMaterial('80.113');
if (bare.kind !== 'extrusion' || bare.candidates.length !== 1 || bare.candidates[0].provenance !== 'direct') {
  fail('a bare extrusion number did not resolve directly');
}
if (identifyMaterial('80-113').candidates[0]?.die !== '80.113') {
  fail('the listing spelling of a bare extrusion was not normalised to the schedule spelling');
}

/* ---------- the four quantities ---------- */

const identified = identifyMaterial('S80.106');
const draft = makeRequestDraft({
  job: {
    taskKey: 'fom2|39001|S80.104', workOrder: '39001', project: 'Harbour Point',
    floor: 'L2', requiredBy: '2026-09-14',
  },
  identified,
  candidate: identified.candidates[0],
  quantities: { piecesShort: '6', bars: '2', stockLength: "18'", finish: 'k11704' },
  request: { reason: REQUEST_REASONS[0], requestedBy: 'Abhay', note: 'Interior only' },
});

if (draft.die !== '80.113') fail(`the draft ordered ${draft.die} instead of the chosen component`);
if (draft.sourceAssembly !== 'SA80-106') fail('the draft lost the sub-assembly it came from');
if (draft.scheduledAs !== 'S80.106') fail('the draft lost what the schedule actually said');
if (draft.piecesShort !== 6 || draft.bars !== 2) fail('pieces short and bars did not stay separate numbers');
if (draft.stockLength !== '18') fail(`stock length kept its unit: "${draft.stockLength}"`);
if (draft.finish !== 'K11704') fail('finish was not normalised');
if (cleanLength('18 ft') !== '18' || cleanLength('18′') !== '18') fail('stock length parsing missed a written unit');
if (!requestComplete(draft)) fail(`a fully filled request reads incomplete: ${missingRequestFields(draft)}`);
note('one draft carries pieces short, bars, stock length and needed-by as four separate values');

const thin = makeRequestDraft({
  identified, candidate: identified.candidates[0],
  job: { workOrder: '39001' }, quantities: {}, request: {},
});
const missing = missingRequestFields(thin);
for (const field of ['project', 'stock length', 'finish', 'bars', 'requested by']) {
  if (!missing.includes(field)) fail(`an empty request did not report "${field}" as missing`);
}
if (requestComplete(thin)) fail('an empty request was reported as ready to copy');
if (thin.piecesShort !== null || thin.bars !== null) fail('an unstated quantity became a number');
note(`an incomplete request names what it still needs: ${missing.join(', ')}`);

/* ---------- what leaves the app ---------- */

const row = workbookRow(draft);
if (row.length !== WORKBOOK_COLUMNS.length) {
  fail(`the workbook row has ${row.length} cells for ${WORKBOOK_COLUMNS.length} columns`);
}
if (row[WORKBOOK_COLUMNS.indexOf('Extrusion')] !== '80.113') {
  fail(`the workbook row's extrusion cell is "${row[WORKBOOK_COLUMNS.indexOf('Extrusion')]}"`);
}
if (row.some((cell) => /^S(?:A)?\d/i.test(cell))) {
  fail(`a sub-assembly number reached the workbook row: ${row.join(' | ')}`);
}
if (row[WORKBOOK_COLUMNS.indexOf('Bars')] !== '2'
  || row[WORKBOOK_COLUMNS.indexOf('Stock length')] !== '18') {
  fail('bars and stock length are not in their own workbook columns');
}

const tsv = workbookTsv([draft, thin]);
if (tsv.split('\n').length !== 2) fail('the clipboard did not produce one line per request');
if (tsv.split('\n').some((line) => line.split('\t').length !== WORKBOOK_COLUMNS.length)) {
  fail('a clipboard line does not have one cell per workbook column');
}
if (/[\r]/.test(tsv)) fail('the clipboard rows carry a stray carriage return');
note(`clipboard rows are ${WORKBOOK_COLUMNS.length} tab-separated cells, ready to paste at Date`);

const csv = requestCsv([draft]);
const header = csv.split('\r\n')[0].split(',');
if (header.length !== EXPORT_COLUMNS.length) fail('the export header lost a column');
for (const column of ['Pieces short', 'Needed by', 'Source', 'Scheduled as']) {
  if (!header.includes(column)) fail(`the export dropped the "${column}" column`);
}
const exported = csv.split('\r\n')[1];
if (!exported.includes('S80.106')) fail('the export lost the schedule number the request came from');
if (!exported.includes('80.113')) fail('the export lost the extrusion being requested');
if (!exported.includes('Listed on SA80-106')) fail('the export lost where the number came from');
note('the export keeps pieces short, needed-by and provenance the workbook row has no column for');

// A note with a comma must not become two columns.
const quoted = requestCsv([{ ...draft, note: 'Interior only, mill week of the 25th' }]);
if (quoted.split('\r\n')[1].split(',').length === EXPORT_COLUMNS.length) {
  fail('a comma inside a note was not quoted — the export would shift a column');
}
if (!quoted.includes('"Interior only, mill week of the 25th"')) fail('a note with a comma was not quoted');

// A recovered number must say so wherever the request is written out.
const recoveredSa = SUBASSEMBLIES.find((entry) => recoveredComponentsOf(entry).length);
const recoveredResult = identifyMaterial(recoveredSa.sa);
const recoveredCandidate = recoveredResult.candidates.find((c) => c.provenance === 'variant');
const recoveredDraft = makeRequestDraft({
  identified: recoveredResult, candidate: recoveredCandidate,
  job: { workOrder: '1' }, quantities: {}, request: {},
});
if (recoveredDraft.verified) fail('a recovered component was written out as verified');
if (!requestCsv([recoveredDraft]).includes(recoveredCandidate.provenanceSa)) {
  fail('an exported recovered component does not name the row it was recovered from');
}
note(`a recovered component stays labelled: ${provenanceLabel(recoveredDraft)}`);

console.log(errors.length ? '\nERRORS:\n  ' + errors.join('\n  ') : '\nERRORS: none');
process.exit(errors.length ? 1 : 0);
