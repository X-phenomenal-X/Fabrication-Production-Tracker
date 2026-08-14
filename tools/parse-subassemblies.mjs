/* Turns the Sub-Assembly Section Book PDFs into the app's die database.

   A rolled die is not one extrusion. It is an exterior, an interior, and a
   thermal break top and bottom, combined in the sub-assembly room and then
   rolled — so SA80-106 "Typical Vertical Male Frame" is 80-113 outside,
   84-901 upper and lower, 80-105 inside. Until now the app knew the die
   number on the schedule and nothing about what it is made of, which is
   exactly what staging needs to pull.

   The book lives as one "Listing" PDF per series. `pdftotext -layout` keeps
   the table shape, and each sub-assembly comes out as a regular block:

       Exterior        80-113
       Typical Vertical Male Frame
       Upper T-Break   84-901
   SA80-106
       Lower T-Break   84-901
       Interior        80-105

   Usage: node tools/parse-subassemblies.mjs <dir-of-txt> > js/subassemblies.js
   where the .txt files are `pdftotext -layout` output of the Listing PDFs. */

import fs from 'fs';
import path from 'path';

/* The HT and HTX variants suffix the number — SA83-001HT, SA80-106HTX — so the
   suffix has to be allowed to run to more than one letter. Allowing exactly one
   silently parsed three whole series as empty. */
const DIE = /\b(\d{2}-\d{3}[A-Z]*)\b/;
const SA = /\b(SA\d{2}-\d{3}[A-Z]*)\b/;
const LABEL = /^(Exterior|Interior|Upper T-Break|Lower T-Break)\b/;

/* Labels do not reliably start a line. The book sets the description and the
   component table as separate text boxes, and where a description runs long
   the extractor merges them:

       Discontinued - Use SA80-251        Interior     80-101
       ... for Fapim Hardware_HT          Lower T-Break 84-911

   Scanning line-anchored labels lost the component in both cases. So the whole
   document is tokenised into labels and free text, in reading order, and the
   state machine runs over that instead. */
const LABEL_SCAN = /(Exterior|Interior|Upper T-Break|Lower T-Break)\s+(-{2,}|\d{2}-\d{3}[A-Z]*)?/g;

function tokenise(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let at = 0;
    LABEL_SCAN.lastIndex = 0;
    let m;
    while ((m = LABEL_SCAN.exec(line))) {
      const before = line.slice(at, m.index).trim();
      if (before) out.push({ t: 'text', v: before });
      out.push({ t: 'label', name: m[1], value: /^\d/.test(m[2] || '') ? m[2] : null });
      at = m.index + m[0].length;
    }
    const rest = line.slice(at).trim();
    if (rest) out.push({ t: 'text', v: rest });
  }
  return out;
}

const NOISE = /Caldari Road|bvglazing\.com|REVISION LOG|SERIES UPDATES|^DATE\b|^\d{4}-\d{2}-\d{2}$|^-+$/;

function parse(text, series) {
  const out = [];
  let cur = null;

  const finish = () => {
    if (cur && cur.sa) {
      cur.desc = cur.desc.join(' ').replace(/\s+/g, ' ').trim() || null;
      out.push(cur);
    }
    cur = null;
  };

  for (const tok of tokenise(text)) {
    if (tok.t === 'label') {
      if (tok.name === 'Exterior') {
        finish();
        cur = { sa: null, series, desc: [], exterior: tok.value, upperTB: null, lowerTB: null, interior: null, note: null };
        continue;
      }
      if (!cur) continue;
      if (tok.name === 'Upper T-Break') cur.upperTB = tok.value;
      else if (tok.name === 'Lower T-Break') cur.lowerTB = tok.value;
      else if (tok.name === 'Interior') { cur.interior = tok.value; finish(); }
      continue;
    }

    if (!cur) continue;
    const v = tok.v;
    if (NOISE.test(v)) continue;
    if (/^(SA\d{2}-#+|xx-xxx|N\/A)$/i.test(v)) continue;

    if (/^Discontinued/i.test(v)) { cur.note = v; continue; }

    const sa = v.match(SA);
    if (sa && /^SA/.test(v)) { cur.sa = sa[1]; continue; }
    if (sa) { cur.sa = cur.sa || sa[1]; }
    else cur.desc.push(v);
  }
  finish();
  return out;
}

const dir = process.argv[2];
if (!dir) { console.error('usage: parse-subassemblies.mjs <dir>'); process.exit(1); }

const all = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()) {
  const series = (f.match(/(\d{4}HTX|\d{4}HT|\d{4})/) || [])[1] || f.replace('.txt', '');
  const rows = parse(fs.readFileSync(path.join(dir, f), 'utf8'), series);
  all.push(...rows);
  console.error(`${f.padEnd(46)} ${String(rows.length).padStart(4)} sub-assemblies`);
}

// One entry can appear in more than one series book; keep the first and note it.
const seen = new Map();
for (const r of all) {
  if (!seen.has(r.sa)) seen.set(r.sa, r);
}
const rows = [...seen.values()].sort((a, b) => (a.sa < b.sa ? -1 : 1));

console.error(`\n${all.length} parsed, ${rows.length} unique`);
const withParts = rows.filter((r) => r.exterior || r.interior || r.upperTB || r.lowerTB);
console.error(`${withParts.length} carry at least one component`);

/* Emitted as arrays rather than objects. This file ships inside the
   single-file build that opens off a network share, and object keys repeated
   944 times cost more than the data itself — [sa, desc, ext, upper, lower,
   int, note] is about 40% smaller for exactly the same content. */
const COMPACT = rows.map((r) => [
  r.sa, r.desc || '', r.exterior || '', r.upperTB || '', r.lowerTB || '',
  r.interior || '', r.note || '', r.series,
]);

process.stdout.write(`/* Sub-assembly die database — generated, do not edit by hand.

   Built by tools/parse-subassemblies.mjs from the Sub-Assembly Section Book
   PDFs (BV Glazing, 8000-8950 series). A rolled die is an exterior, an
   interior and a thermal break top and bottom; this is what each one is made
   of, so a die on the schedule can be expanded into the extrusions staging
   has to pull.

   ${rows.length} sub-assemblies. */

const ROWS = ${JSON.stringify(COMPACT, null, 0)};

export const SUBASSEMBLIES = ROWS.map(([sa, desc, exterior, upperTB, lowerTB, interior, note, series]) => ({
  sa, desc: desc || null, exterior: exterior || null, upperTB: upperTB || null,
  lowerTB: lowerTB || null, interior: interior || null, note: note || null, series,
}));
`);
