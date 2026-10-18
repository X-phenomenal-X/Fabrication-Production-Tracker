/* Headless schedule import: same parse and merge as Setup, schedules only.
   Run: node test/import-schedules-check.mjs */

import '../scripts/node-dom.mjs';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { importDailySchedule } from '../js/import-daily.js';
import { importMachineWorkbook } from '../js/import-machines.js';
import {
  applyDailyImport, applyMachineImport, setDailyImport, setMachineImport, state,
} from '../js/store.js';
import { ImportError, runImport } from '../scripts/import-schedules.mjs';
import { ensureWorkbookFixtures, makeRawXlsx, makeWorkbook } from './workbook-fixture.mjs';

const step = (message) => console.log('  •', message);
const books = ensureWorkbookFixtures();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-import-'));
const date = (iso) => ({ date: iso });

function must(condition, message) {
  if (!condition) throw new Error(message);
}

async function fails(fn, pattern) {
  try {
    await fn();
  } catch (error) {
    must(pattern.test(error.message), `expected ${pattern}, got: ${error.message}`);
    must(/nothing was saved|wrote nothing/i.test(error.message), `did not refuse the write: ${error.message}`);
    return;
  }
  throw new Error(`expected a failure matching ${pattern}`);
}

function readFile(name) {
  return fs.readFileSync(path.join(tmp, name));
}

function writeBook(name, sheets, options) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, makeWorkbook(sheets, options));
  return file;
}

const machineHeader = { 1: 'WO#', 2: 'PROJECT', 3: 'FL', 4: 'Product', 5: 'QTY' };
function machineRow(wo, status = 'READY') {
  return { 1: wo, 2: 'Harbour Point', 3: '1A', 4: 'S80.104', 5: 12, 8: date('2026-08-12'), 11: status };
}

function cncSheets({ shiftName = 'Shift Update', shiftRows, daily = false, archived = true } = {}) {
  const sheets = {
    FOM1: [machineHeader, machineRow('72001')],
    FOM2: [machineHeader, machineRow('72002')],
    FOM3: [machineHeader, machineRow('72003')],
    'CNC & FMC': [machineHeader, machineRow('72004')],
    [shiftName]: shiftRows || [
      { 1: 'Date', 2: date('2026-08-13'), 6: 'AFTERNOON' },
      { 1: 'Machine', 2: '#Ops', 4: 'Work Done / In Progress', 6: 'Next in Schedule' },
      { 1: 'FOM 1', 2: 1, 4: 'Live afternoon work', 6: 'Next job' },
    ],
  };
  if (archived) {
    sheets['Shift Update 2'] = [
      { 1: 'Date', 2: date('2026-01-01'), 6: 'DAY' },
      { 1: 'Machine', 4: 'Work Done / In Progress' },
      { 1: 'FOM 1', 2: 1, 4: 'ARCHIVED DATA MUST NOT LOAD' },
      { 1: 'FMC 1', 2: 1, 4: 'ARCHIVED FMC DATA MUST NOT LOAD' },
    ];
  }
  if (daily) {
    sheets['Daily Sched'] = [
      { 1: 'W/O #', 2: 'JOB CODE', 3: 'PROJECT', 4: 'FLOOR', 5: 'QTY', 6: 'NOTES', 12: 'SERIES' },
      { 1: 'Not the daily schedule' },
      { 1: '99999', 2: 'J-9', 3: 'Should Not Load', 4: 'L9', 5: 4, 6: 'cnc tab', 12: '8000' },
    ];
  }
  return sheets;
}

function dailyRows(count, header = 'W/O #') {
  const rows = [
    { 1: header, 2: 'JOB CODE', 3: 'PROJECT', 4: 'FLOOR', 5: 'QTY', 6: 'NOTES', 12: 'SERIES' },
    { 1: 'Daily Schedule fixture' },
  ];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      1: String(90000 + i), 2: `J-${i}`, 3: 'Harbour Point', 4: 'L1', 5: 10, 6: 'Note', 12: '8000',
    });
  }
  return rows;
}

/* ---------- the merge matches a hand import ---------- */

