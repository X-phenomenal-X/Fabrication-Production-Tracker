/* Sanitized XLSX workbooks for tests and CI.

   The real schedules contain customer data and must never be committed. This
   generator writes the small subset of XLSX that the app reads, with invented
   projects and work orders but all of the structural traps we rely on: every
   machine sheet, non-numeric work orders, a shared CNC/FMC queue, archived
   Shift Update lookalikes, and two blocks stacked on Shift Update. */

import fs from 'fs';
import os from 'os';
import path from 'path';

const XML = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function colName(n) {
  let out = '';
  while (n) { n--; out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26); }
  return out;
}

const dateCell = (iso) => ({ date: iso });

function excelSerial(iso) {
  return Math.round((Date.parse(iso + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000);
}

function cellXml(col, row, value) {
  const ref = `${colName(col)}${row}`;
  if (value == null || value === '') return '';
  if (value?.date) return `<c r="${ref}" s="1"><v>${excelSerial(value.date)}</v></c>`;
  if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
}

function sheetXml(rows) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="${XML}"><sheetData>`
    + rows.map((cells, i) => {
      const r = i + 1;
      const body = Object.entries(cells || {}).map(([c, v]) => cellXml(Number(c), r, v)).join('');
      return `<row r="${r}">${body}</row>`;
    }).join('')
    + `</sheetData></worksheet>`;
}

function taskRows(kind, count) {
  const rows = [{ 1: 'WO#', 2: 'PROJECT', 3: 'FL', 4: 'Product', 5: 'QTY' }];
  const dies = {
    auto: ['S80.104', 'S80.106', 'S80.321', 'S80.117'],
    manual: ['S85.207HT', 'B44.010', 'S80.501'],
    complete: ['S80.104', 'S80.106'],
    fom1: ['S89.057', 'S89.083HT'],
    fom2: ['S80.321', 'S80.117', 'S80.104'],
    fom3: ['S85.207HT', 'S85.311'],
    punch: ['S80.106', 'S80.236', 'S80.234'],
    cncfmc: ['K1285', 'S80.236', 'K1285', 'S80.236'],
  }[kind];

  const special = ['MU2026-012', 'DAN 509', '29038so', 'PARCEL29-SWD', 'TRIMS', 'PREP'];
  for (let i = 0; i < count; i++) {
    // One deterministic job appears at rolling and FOM 2 so CI exercises the
    // downstream-status rule without depending on a production work order.
    const sharedRouteJob = i === 6 && (kind === 'auto' || kind === 'fom2');
    const wo = sharedRouteJob ? 'TEST-MULTI-001'
      : i < special.length ? special[i] : String(71000 + i + Object.keys(dies).length);
    const die = sharedRouteJob ? 'S80.104' : dies[i % dies.length];
    const common = { 1: wo, 2: `Test Project ${1 + (i % 9)}`, 3: `${1 + (i % 30)}A`, 4: die };
    const day = `2026-08-${String(10 + (i % 9)).padStart(2, '0')}`;

    if (kind === 'auto') rows.push({
      ...common, 5: 12 + i, 6: i === 20 ? 2 : null, 9: dateCell(day),
      10: i === 2 ? 'ISV required' : null,
      11: i < 18 ? 'IP' : i === 20 ? 'IP BO' : 'READY',
    });
    else if (kind === 'manual') rows.push({ ...common, 5: 8 + i, 9: dateCell(day), 11: 'READY' });
    else if (kind === 'complete') rows.push({ ...common, 5: 6 + i, 9: dateCell(day), 11: 'DONE' });
    else if (kind === 'fom1') rows.push({ ...common, 5: 10 + i, 8: dateCell(day), 11: 'READY' });
    else if (kind === 'fom2') rows.push({
      1: wo, 2: common[2], 3: common[3], 4: die, 5: i % 4 === 0 ? 'P:Y' : 'P:N',
      6: 10 + i, 7: dateCell(day), 8: i === 4 ? '3 BARS' : null,
      9: i === 4 ? 'IP BO' : null, 11: sharedRouteJob ? 'DONE' : 'READY',
    });
    else if (kind === 'fom3') rows.push({ ...common, 5: 10 + i, 6: dateCell(day), 10: 'READY' });
    else if (kind === 'punch') rows.push({
      ...common, 5: 10 + i, 9: dateCell(day), 10: 'Saw ready', 11: 'Punch ready', 12: 1,
    });
    else rows.push({ ...common, 5: 10 + i, 8: dateCell(day), 9: 'READY' });
  }
  return rows;
}

function shiftUpdateRows({ archived = false } = {}) {
  if (archived) return [
    { 1: 'Date', 2: dateCell('2026-01-01'), 6: 'DAY' },
    { 1: 'Machine', 2: '#Ops', 4: 'Work Done / In Progress', 6: 'Next in Schedule', 7: 'Notes' },
    { 1: 'FOM 1', 2: 1, 4: 'ARCHIVED DATA MUST NOT LOAD', 6: 'Old work' },
    { 1: 'FMC 1', 2: 1, 4: 'ARCHIVED FMC DATA MUST NOT LOAD', 6: 'Old work' },
    { 1: 'FMC 2', 2: 1, 4: 'ARCHIVED FMC DATA MUST NOT LOAD', 6: 'Old work' },
  ];

  return [
    { 1: 'Date', 2: dateCell('2026-08-12'), 6: 'DAY' },
    { 1: 'Machine', 2: '#Ops', 4: 'Work Done / In Progress', 6: 'Next in Schedule', 7: 'Notes' },
    { 1: 'Rolling Etas Auto', 2: 4, 4: 'Test Project 1 — 180 run', 6: 'Test Project 2' },
    { 1: 'Rolling Iota Manual', 2: 4, 4: 'Test Project 3', 6: 'Test Project 4' },
    { 1: 'FOM 1', 2: 1, 4: 'Test Project 5 — running', 6: 'Test Project 6' },
    { 1: 'FOM 2', 2: 1, 4: 'Test Project 7', 6: 'Test Project 8' },
    { 1: 'FOM 3', 2: 1, 4: 'Test Project 9', 6: 'Test Project 1' },
    { 1: 'Date', 2: dateCell('2026-08-13'), 6: 'AFTERNOON' },
    { 1: 'Machine', 2: '#Ops', 4: 'Work Done / In Progress', 6: 'Next in Schedule', 7: 'Notes' },
    { 1: 'CNC-3', 2: 1, 4: 'Test Project 2 — K1285', 6: 'Test Project 3' },
    { 1: 'MultiPunch', 2: 1, 4: 'Test Project 8 — 340 run', 6: 'Test Project 9' },
  ];
}

function storedZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name);
    const data = Buffer.from(text);
    const local = Buffer.alloc(30 + filename.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // stored, because the app supports uncompressed ZIP members
    local.writeUInt32LE(0, 14); // CRC is not consulted by the app's reader
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    filename.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + filename.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    filename.copy(central, 46);
    centrals.push(central);
    offset += local.length + data.length;
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(centrals.length, 8);
  eocd.writeUInt16LE(centrals.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

function workbook(sheets) {
  const names = Object.keys(sheets);
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<workbook xmlns="${XML}" xmlns:r="${REL}"><sheets>`
    + names.map((name, i) => `<sheet name="${esc(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    + `</sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `</Relationships>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<styleSheet xmlns="${XML}"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`;
  const files = {
    'xl/workbook.xml': wb,
    'xl/_rels/workbook.xml.rels': rels,
    'xl/styles.xml': styles,
  };
  names.forEach((name, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheets[name]); });
  return storedZip(files);
}

export function ensureWorkbookFixtures() {
  const dir = path.join(os.tmpdir(), 'bv-cutting-tracker-tests');
  fs.mkdirSync(dir, { recursive: true });
  const rolling = path.join(dir, 'Rolling_Schedule_SANITIZED.xlsx');
  const cnc = path.join(dir, 'CNC_Schedule_SANITIZED.xlsx');

  fs.writeFileSync(rolling, workbook({
    Auto: taskRows('auto', 64),
    Manual: taskRows('manual', 48),
    Complete: taskRows('complete', 48),
  }));
  fs.writeFileSync(cnc, workbook({
    FOM1: taskRows('fom1', 48),
    FOM2: taskRows('fom2', 56),
    FOM3: taskRows('fom3', 44),
    'MultiPunch & SAW': taskRows('punch', 52),
    'CNC & FMC': taskRows('cncfmc', 80),
    'Shift Update': shiftUpdateRows(),
    'Shift Update 2': shiftUpdateRows({ archived: true }),
    'Shift Update (3)': shiftUpdateRows({ archived: true }),
    'Shift Update Old': shiftUpdateRows({ archived: true }),
  }));
  return { rolling, cnc, synthetic: true };
}
