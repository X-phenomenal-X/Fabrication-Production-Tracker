/* The routing SOP, checked branch by branch and then against the real
   schedules. Run: node test/routing-check.mjs

   SOP-WW-CUT-008 v8.0 is a flowchart with five leaves and a set of conditions
   that decide between them. Each leaf gets a case here, because the cost of
   getting one wrong is material walking to a station it does not need — or
   worse, skipping one it does. */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = '/root/.claude/uploads/042835a0-704b-5601-bc20-4ed82d27578f';
const FILES = {
  rolling: `${DIR}/da7bb9f1-Rolling_Schedule_2026.xlsx`,
  cnc: `${DIR}/bae855fd-CNC_Schedule_Rev_E.xlsx`,
};

const errors = [];
const step = (s) => console.log('  •', s);
const fail = (s) => { errors.push(s); console.log('  ✗', s); };

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.hostname !== 'app.local') return route.continue();
  const f = path.join(ROOT, url.pathname);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
  const ext = path.extname(f);
  return route.fulfill({
    status: 200,
    contentType: ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/html',
    body: fs.readFileSync(f),
  });
});

await page.goto('http://app.local/index.html');
await page.waitForSelector('header.top');

/* ---------- every leaf of the flowchart ---------- */

const paths = await page.evaluate(async () => {
  const R = await import('/js/routing.js');
  const one = (die, machine, extra) => {
    const r = R.routeFor({ wo: 'X', die, machine, ...extra });
    return r ? { track: r.track, sure: r.sure, path: r.steps.map((s) => s.station).join(' → ') } : null;
  };
  return {
    // Widths, once material is on the widths line.
    htSkipsSaw: one('S80.104HT', 'fom2'),
    fiveTakeSaw: one('S80.104', 'fom2'),
    otherToFom2: one('S80.321', 'fom2'),
    // Heights, and the three things that add an FMC after the punch.
    heightPlain: one('S80.106', 'multipunch'),
    heightPin: one('S80.106', 'multipunch', { pinHole: 'P:Y' }),
    heightPinNo: one('S80.106', 'multipunch', { pinHole: 'P:N' }),
    heightIsv: one('S80.106', 'multipunch', { comments: 'ISV required' }),
    heightDie: one('S80.236', 'multipunch'),
    // Vents, both stations. 8500 is the vent series — FOM 3 runs nothing else.
    ventRoll: one('S85.207HT', 'roll-man'),
    ventFom: one('S85.207HT', 'fom3'),
    // Manual rolling also runs door sash and flashing, which this SOP does
    // not cover. An 8000 die there is not a vent.
    manualNotVent: one('S80.501', 'roll-man'),
    // FOM 1 is the 8900-and-screen machine, off this flowchart entirely.
    fom1: one('S89.057', 'fom1'),
    // Auto rolling, before the split.
    rollFive: one('S80.104', 'roll-auto'),
    rollVertical: one('S80.106HT', 'roll-auto'),
    rollHorizontal: one('S80.321', 'roll-auto'),
    rollUnknown: one('S80.254', 'roll-auto'),
    // Off the SOP entirely.
    notCovered: one('S80.106', 'cncfmc'),
  };
});

const expect = (name, got, track, path) => {
  if (!got) return fail(`${name}: no route at all`);
  if (got.track !== track) return fail(`${name}: track is "${got.track}", expected "${track}"`);
  if (got.path !== path) return fail(`${name}:\n      got  ${got.path}\n      want ${path}`);
  step(`${name}: ${got.path}`);
};

const FOM2 = 'Auto Rolling → FOM 2 → Main assembly / prep (station 4)';
const SAWW = 'Auto Rolling → Elumatec Saw (widths) → Widths Punch → Main assembly / prep (station 4)';
const HEIGHT = 'Auto Rolling → Elumatec Saw (heights) → Multi Punch → Main assembly / prep (station 4)';
const HEIGHT_FMC = 'Auto Rolling → Elumatec Saw (heights) → Multi Punch → FMC 1 / FMC 2 → '
  + 'Main assembly / prep (station 4)';
const VENT = 'Manual Rolling → FOM 3 → Vent assembly';

// The rule the SOP puts in capitals: high thermal skips two stations.
expect('high thermal skips the saw and the widths punch', paths.htSkipsSaw, 'widths', FOM2);
expect('one of the five goes through the saw', paths.fiveTakeSaw, 'widths', SAWW);
expect('any other width goes straight to FOM 2', paths.otherToFom2, 'widths', FOM2);

expect('a plain height stops at the punch', paths.heightPlain, 'heights', HEIGHT);
expect('pin holes add an FMC', paths.heightPin, 'heights', HEIGHT_FMC);
expect('P:N does not add an FMC', paths.heightPinNo, 'heights', HEIGHT);
expect('ISV adds an FMC', paths.heightIsv, 'heights', HEIGHT_FMC);
expect('SA80.236 adds an FMC', paths.heightDie, 'heights', HEIGHT_FMC);