function machineOracle(existing, payload) {
  const { tasks, shiftUpdate, report } = payload;
  const machines = new Set(tasks.map((task) => task.machine));
  return {
    tasks: existing.tasks
      .filter((task) => task.source !== report.kind && !machines.has(task.machine))
      .concat(tasks.map((task) => ({ ...task, source: report.kind }))),
    shiftUpdate: shiftUpdate ? { ...shiftUpdate, importedAt: report.importedAt } : existing.shiftUpdate,
  };
}

const rollingParsed = await importMachineWorkbook(fs.readFileSync(books.rolling), { kind: 'rolling', fileName: 'Rolling Schedule_2026.xlsx' });
const cncParsed = await importMachineWorkbook(fs.readFileSync(books.cnc), { kind: 'cnc', fileName: 'CNC Schedule_Rev E.xlsx' });
const dailyParsed = await importDailySchedule(fs.readFileSync(books.daily), { fileName: 'Daily Schedule Oct 13 Rev B.xlsx' });

must(rollingParsed.tasks.length === 160, `rolling parsed ${rollingParsed.tasks.length}, expected 160`);
must(cncParsed.tasks.length === 280, `cnc parsed ${cncParsed.tasks.length}, expected 280`);
must(dailyParsed.rows.length === 72, `daily parsed ${dailyParsed.rows.length}, expected 72`);
must(dailyParsed.report.woHeaderFound, 'fixture daily header was not recognised');
must(cncParsed.report.missing.includes('MultiPunch & SAW') === false, 'fixture CNC is missing MultiPunch & SAW');
must(!cncParsed.tasks.some((task) => task.wo === '99999'), 'CNC import must not read a daily order number from nowhere');
step(`fixtures: rolling ${rollingParsed.tasks.length}, cnc ${cncParsed.tasks.length}, daily ${dailyParsed.rows.length}`);

const prior = {
  tasks: [
    { id: 'old-roll', source: 'rolling', machine: 'roll-auto', wo: 'OLD-ROLL', die: 'A' },
    { id: 'old-cnc', source: 'cnc', machine: 'fom1', wo: 'OLD-CNC', die: 'B' },
    { id: 'hand', machine: 'saw', wo: 'HAND', die: 'C' },
  ],
  shiftUpdate: { date: '2026-01-01', shift: 'DAY', machines: { fom1: { machine: 'fom1', done: ['keep until cnc'] } } },
  dailyOrders: [{ id: 'keep-daily', wo: 'KEEP', project: 'Keep', floor: '1' }],
};
const rollingOracle = machineOracle(prior, rollingParsed);
const mergedRolling = applyMachineImport(prior, rollingParsed, () => ({ at: 'x', by: 'y', rev: '1@z' }));
must(JSON.stringify(mergedRolling.tasks) === JSON.stringify(rollingOracle.tasks), 'rolling merge diverged from a hand import');
must(JSON.stringify(mergedRolling.shiftUpdate) === JSON.stringify(rollingOracle.shiftUpdate), 'rolling import replaced the shift update');
must(mergedRolling.tasks.some((task) => task.wo === 'OLD-CNC'), 'rolling import removed CNC jobs');
must(mergedRolling.tasks.some((task) => task.wo === 'HAND'), 'rolling import removed a job from another machine');
must(!mergedRolling.tasks.some((task) => task.wo === 'OLD-ROLL'), 'rolling import kept the old rolling job');

state.tasks = JSON.parse(JSON.stringify(prior.tasks));
state.machineMeta = {};
state.shiftUpdate = JSON.parse(JSON.stringify(prior.shiftUpdate));
state.dailyOrders = JSON.parse(JSON.stringify(prior.dailyOrders));
state.dailyMeta = { fileName: 'keep.xlsx', count: 1 };
setMachineImport(rollingParsed);
must(JSON.stringify(state.tasks) === JSON.stringify(rollingOracle.tasks), 'Setup rolling import diverged from the shared merge');
must(state.dailyOrders[0].wo === 'KEEP', 'Setup rolling import changed daily orders');
must(state.shiftUpdate.date === '2026-01-01', 'Setup rolling import cleared the shift update');

