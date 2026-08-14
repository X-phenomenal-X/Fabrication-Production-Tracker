/* End-to-end smoke test: serves the app, imports the Rolling and CNC
   workbooks, walks all four work-centre pages, exercises sub-tabs, date
   groups and the status click, confirms a status survives both a reload and
   a re-import, and asserts the old data is gone.
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

const RETIRED = ['orders', 'wip', 'prep', 'screens', 'progress', 'material', 'history',
  'manualOrders', 'shiftLogs', 'plan', 'guide', 'audit'];

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

const tabs = await page.$$eval('nav.tabs button', (ns) => ns.map((n) => n.textContent.trim()));
step('tabs: ' + tabs.join(', '));
if (tabs.join(',') !== 'Rolling,FOM,CNC,Multi Punch,Setup') {
  throw new Error('unexpected nav: ' + tabs.join(','));
}

// identity
await page.evaluate(() => import('/js/store.js').then((m) => {
  m.state.people.push('Abhay');
  m.state.settings.me = 'Abhay';
  m.save();
}));
step('identity set');

// no old data seeded on boot
const seeded = await page.evaluate((retired) => import('/js/store.js').then((m) => {
  const raw = localStorage.getItem('bv.cutting.v1');
  const stored = raw ? JSON.parse(raw) : {};
  return {
    inState: retired.filter((k) => m.state[k] !== undefined),
    inStorage: retired.filter((k) => stored[k] !== undefined),
  };
}), RETIRED);
step('retired keys — in state: ' + (seeded.inState.join(',') || 'none') +
  ' | in storage: ' + (seeded.inStorage.join(',') || 'none'));
if (seeded.inState.length || seeded.inStorage.length) throw new Error('old data is still present');

// import both workbooks
await page.click('nav.tabs button:has-text("Setup")');
await page.waitForSelector('.drop');
for (const [label, file] of [['Rolling workbook', ROLLING], ['CNC workbook', CNC]]) {
  const ch = page.waitForEvent('filechooser');
  await page.click(`.drop:has-text("${label}") button`);
  await (await ch).setFiles(file);
  await page.waitForSelector('dialog .stat', { timeout: 120000 });
  const n = await page.$eval('dialog .stat .n', (x) => x.textContent);
  step(`${label}: ${n} lines`);
  await page.click('dialog header button');
  await page.waitForSelector('dialog', { state: 'detached' });
}
await page.screenshot({ path: path.join(SHOT, 'setup.png'), fullPage: true });

// walk every centre page
for (const [tab, expectSubtabs, expectTitle] of [
  ['Rolling', 2, 'Rolling (Auto)'], ['FOM', 3, 'FOM 1'],
  ['CNC', 4, 'CNC 1'], ['Multi Punch', 0, 'Multi Punch'],
]) {
  await page.click(`nav.tabs button:has-text("${tab}")`);
  // Rendering is deferred to the next frame, so the previous page's title is
  // still in the DOM the instant after the click — wait for the new one.
  await page.waitForFunction(
    (t) => document.querySelector('.centre-title')?.textContent.trim() === t, expectTitle);
  const title = await page.$eval('.centre-title', (n) => n.textContent.trim());
  const subtabs = await page.$$eval('.subtabs button', (ns) => ns.map((n) => n.textContent.trim()));
  const groups = await page.$$eval('.dgroup-label', (ns) => ns.map((n) => n.textContent.trim()));
  const stats = await page.$$eval('.cstat', (ns) =>
    ns.map((n) => n.querySelector('i').textContent + '=' + n.querySelector('b').textContent));
  step(`${tab}: "${title}" | subtabs [${subtabs.join(' ')}] | groups [${groups.join(' ')}] | ${stats.join(' ')}`);
  if (subtabs.length !== expectSubtabs) {
    throw new Error(`${tab}: expected ${expectSubtabs} sub-tabs, got ${subtabs.length}`);
  }
  await page.screenshot({ path: path.join(SHOT, `centre-${tab.replace(/\s+/g, '-').toLowerCase()}.png`), fullPage: true });
}

// the CNC workbook's Shift Update sheet is parsed and surfaced
const su = await page.evaluate(() => import('/js/store.js').then((m) => {
  const s = m.state.shiftUpdate;
  return s ? { date: s.date, shift: s.shift, machines: Object.keys(s.machines) } : null;
}));
step('shift update: ' + JSON.stringify(su));
if (!su || !su.machines.length) throw new Error('Shift Update sheet was not parsed');
for (const k of ['roll-auto', 'fom1', 'cnc1', 'multipunch']) {
  if (!su.machines.includes(k)) throw new Error(`shift update missing ${k}`);
}
const suPanel = await page.$$eval('.su-title', (ns) => ns.length);
step('shift update panel rendered on this page: ' + (suPanel ? 'yes' : 'no'));

// sub-tab switching actually changes the queue
await page.click('nav.tabs button:has-text("FOM")');
await page.waitForSelector('.centre-title');
const fom1 = await page.$eval('.centre-title', (n) => n.textContent.trim());
await page.click('.subtabs button:has-text("FOM 3")');
await page.waitForTimeout(200);
const fom3 = await page.$eval('.centre-title', (n) => n.textContent.trim());
step(`sub-tab switch: ${fom1} -> ${fom3}`);
if (fom1 === fom3) throw new Error('sub-tab did not switch machine');

// status click on Rolling
await page.click('nav.tabs button:has-text("Rolling")');
await page.waitForSelector('.centre-title');
const target = await page.evaluate(async () => {
  const model = await import('/js/model.js');
  const row = model.tasksForMachine('roll-auto').find((r) => r.status.key === 'NOT_STARTED');
  return row ? { wo: row.task.wo, die: row.task.die || '' } : null;
});
if (!target) throw new Error('no Not-started line on Rolling (Auto) to test with');
step(`target line: W/O ${target.wo} die ${target.die || '(none)'}`);

// expand every group so the target is reachable regardless of bucket
await page.$$eval('.dgroup-head[aria-expanded="false"]', (ns) => ns.forEach((n) => n.click()));
await page.waitForTimeout(250);
await page.$$eval('.showmore', (ns) => ns.forEach((n) => n.click()));
await page.waitForTimeout(250);

const line = page.locator('.line').filter({ hasText: target.wo })
  .filter({ hasText: target.die || '—' }).first();
const activeTitle = () => line.locator('.seg-btn[aria-pressed="true"]').getAttribute('title');
const before = await activeTitle();
// Explicit three-way control: pick the state directly rather than cycling.
await line.locator('.seg-btn[title="In Progress"]').click();
await page.waitForTimeout(250);
const after = await activeTitle();
step(`status set: "${before}" -> "${after}"`);
if (after !== 'In Progress') throw new Error(`expected "In Progress", got "${after}"`);

// undo restores it
const undo = page.locator('.toast-action button');
if (await undo.count()) {
  await undo.click();
  await page.waitForTimeout(250);
  step('undo restored: "' + (await activeTitle()) + '"');
  await line.locator('.seg-btn[title="In Progress"]').click();
  await page.waitForTimeout(250);
}

const key = `roll-auto|${target.wo}|${target.die}`;
const stored = await page.evaluate((k) => import('/js/store.js').then((m) => m.state.taskStatus[k]), key);
step('stored: ' + JSON.stringify(stored));
if (!stored) throw new Error('status was not recorded');

// survives reload
await page.reload();
await page.waitForSelector('header.top');
const afterReload = await page.evaluate((k) => import('/js/store.js').then((m) => m.state.taskStatus[k]), key);
step('after reload: ' + JSON.stringify(afterReload));
if (afterReload?.status !== stored.status) throw new Error('status did not survive reload');

// survives re-import (the stable-key guarantee)
await page.click('nav.tabs button:has-text("Setup")');
await page.waitForSelector('.drop');
const ch2 = page.waitForEvent('filechooser');
await page.click('.drop:has-text("Rolling workbook") button');
await (await ch2).setFiles(ROLLING);
await page.waitForSelector('dialog .stat', { timeout: 120000 });
await page.click('dialog header button');
await page.waitForSelector('dialog', { state: 'detached' });
const afterReimport = await page.evaluate((k) => import('/js/store.js').then((m) => m.state.taskStatus[k]), key);
step('after re-import: ' + JSON.stringify(afterReimport));
if (afterReimport?.status !== stored.status) throw new Error('status lost on re-import — stable key broken');

// bulk select + apply — the re-import check left us on Setup
await page.click('nav.tabs button:has-text("Rolling")');
await page.waitForFunction(() => document.querySelector('.centre-title')?.textContent.trim() === 'Rolling (Auto)');
await page.$$eval('.dgroup-pick', (ns) => ns[0]?.click());
await page.waitForTimeout(250);
const bulkCount = await page.locator('.bulk-count').textContent().catch(() => null);
step('bulk bar: ' + (bulkCount || 'not shown'));
if (!bulkCount) throw new Error('bulk bar did not appear after Select all');
await page.locator('.bulk-btn', { hasText: 'Done' }).click();
await page.waitForTimeout(300);
const bulkApplied = await page.evaluate(() => import('/js/store.js').then((m) =>
  Object.values(m.state.taskStatus).filter((v) => v.status === 'DONE').length));
step('lines set to Done in bulk: ' + bulkApplied);
if (bulkApplied < 2) throw new Error('bulk apply did not take');
await page.locator('.toast-action button').click();   // undo the bulk change
await page.waitForTimeout(300);
step('bulk undone');

// a note can be added to a line
await page.locator('.line-iconbtn[title="Add a note"]').first().click();
await page.waitForSelector('dialog textarea');
await page.fill('dialog textarea', 'Waiting on 3 bars from the mill.');
await page.click('dialog footer button.primary');
await page.waitForTimeout(250);
const noteCount = await page.evaluate(() => import('/js/store.js').then((m) =>
  Object.keys(m.state.taskNote).length));
step('notes stored: ' + noteCount);
if (!noteCount) throw new Error('note was not saved');

// a line can be edited, and the edit is recorded with who and when
const editLine = page.locator('.line').first();
const woEdited = (await editLine.locator('.line-id .mono').textContent()).trim();
await editLine.locator('.line-iconbtn[title="Edit this line and see its history"]').click();
await page.waitForSelector('dialog .editfield input');
await (await page.$('dialog')).screenshot({ path: path.join(SHOT, 'edit-dialog-before.png') });
const qtyInput = page.locator('dialog .editfield').filter({ hasText: 'Qty' }).locator('input');
const qtyBefore = await qtyInput.inputValue();
await qtyInput.fill(String(Number(qtyBefore || 0) + 5));
await page.click('dialog footer button.primary');
await page.waitForTimeout(300);
const edits = await page.evaluate(() => import('/js/store.js').then((m) => ({
  edits: Object.entries(m.state.taskEdit).map(([k, v]) => ({ k, f: v.fields, by: v.by })),
  hist: m.state.taskHistory.filter((h) => h.kind === 'field').length,
})));
step(`edited ${woEdited} qty ${qtyBefore} -> +5 · overrides=${edits.edits.length} field-history=${edits.hist}`);
if (!edits.edits.length) throw new Error('edit override was not stored');
if (!edits.hist) throw new Error('field change was not recorded in history');

// the edit shows on the line and survives a re-import
const editedBadge = await page.locator('.line').first().locator('.badge-edited').count();
step('edited badge on line: ' + (editedBadge ? 'yes' : 'no'));
if (!editedBadge) throw new Error('edited badge not shown');

// reopen to capture the history trail
await page.locator('.line').first().locator('.line-iconbtn[title="Edit this line and see its history"]').click();
await page.waitForSelector('dialog .hist');
const histRows = await page.$$eval('dialog .hist li', (n) => n.length);
step('history entries shown on the line: ' + histRows);
await (await page.$('dialog')).screenshot({ path: path.join(SHOT, 'edit-dialog.png') });
await page.click('dialog header button');
await page.waitForSelector('dialog', { state: 'detached' });

await page.click('nav.tabs button:has-text("Setup")');
await page.waitForSelector('.drop');
const ch3 = page.waitForEvent('filechooser');
await page.click('.drop:has-text("Rolling workbook") button');
await (await ch3).setFiles(ROLLING);
await page.waitForSelector('dialog .stat', { timeout: 120000 });
await page.click('dialog header button');
await page.waitForSelector('dialog', { state: 'detached' });
const editsAfter = await page.evaluate(() => import('/js/store.js').then((m) =>
  Object.keys(m.state.taskEdit).length));
step('edit overrides after re-import: ' + editsAfter);
if (!editsAfter) throw new Error('edits lost on re-import');
await page.click('nav.tabs button:has-text("Rolling")');
await page.waitForFunction(() => document.querySelector('.centre-title'));

// machine can be renamed
await page.locator('.iconbtn').first().click();
await page.waitForSelector('dialog input');
await page.fill('dialog input', 'Etas Line 1');
await page.click('dialog footer button.primary');
await page.waitForFunction(() => document.querySelector('.centre-title')?.textContent.trim() === 'Etas Line 1');
step('machine renamed to: ' + await page.$eval('.centre-title', (n) => n.textContent.trim()));

// phone
await page.click('nav.tabs button:has-text("Rolling")');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(SHOT, 'centre-phone.png'), fullPage: true });
step('phone layout captured');

console.log('\nERRORS:', errors.length ? '\n  ' + errors.join('\n  ') : 'none');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