expect('vents from manual rolling', paths.ventRoll, 'vents', VENT);
expect('vents from FOM 3', paths.ventFom, 'vents', VENT);

/* Auto rolling is before the split, and this is where the rules are easiest to
   get wrong. High thermal is a *widths* question on the flowchart, so it must
   not be used to call a vertical a width: SA80-106HT is a vertical male frame
   and belongs to the saw, not FOM 2. Reading HT as "width" here sent a third
   of auto rolling to the wrong machine before this test existed. */
expect('a named width die is a width even before the split', paths.rollFive, 'widths', SAWW);
expect('a high thermal vertical is still a height', paths.rollVertical, 'heights', HEIGHT);
expect('a horizontal is a width', paths.rollHorizontal, 'widths', FOM2);
if (paths.rollUnknown?.track !== 'ww') {
  fail(`a die the book does not orient should stay unsplit, got "${paths.rollUnknown?.track}"`);
} else if (paths.rollUnknown.sure) {
  fail('an unsplit line must not claim to be sure');
} else {
  step('a die the book does not orient stays unsplit: ' + paths.rollUnknown.path);
}

/* Anything the SOP does not cover has to say so rather than invent a route.
   This is the half that is easy to get wrong in the generous direction: the
   department runs sliding door, flashing and door sash through the same
   rolling machines, and FOM 1 is a different product line altogether. */
for (const [name, got] of [
  ['a CNC & FMC line', paths.notCovered],
  ['an 8000 die on manual rolling', paths.manualNotVent],
  ['an 8900 die on FOM 1', paths.fom1],
]) {
  if (got !== null) fail(`${name} is outside the SOP but got ${JSON.stringify(got)}`);
  else step(`${name} is not routed by the SOP — it keeps the learned suggestion`);
}

/* ---------- and over the real schedules ---------- */

const real = await page.evaluate(async (b64) => {
  const toBuf = (s) => {
    const bin = atob(s);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a.buffer;
  };
  const { importMachineWorkbook } = await import('/js/import-machines.js');
  const R = await import('/js/routing.js');
  const roll = await importMachineWorkbook(toBuf(b64.rolling), { kind: 'rolling', fileName: 'R.xlsx' });
  const cnc = await importMachineWorkbook(toBuf(b64.cnc), { kind: 'cnc', fileName: 'C.xlsx' });
  const tasks = roll.tasks.concat(cnc.tasks);

  const tracks = {};
  let sawBound = 0;
  let noRoute = 0;
  let offRoute = 0;
  for (const t of tasks) {
    const r = R.routeFor(t);
    if (!r) { noRoute++; continue; }
    tracks[r.track] = (tracks[r.track] || 0) + 1;
    if (r.steps.some((s) => s.station === 'Elumatec Saw (widths)')) sawBound++;
    // Standing at a machine that is not on its own route: the schedule and
    // the SOP disagree about this job.
    if (r.at < 0 && r.steps.some((s) => s.machine)) offRoute++;
  }
  return { total: tasks.length, tracks, sawBound, noRoute, offRoute };
}, {
  rolling: fs.readFileSync(FILES.rolling).toString('base64'),
  cnc: fs.readFileSync(FILES.cnc).toString('base64'),
});

step(`${real.total} real lines: ${Object.entries(real.tracks).map(([k, v]) => `${k} ${v}`).join(', ')}`
  + `, ${real.noRoute} outside the SOP`);

/* 474 lines carry one of the five dies; two of them sit on FOM 1, which this
   SOP does not cover at all, so 472 get a widths-saw route. */
if (real.sawBound !== 472) {
  fail(`expected 472 lines through the widths saw (the five dies), got ${real.sawBound}`);
} else {
  step('472 lines route through the widths saw — the five dies, less the two on FOM 1');
}

/* Outside the SOP: the CNC & FMC sheet, FOM 1, and the non-vent work on
   manual rolling. Pinned so that widening the SOP's reach — which would mean
   routing work it does not describe — has to be a deliberate change. */
if (real.noRoute !== 696) fail(`expected 696 lines outside the SOP, got ${real.noRoute}`);
else step(`${real.noRoute} lines outside the SOP: the CNC sheet, FOM 1, and door/flashing work`);

/* Lines the schedule puts somewhere the SOP does not route them. All 300 are
   one of the five saw dies scheduled on FOM 2. Worth an assertion because it
   is a real disagreement between the workbook and the standard, and it should
   not change quietly. */
if (real.offRoute !== 300) fail(`expected 300 lines off their SOP route, got ${real.offRoute}`);
else step('300 lines sit off their SOP route — the five saw dies, scheduled on FOM 2');

await browser.close();
console.log('\n' + (errors.length ? `ERRORS:\n - ${errors.join('\n - ')}` : 'ERRORS: none'));
process.exit(errors.length ? 1 : 0);