const afterRolling = {
  tasks: state.tasks,
  shiftUpdate: state.shiftUpdate,
  machineMeta: state.machineMeta,
  dailyOrders: state.dailyOrders,
  dailyMeta: state.dailyMeta,
};
const cncOracle = machineOracle(afterRolling, cncParsed);
setMachineImport(cncParsed);
must(JSON.stringify(state.tasks) === JSON.stringify(cncOracle.tasks), 'Setup CNC import diverged from the shared merge');
must(state.shiftUpdate.shift === 'AFTERNOON', `CNC shift update became ${state.shiftUpdate.shift}`);
must(!Object.values(state.shiftUpdate.machines).some((entry) => entry.done?.join(' ').includes('ARCHIVED')), 'archived shift update loaded');
must(state.dailyOrders[0].wo === 'KEEP', 'Setup CNC import changed daily orders');
must(state.tasks.some((task) => task.source === 'rolling' && task.wo === 'MU2026-012'), 'CNC import removed rolling jobs');

const dailyBefore = state.dailyOrders.slice();
setDailyImport(dailyParsed);
must(state.dailyOrders.length === 72, 'daily import did not replace the order list');
must(JSON.stringify(state.tasks) === JSON.stringify(cncOracle.tasks), 'daily import changed machine jobs');
const dailyMerged = applyDailyImport({ dailyOrders: dailyBefore, dailyMeta: null }, dailyParsed, () => ({ at: 'x', by: 'y', rev: '1@z' }));
must(JSON.stringify(dailyMerged.dailyOrders) === JSON.stringify(state.dailyOrders), 'Setup daily import diverged from the shared merge');
step('hand import and the script merge agree');

/* ---------- real tab names ---------- */

const spaced = await importMachineWorkbook(
  fs.readFileSync(writeBook('cnc-spaced.xlsx', cncSheets({ shiftName: ' Shift Update', daily: true }))),
  { kind: 'cnc', fileName: 'CNC Schedule_Rev E.xlsx' },
);
must(spaced.report.shiftSheet === ' Shift Update', `shift tab resolved to ${spaced.report.shiftSheet}`);
must(spaced.shiftUpdate.shift === 'AFTERNOON', `spaced shift update loaded ${spaced.shiftUpdate?.shift}`);
must(!JSON.stringify(spaced.shiftUpdate).includes('ARCHIVED'), 'spaced workbook fell through to Shift Update 2');
must(!spaced.tasks.some((task) => task.wo === '99999'), 'CNC Daily Sched tab became a machine job');
must(spaced.report.missing.includes('MultiPunch & SAW'), 'current CNC file should report MultiPunch & SAW missing');
step('leading-space Shift Update is the live tab; CNC Daily Sched is ignored');

const encoded = await importMachineWorkbook(
  fs.readFileSync(writeBook('cnc-encoded.xlsx', cncSheets({ shiftName: '_x0020_Shift Update', archived: false }))),
  { kind: 'cnc', fileName: 'CNC Schedule_Rev E.xlsx' },
);
must(encoded.shiftUpdate?.shift === 'AFTERNOON', 'Excel _x0020_ Shift Update was not read');

const archivedOnly = await importMachineWorkbook(
  fs.readFileSync(writeBook('cnc-archived.xlsx', cncSheets({ shiftName: 'Shift Update 2', archived: false }))),
  { kind: 'cnc', fileName: 'CNC Schedule_Rev E.xlsx' },
);
must(archivedOnly.shiftUpdate == null, 'Shift Update 2 was accepted as the live sheet');
must(archivedOnly.report.missing.includes('Shift Update'), 'missing live Shift Update was not reported');
step('archived shift-update tabs stay archived');

/* ---------- shared strings, which real workbooks use ---------- */

