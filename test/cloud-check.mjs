/* Two devices, one cloud: does the sync actually converge?

   There is no Supabase to point at from here, so this stands up a mock that
   speaks the same PostgREST shapes the client uses — the `site=eq.` /
   `part=in.()` filters, the `on_conflict` upsert with
   `Prefer: resolution=merge-duplicates`, and the CORS preflight that the
   apikey and Prefer headers force the browser to send. Getting any of those
   wrong fails here rather than on the shop floor.

   Then it drives two browser contexts as two people: one on the PC that
   imported the workbooks, one on a phone that has never seen them.

   Run: node test/cloud-check.mjs */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import http from 'http';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = '/root/.claude/uploads/042835a0-704b-5601-bc20-4ed82d27578f';
const ROLLING = `${DIR}/da7bb9f1-Rolling_Schedule_2026.xlsx`;
const CNC = `${DIR}/bae855fd-CNC_Schedule_Rev_E.xlsx`;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const step = (s) => console.log('  •', s);

/* ---------- the app's own origin ---------- */

const appServer = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, rel === '/' ? '/index.html' : rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise((r) => appServer.listen(0, r));
const appBase = `http://127.0.0.1:${appServer.address().port}`;

/* ---------- the mock cloud ---------- */

const KEY = 'test-anon-key';
const table = new Map();            // `${site}|${part}` -> { site, part, data, updated_at }
const seen = { get: 0, post: 0, preflight: 0, badAuth: 0 };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey,authorization,content-type,prefer',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

