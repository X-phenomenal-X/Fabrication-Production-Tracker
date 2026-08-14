/* End-to-end smoke test for the minimal Tracker app: serves the app, imports
   the real Rolling and CNC workbooks, walks the Tracker, exercises the
   status-cycle click, confirms it survives a reload AND a re-import, and
   fails on any console error.
   Run: node test/app-check.mjs */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import http from 'http';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = '/root/.claude/uploads/042835a0-704b-5601-bc20-4ed82d27578f';
const ROLLING = `${DIR}/da7bb9f1-Rolling_Schedule_2026.xlsx`;
const CNC = `${DIR}/bae855fd-CNC_Schedule_Rev_E.xlsx`;
const SHOT = path.join(ROOT, 'test', 'screens');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, rel === '/' ? '/index.html' : rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

fs.mkdirSync(SHOT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n     STACK: ' + (e.stack || '').split('\n').slice(0, 4).join(' | ')));

const step = (s) => console.log('  •', s);

await page.goto(base + '/index.html');
await page.waitForSelector('header.top');
step('app booted');

// only two tabs should exist now
const tabs = await page.$$eval('nav.tabs button', (ns) => ns.map((n) => n.textContent.trim()));
step('tabs: ' + tabs.join(', '));
if (tabs.join(',') !== 'Tracker,Setup') throw new Error('expected exactly Tracker, Setup — got ' + tabs.join(','));

// identity
await page.evaluate(() => import('/js/store.js').then((m) => {
  m.state.people.push('Abhay');
  m.state.settings.me = 'Abhay';
  m.save();
}));
step('identity set');

// empty state before any import
await page.waitForSelector('main .empty');
step('empty state shown before import');

// Setup: import Rolling then CNC
await page.click('nav.tabs button:has-text("Setup")');
await page.waitForSelector('.drop');

for (const [label, file] of [['Rolling workbook', ROLLING], ['CNC workbook', CNC]]) {
  const ch = page.waitForEvent('filechooser');
  await page.click(`.drop:has-text("${label}") button`);
  await (await ch).setFiles(file);
  await page.waitForSelector('dialog .stat', { timeout: 120000 });
  const n = await page.$eval('dialog .stat .n', (x) => x.textContent);
  step(`${label}: ${n} tasks`);
  await page.click('dialog header button');
  await page.waitForSelector('dialog', { state: 'detached' });
}

const taskCount = await page.evaluate(() => import('/js/store.js').then((m) => m.state.tasks.length));
step('machine tasks loaded: ' + taskCount);

// Tracker: four group headers with real content
await page.click('nav.tabs button:has-text("Tracker")');
await page.waitForSelector('main h2');
const groups = await page.$$eval('main h2', (ns) => ns.map((n) => n.textContent.trim()));
step('groups shown: ' + groups.join(', '));
if (!['Rolling', 'FOM', 'CNC', 'Punch'].every((g) => groups.includes(g))) {
  throw new Error('expected Rolling, FOM, CNC, Punch — got ' + groups.join(', '));
}

const machineCards = await page.$$eval('main .panel header', (ns) =>
  ns.map((n) => n.childNodes[0]?.textContent?.trim()).filter(Boolean));
step('machine cards: ' + machineCards.join(', '));
await page.screenshot({ path: path.join(SHOT, 'tracker.png'), fullPage: true });

// Pick a specific Not-started line to click, rather than "whatever renders
// first" — a click that lands on Done disappears from view by design (Done
// is hidden by default), so grabbing "the first chip" again afterwards can
// silently land on an unrelated row that happens to read the same label.
const target = await page.evaluate(async () => {
  const model = await import('/js/model.js');
  const row = model.tasksForMachine('roll-auto').find((r) => r.status.key === 'NOT_STARTED');
  return row ? { wo: row.task.wo, die: row.task.die || '' } : null;
});
if (!target) throw new Error('no Not-started line found on Rolling (Auto) to test with');
step('target line: W/O ' + target.wo + ' die ' + (target.die || '(none)'));

const panel = page.locator('.panel', { hasText: 'Rolling (Auto)' }).first();
const row = panel.locator('table tbody tr')
  .filter({ hasText: target.wo }).filter({ hasText: target.die || '—' }).first();
const chipBtn = row.locator('.chip').first();
const before = (await chipBtn.textContent()).trim();
await chipBtn.click();
await page.waitForTimeout(250);
const after = (await row.locator('.chip').first().textContent()).trim();
step(`status cycled: "${before}" -> "${after}"`);
if (before === after) throw new Error('status chip did not change on click');
if (after !== 'In Progress') throw new Error(`expected "In Progress", got "${after}"`);

const clicked = {
  key: `roll-auto|${target.wo}|${target.die}`,
  val: await page.evaluate((k) => import('/js/store.js').then((m) => m.state.taskStatus[k]),
    `roll-auto|${target.wo}|${target.die}`),
};
step('stored status: ' + JSON.stringify(clicked));
if (!clicked.val) throw new Error('no taskStatus was recorded for the clicked line');

// reload -> status survives
await page.reload();
await page.waitForSelector('header.top');
const afterReload = await page.evaluate((key) => import('/js/store.js').then((m) => m.state.taskStatus[key]), clicked.key);
step('status after reload: ' + JSON.stringify(afterReload));
if (!afterReload || afterReload.status !== clicked.val.status) throw new Error('status did not survive reload');

// re-import Rolling -> status must survive (proves the stable key, not row number)
await page.click('nav.tabs button:has-text("Setup")');
await page.waitForSelector('.drop');
const ch2 = page.waitForEvent('filechooser');
await page.click('.drop:has-text("Rolling workbook") button');
await (await ch2).setFiles(ROLLING);
await page.waitForSelector('dialog .stat', { timeout: 120000 });
await page.click('dialog header button');
await page.waitForSelector('dialog', { state: 'detached' });

const afterReimport = await page.evaluate((key) => import('/js/store.js').then((m) => m.state.taskStatus[key]), clicked.key);
step('status after re-import: ' + JSON.stringify(afterReimport));
if (!afterReimport || afterReimport.status !== clicked.val.status) {
  throw new Error('status was lost on re-import — stable key is not working');
}

// phone layout
await page.click('nav.tabs button:has-text("Tracker")');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(SHOT, 'tracker-phone.png'), fullPage: true });
step('phone layout captured');

console.log('\nERRORS:', errors.length ? '\n  ' + errors.join('\n  ') : 'none');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