const SS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const sharedDaily = makeRawXlsx({
  'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="${SS}" xmlns:r="${REL}"><sheets><sheet name="Daily Sched" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  'xl/styles.xml': `<?xml version="1.0"?><styleSheet xmlns="${SS}"><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>`,
  'xl/sharedStrings.xml': `<?xml version="1.0"?><sst xmlns="${SS}"><si><t>W/O #</t></si><si><t>JOB CODE</t></si><si><t>PROJECT</t></si><si><t>FLOOR</t></si><si><t>NOTES</t></si><si><t>SERIES</t></si><si><t>81001</t></si><si><t>Harbour Point</t></si><si><t>L1</t></si><si><t>Check colour</t></si><si><t>8000</t></si></sst>`,
  'xl/worksheets/sheet1.xml': `<?xml version="1.0"?><worksheet xmlns="${SS}"><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c><c r="F1" t="s"><v>5</v></c></row>
    <row r="2"><c r="A2" t="s"><v>7</v></c></row>
    <row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3" t="s"><v>1</v></c><c r="C3" t="s"><v>7</v></c><c r="D3" t="s"><v>8</v></c><c r="E3"><v>12</v></c><c r="F3" t="s"><v>9</v></c><c r="L3" t="s"><v>10</v></c></row>
    </sheetData></worksheet>`,
});
const sharedParsed = await importDailySchedule(sharedDaily, { fileName: 'Daily Schedule Oct 13 Rev B.xlsx' });
must(sharedParsed.report.woHeaderFound, 'shared-string W/O # header was missed');
must(sharedParsed.rows.length === 1 && sharedParsed.rows[0].wo === '81001', `shared strings parsed ${JSON.stringify(sharedParsed.rows)}`);
must(sharedParsed.rows[0].qty === 12, 'shared-string workbook lost the quantity');
step('shared-string Daily Schedule parses in Node');

/* ---------- a cloud that speaks the tracker's save ---------- */

const ANON = 'test-anon-key';
const EMAIL = 'tracker-import@example.com';
const PASSWORD = 'correct-horse';
const USER = '00000000-0000-4000-8000-0000000000a1';
const TOKEN = `aaa.${Buffer.from(JSON.stringify({ sub: USER, email: EMAIL, role: 'authenticated' })).toString('base64url')}.sig`;
const table = new Map();
let memberRole = 'editor';
let conflictOnce = false;
const seen = { auth: 0, write: 0, workWrites: 0 };

function resetCloud() {
  table.clear();
  memberRole = 'editor';
  conflictOnce = false;
  seen.auth = 0;
  seen.write = 0;
  seen.workWrites = 0;
}