const cloudServer = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    seen.preflight++;
    res.writeHead(204, cors); return res.end();
  }

  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/rest/v1/tracker_state')) {
    res.writeHead(404, { ...cors, 'content-type': 'application/json' });
    return res.end(JSON.stringify({ message: 'relation does not exist' }));
  }

  // PostgREST rejects a missing or wrong key before it looks at anything else.
  if (req.headers.apikey !== KEY) {
    seen.badAuth++;
    res.writeHead(401, { ...cors, 'content-type': 'application/json' });
    return res.end(JSON.stringify({ message: 'invalid api key' }));
  }

  if (req.method === 'GET') {
    seen.get++;
    const site = (url.searchParams.get('site') || '').replace(/^eq\./, '');
    const partsRaw = (url.searchParams.get('part') || '').replace(/^in\.\(|\)$/g, '');
    const parts = partsRaw ? partsRaw.split(',').map((p) => p.replace(/"/g, '')) : null;
    const select = (url.searchParams.get('select') || '').split(',');

    const rows = [...table.values()]
      .filter((r) => r.site === site && (!parts || parts.includes(r.part)))
      .map((r) => Object.fromEntries(select.map((k) => [k, r[k]])));

    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    return res.end(JSON.stringify(rows));
  }

  if (req.method === 'POST') {
    seen.post++;
    if (!/merge-duplicates/.test(req.headers.prefer || '')) {
      res.writeHead(409, { ...cors, 'content-type': 'application/json' });
      return res.end(JSON.stringify({ message: 'duplicate key value violates unique constraint' }));
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    for (const row of JSON.parse(body)) table.set(`${row.site}|${row.part}`, row);
    res.writeHead(201, { ...cors, 'content-type': 'application/json' });
    return res.end('');
  }

  res.writeHead(405, cors); res.end();
});
await new Promise((r) => cloudServer.listen(0, r));
const cloudBase = `http://127.0.0.1:${cloudServer.address().port}`;
step(`mock cloud on ${cloudBase}`);

/* ---------- two devices ---------- */

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

const errors = [];
async function device(name, viewport) {
  // A separate context is a separate localStorage — a genuinely different
  // device, not the same one twice.
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  // The last check deliberately sends a wrong key, so its 401 is the test
  // working rather than the app failing.
  page.on('console', (m) => {
    if (m.type() === 'error' && !/401 \(Unauthorized\)/.test(m.text())) {
      errors.push(`${name} console: ${m.text()}`);
    }
  });
  await page.goto(appBase + '/index.html');
  await page.waitForSelector('header.top');
  await page.evaluate((who) => import('/js/store.js').then((m) => {
    m.state.people.push(who);
    m.state.settings.me = who;
    m.save();
  }), name);
  return page;
}

const pc = await device('Abhay', { width: 1440, height: 950 });
const phone = await device('Sam', { width: 390, height: 844 });
step('two devices booted with separate storage');

const connect = (page) => page.evaluate(
  ([url, key]) => import('/js/store.js').then((m) => m.connectCloud({ url, key, site: 'cutting' })),
  [cloudBase, KEY]);

/* ---------- the PC imports and works ---------- */

await pc.click('nav.tabs button:has-text("Setup")');
await pc.waitForSelector('.drop');
for (const [label, file] of [['Rolling workbook', ROLLING], ['CNC workbook', CNC]]) {
  const ch = pc.waitForEvent('filechooser');
  await pc.click(`.drop:has-text("${label}") button`);
  await (await ch).setFiles(file);
  await pc.waitForSelector('dialog .stat', { timeout: 120000 });
  await pc.click('dialog header button');
  await pc.waitForSelector('dialog', { state: 'detached' });
}
step('PC imported both workbooks');

step('PC connected to: ' + await connect(pc));

// A status, a rush and a note — one of each kind of overlay.
const pcWork = await pc.evaluate(() => import('/js/model.js').then(async (m) => {
  const s = await import('/js/store.js');
  const row = m.tasksForMachine('roll-auto').find((r) => r.status.key === 'NOT_STARTED');
  const key = m.taskStatusKey(row.task);
  s.setTaskStatus(key, 'IN_PROGRESS');
  s.setRush(key, { on: true, needBy: '2026-08-20', assignee: 'Sam', reason: 'Shipping gate Friday.' });
  s.setTaskNote(key, 'Bars staged at the saw.');
  return { key, wo: row.task.wo };
}));
step(`PC set status + rush + note on ${pcWork.wo}`);

// Wait for the debounced push rather than forcing one, so the debounce is
// part of what is being tested.
await pc.waitForFunction(() => import('/js/store.js').then((m) => !!m.cloudStatus().at));
await pc.waitForTimeout(3000);
step(`cloud now holds: ${[...table.keys()].join(', ')}`);
if (!table.has('cutting|base')) throw new Error('the imported workbooks never reached the cloud');
if (!table.has('cutting|work')) throw new Error('the work overlay never reached the cloud');

const sizes = Object.fromEntries([...table.entries()].map(
  ([k, v]) => [k, Math.round(JSON.stringify(v.data).length / 1024) + ' KB']));
step('document sizes: ' + JSON.stringify(sizes));
// The whole point of splitting them: `work` is what gets pushed on every tap.
const workKb = JSON.stringify(table.get('cutting|work').data).length / 1024;
const baseKb = JSON.stringify(table.get('cutting|base').data).length / 1024;
if (workKb > baseKb / 5) {
  throw new Error(`work document is not meaningfully smaller than base (${workKb} vs ${baseKb} KB)`);
}
if (table.get('cutting|work').data.tasks !== undefined) {
  throw new Error('the work document is carrying the imported tasks');
}

/* ---------- the phone picks it all up ---------- */

step('phone connected to: ' + await connect(phone));

const onPhone = await phone.evaluate((key) => import('/js/store.js').then((s) =>
  import('/js/model.js').then((m) => ({
    tasks: s.state.tasks.length,
    status: s.state.taskStatus[key]?.status ?? null,
    rush: s.state.rush[key]?.reason ?? null,
    note: s.state.taskNote[key]?.text ?? null,
    rushPage: m.allRush().length,
    who: s.state.taskStatus[key]?.by ?? null,
  }))), pcWork.key);
step('phone sees: ' + JSON.stringify(onPhone));
if (!onPhone.tasks) throw new Error('the phone did not receive the imported schedules');
if (onPhone.status !== 'IN_PROGRESS') throw new Error('status did not reach the phone');
if (!onPhone.rush) throw new Error('rush did not reach the phone');
if (!onPhone.note) throw new Error('note did not reach the phone');
if (onPhone.who !== 'Abhay') throw new Error('the update lost who made it');

// The phone should be able to work without importing anything itself.
await phone.click('nav.tabs button:has-text("Rush")');
await phone.waitForSelector('.rush-line');
const phoneRush = await phone.$eval('.rush-line .mono.strong', (n) => n.textContent.trim());
step('phone Rush page shows: ' + phoneRush);
if (phoneRush !== pcWork.wo) throw new Error('the rushed line is not on the phone Rush page');

/* ---------- both edit, nothing is lost ---------- */

const phoneWork = await phone.evaluate(() => import('/js/model.js').then(async (m) => {
  const s = await import('/js/store.js');
  const row = m.tasksForMachine('roll-man').find((r) => r.status.key === 'NOT_STARTED');
  const key = m.taskStatusKey(row.task);
  s.setTaskStatus(key, 'DONE');
  return { key, wo: row.task.wo };
}));
await phone.waitForTimeout(3500);

// Meanwhile the PC assigns a CNC line — a different record entirely.
const pcAssign = await pc.evaluate(() => import('/js/model.js').then(async (m) => {
  const s = await import('/js/store.js');
  const row = m.tasksForMachine('cncfmc')[0];
  const key = m.taskStatusKey(row.task);
  s.setTaskMachine(key, 'fmc1', 'cncfmc');
  return key;
}));
await pc.waitForTimeout(3500);
await pc.evaluate(() => import('/js/store.js').then((m) => m.pullCloud()));
await phone.evaluate(() => import('/js/store.js').then((m) => m.pullCloud()));
await pc.waitForTimeout(500);

const converged = async (page) => page.evaluate(([a, b, c]) => import('/js/store.js').then((s) => ({
  pcStatus: s.state.taskStatus[a]?.status ?? null,
  phoneStatus: s.state.taskStatus[b]?.status ?? null,
  assign: s.state.taskAssign[c]?.machine ?? null,
})), [pcWork.key, phoneWork.key, pcAssign]);

const onPc = await converged(pc);
const onPhone2 = await converged(phone);
step('PC    after both edited: ' + JSON.stringify(onPc));
step('phone after both edited: ' + JSON.stringify(onPhone2));
if (JSON.stringify(onPc) !== JSON.stringify(onPhone2)) {
  throw new Error('devices did not converge');
}
if (onPc.pcStatus !== 'IN_PROGRESS' || onPc.phoneStatus !== 'DONE' || onPc.assign !== 'fmc1') {
  throw new Error('a concurrent edit was lost: ' + JSON.stringify(onPc));
}

/* ---------- failure is reported, not swallowed ---------- */

const rejected = await phone.evaluate(([url]) => import('/js/cloud.js').then(async (c) => {
  try { await c.cloudTest({ url, key: 'wrong-key' }); return null; }
  catch (e) { return e.message; }
}), [cloudBase]);
step('wrong key says: ' + rejected);
if (!/rejected the key/.test(rejected || '')) throw new Error('a bad key was not explained');
if (!seen.badAuth) throw new Error('the mock never saw the bad key');

step(`mock cloud handled ${seen.get} reads, ${seen.post} writes, ${seen.preflight} preflights`);
if (!seen.preflight) throw new Error('no CORS preflight — the request shape is not what a browser sends');

console.log('\nERRORS:', errors.length ? '\n  ' + errors.join('\n  ') : 'none');
await browser.close();
appServer.close();
cloudServer.close();
process.exit(errors.length ? 1 : 0);