function seed(part, data, updatedAt = '2026-10-18T15:00:00.000Z') {
  table.set(`cutting|${part}`, { site: 'cutting', part, data, updated_at: updatedAt });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString();
  return text ? JSON.parse(text) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://cloud.local');
  const json = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === '/auth/v1/token') {
    seen.auth += 1;
    const body = await readBody(req);
    const grant = url.searchParams.get('grant_type');
    const ok = grant === 'password'
      ? body.email === EMAIL && body.password === PASSWORD
      : grant === 'refresh_token' && body.refresh_token === 'refresh-1';
    if (!ok) return json(400, { error: 'invalid_grant' });
    return json(200, {
      access_token: TOKEN,
      refresh_token: 'refresh-2',
      expires_in: 3600,
      user: { id: USER, email: EMAIL },
    });
  }
  if (req.headers.apikey !== ANON) return json(401, { message: 'invalid api key' });
  if (url.pathname.startsWith('/rest/v1/tracker_members')) return json(200, [{ role: memberRole }]);
  if (!url.pathname.startsWith('/rest/v1/tracker_state')) return json(404, { message: 'missing' });
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { message: 'jwt' });

  if (req.method === 'GET') {
    const site = (url.searchParams.get('site') || '').replace(/^eq\./, '');
    const parts = (url.searchParams.get('part') || '').replace(/^in\.\(|\)$/g, '').split(',').map((part) => part.replace(/"/g, '')).filter(Boolean);
    const rows = [...table.values()].filter((row) => row.site === site && (!parts.length || parts.includes(row.part)));
    return json(200, rows.map((row) => ({ part: row.part, data: row.data, updated_at: row.updated_at })));
  }

  if (req.method === 'POST') {
    const body = await readBody(req);
    if (body.part === 'work') seen.workWrites += 1;
    seen.write += 1;
    const key = `${body.site}|${body.part}`;
    if (table.has(key)) return json(409, { message: 'duplicate key' });
    const row = { site: body.site, part: body.part, data: body.data, updated_at: body.updated_at };
    table.set(key, row);
    return json(201, [row]);
  }

  if (req.method === 'PATCH') {
    const site = (url.searchParams.get('site') || '').replace(/^eq\./, '');
    const part = (url.searchParams.get('part') || '').replace(/^eq\./, '');
    const expected = (url.searchParams.get('updated_at') || '').replace(/^eq\./, '');
    const body = await readBody(req);
    if (part === 'work') seen.workWrites += 1;
    const key = `${site}|${part}`;
    const current = table.get(key);
    if (conflictOnce && part === 'base') {
      conflictOnce = false;
      current.updated_at = '2026-10-18T19:00:00.000Z';
      current.data = structuredClone(current.data);
      current.data.tasks.push({ id: 'race', source: 'rolling', machine: 'roll-auto', wo: 'RACE', die: 'Z', qty: 1 });
      return json(200, []);
    }
    if (!current || current.updated_at !== expected) return json(200, []);
    seen.write += 1;
    current.data = body.data;
    current.updated_at = body.updated_at;
    return json(200, [current]);
  }
  return json(405, { message: 'no' });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const cloud = `http://127.0.0.1:${server.address().port}`;
const env = {
  SUPABASE_URL: cloud,
  SUPABASE_ANON_KEY: ANON,
  SUPABASE_EMAIL: EMAIL,
  SUPABASE_PASSWORD: PASSWORD,
  TRACKER_SITE: 'cutting',
};
const workDoc = {
  taskStatus: { 'roll-auto|KEEP|': { status: 'IP', note: 'leave this note' } },
  shiftLogs: { '2026-10-13|AFT': { date: '2026-10-13', shift: 'AFT', notes: 'handover stays', rows: {} } },
};
const argv = (...extra) => ['node', 'import-schedules.mjs', ...extra];

function baseRow() {
  return table.get('cutting|base');
}
function workRow() {
  return table.get('cutting|work');
}

resetCloud();
const first = await runImport(argv('--cnc', books.cnc, '--rolling', books.rolling, '--daily', books.daily), { env });
must(first.saved && first.changed, 'first import did not save');
must(seen.workWrites === 0, 'the daily-work package was written');
must(!workRow(), 'a work row was created');
must(baseRow().data.tasks.length === 440, `saved ${baseRow().data.tasks.length} jobs, expected 440`);
must(baseRow().data.dailyOrders.length === 72, 'daily orders were not saved');
must(!baseRow().data.taskStatus && !baseRow().data.shiftLogs, 'schedules package picked up daily work');
must(baseRow().data.tasks.some((task) => task.wo === 'MU2026-012' && task.source === 'rolling'), 'rolling job missing');
must(baseRow().data.tasks.some((task) => task.machine === 'fom2'), 'CNC job missing');
const cncRev = Number(String(baseRow().data.machineMeta.cnc.rev).split('@')[0]);
must(cncRev >= 1, 'saved schedules have no revision');
step('first import wrote schedules only');

const writesAfterFirst = seen.write;
const unchanged = await runImport(argv('--cnc', books.cnc, '--rolling', books.rolling, '--daily', books.daily), { env });
must(!unchanged.saved && !unchanged.changed, 'unchanged files were written again');
must(seen.write === writesAfterFirst, 'unchanged run still wrote');
must(unchanged.files.every((file) => file.status === 'unchanged'), 'summary did not skip unchanged files');
step('second run skipped unchanged files');

resetCloud();
seed('work', workDoc, '2026-10-18T12:00:00.000Z');
seed('base', {
  v: 2,
  tasks: [{ id: 'roll-keep', source: 'rolling', machine: 'roll-auto', wo: 'ROLL-KEEP', die: 'S', qty: 3, project: 'Old' }],
  machineMeta: { rolling: { fileName: 'old.xlsx', count: 1, parser: 6, rev: '4@phone', at: '2026-10-01T00:00:00.000Z', by: 'Lead' } },
  shiftUpdate: null,
  dailyOrders: [{ id: 'd1', wo: 'KEEP', project: 'Keep', floor: '1', qty: 2 }],
  dailyMeta: { fileName: 'old-daily.xlsx', count: 1, rev: '2@phone' },
  projectColorReference: { projects: { Keep: 'Black' }, rev: '1@phone' },
});
const workBefore = JSON.stringify(workRow());
const cncOnly = await runImport(argv('--cnc', books.cnc), { env });
must(cncOnly.saved, 'CNC-only import did not save');
must(JSON.stringify(workRow()) === workBefore, 'CNC import changed statuses or handovers');
const savedTasks = baseRow().data.tasks;
must(savedTasks.some((task) => task.wo === 'ROLL-KEEP'), 'CNC import removed rolling jobs');
must(savedTasks.some((task) => task.source === 'cnc' && task.machine === 'multipunch'), 'CNC jobs were not added');
must(!savedTasks.some((task) => task.wo === 'OLD-CNC'), 'a replaced CNC job came back');
must(baseRow().data.dailyOrders[0].wo === 'KEEP', 'CNC import replaced daily orders');
must(baseRow().data.projectColorReference.projects.Keep === 'Black', 'CNC import cleared project colours');
must(Number(String(baseRow().data.machineMeta.cnc.rev).split('@')[0]) > 4, 'new CNC revision did not win over the phone');
step('CNC import kept rolling, daily orders, colours and daily work');

resetCloud();
seed('work', workDoc);
seed('base', {
  v: 2,
  tasks: [],
  machineMeta: {},
  shiftUpdate: null,
  dailyOrders: [],
  dailyMeta: null,
  projectColorReference: null,
});
const beforeDry = JSON.stringify([...table.values()]);
const dry = await runImport(argv('--rolling', books.rolling, '--dry-run'), { env });
must(dry.dryRun && dry.changed && !dry.saved, 'dry run did not describe a change');
must(JSON.stringify([...table.values()]) === beforeDry, 'dry run wrote to the board');
must(dry.files[0].diff.added === 160, `dry run added ${dry.files[0].diff.added}, expected 160`);
step('dry run wrote nothing');

resetCloud();
seed('work', workDoc);
seed('base', { v: 2, tasks: [], machineMeta: {}, shiftUpdate: null, dailyOrders: [], dailyMeta: null, projectColorReference: null });
conflictOnce = true;
const raced = await runImport(argv('--cnc', books.cnc), { env });
must(raced.saved, 'conflict retry did not save');
must(baseRow().data.tasks.some((task) => task.wo === 'RACE'), 'retry dropped the job saved by the other person');
must(baseRow().data.tasks.some((task) => task.source === 'cnc'), 'retry did not apply the CNC file');
must(JSON.stringify(workRow().data) === JSON.stringify(workDoc), 'retry wrote over daily work');
step('compare-and-swap retry kept the other save');

resetCloud();
memberRole = 'viewer';
seed('work', workDoc);
await fails(() => runImport(argv('--rolling', books.rolling), { env }), /viewer/i);
must(seen.write === 0 && seen.workWrites === 0, 'a viewer account wrote');
step('viewer account is refused');

resetCloud();
await fails(() => runImport(argv('--daily', books.daily), { env: { ...env, SUPABASE_PASSWORD: 'wrong' } }), /sign-in failed/i);
must(seen.write === 0, 'bad password wrote');
step('bad password wrote nothing');

const serviceKey = `aaa.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.sig`;
await fails(() => runImport(argv('--rolling', books.rolling), { env: { ...env, SUPABASE_ANON_KEY: serviceKey } }), /service role/i);
step('service role key is refused');

/* ---------- wrong files ---------- */

resetCloud();
const recovered = path.join(tmp, 'Daily Schedule Oct 13 (AutoRecovered).xlsx');
fs.writeFileSync(recovered, fs.readFileSync(books.daily));
await fails(() => runImport(argv('--daily', recovered), { env }), /recovery or lock file/i);

const mill = writeBook('MILL PULL SCHEDULE - Oct 12TH.xlsx', {
  'Mill Pull': [{ 1: 'Die', 2: 'Qty' }, { 1: 'S80.104', 2: 4 }],
});
await fails(() => runImport(argv('--daily', mill), { env }), /Daily Sched/i);

const badHeader = writeBook('Daily Schedule Oct 13 Rev B.xlsx', {
  'Daily Sched': [
    { 1: 'Order', 2: 'Name', 3: 'Place', 4: 'Level', 5: 'Count', 6: 'Note', 12: 'Series' },
    {},
    { 1: '100', 2: 'J', 3: 'P', 4: 'L1', 5: 1, 6: 'n', 12: '8000' },
  ],
});
await fails(() => runImport(argv('--daily', badHeader), { env }), /W\/O #/i);

const notRolling = writeBook('not-rolling.xlsx', { Sheet1: [machineHeader, machineRow('1')] });
await fails(() => runImport(argv('--rolling', notRolling), { env }), /Auto/);

const noLiveShift = writeBook('CNC Schedule_Rev E.xlsx', cncSheets({ shiftName: 'Shift Update 2', archived: false }));
await fails(() => runImport(argv('--cnc', noLiveShift), { env }), /Shift Update/i);
must(seen.write === 0, 'a bad workbook still wrote');
step('wrong workbooks are refused before any save');

/* ---------- the current CNC file has no Multi Punch tab ---------- */

const currentCnc = writeBook('CNC Schedule_Rev E current.xlsx', cncSheets({ shiftName: ' Shift Update', daily: true }));
resetCloud();
seed('base', {
  v: 2,
  tasks: [
    { id: 'old-punch', source: 'cnc', machine: 'multipunch', wo: 'PUNCH-OLD', die: 'S80.106', qty: 4 },
    { id: 'roll-keep', source: 'rolling', machine: 'roll-auto', wo: 'ROLL-KEEP', die: 'S', qty: 1 },
  ],
  machineMeta: {},
  shiftUpdate: null,
  dailyOrders: [{ id: 'd1', wo: 'KEEP', project: 'Keep', floor: '1' }],
  dailyMeta: null,
  projectColorReference: null,
});
const current = await runImport(argv('--cnc', currentCnc), { env });
must(current.saved, 'current CNC file did not import');
must(current.files[0].warnings.some((warning) => warning.includes('MultiPunch & SAW')), 'missing Multi Punch sheet was not warned');
must(current.files[0].notes.some((note) => note.includes(' Shift Update')), 'leading-space tab was not reported');
must(!baseRow().data.tasks.some((task) => task.wo === 'PUNCH-OLD'), 'old Multi Punch job survived a file that has no such sheet');
must(baseRow().data.tasks.some((task) => task.wo === 'ROLL-KEEP'), 'current CNC import removed rolling');
must(baseRow().data.dailyOrders[0].wo === 'KEEP', 'current CNC import read its own Daily Sched tab');
must(baseRow().data.shiftUpdate.shift === 'AFTERNOON', 'current CNC file missed the spaced shift update');
step('current CNC workbook imports without taking its Daily Sched tab');

/* ---------- a large Daily Schedule, the size of the real Rev B file ---------- */

const bigPath = writeBook('Daily Schedule Oct 13 Rev B.xlsx', { 'Daily Sched': dailyRows(3000) }, {
  deflate: true,
  padBytes: 7 * 1024 * 1024,
});
must(fs.statSync(bigPath).size >= 7 * 1024 * 1024, 'large fixture is under 7 MB');
resetCloud();
const started = Date.now();
const big = await runImport(argv('--daily', bigPath, '--dry-run'), { env });
const seconds = (Date.now() - started) / 1000;
must(big.dryRun && big.files[0].count === 3000, `large daily parsed ${big.files[0]?.count} orders`);
must(big.files[0].diff.added === 3000, 'large daily diff was wrong');
must(seen.write === 0, 'large dry run wrote');
must(seconds < 60, `large daily took ${seconds.toFixed(1)}s`);
step(`7 MB Daily Schedule parsed in Node in ${seconds.toFixed(1)}s`);

await new Promise((resolve) => server.close(resolve));
fs.rmSync(tmp, { recursive: true, force: true });
console.log('Schedule import: OK');
