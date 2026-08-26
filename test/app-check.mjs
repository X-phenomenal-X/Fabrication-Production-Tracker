/* End-to-end smoke test: serves the app, imports the Rolling and CNC
   workbooks, walks all four work-centre pages, exercises sub-tabs, date
   groups and the status click, confirms a status survives both a reload and
   a re-import, and asserts the old data is gone.
   Run: node test/app-check.mjs */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { ROOT, workbookPaths, chromiumOptions } from './env.mjs';

const books = workbookPaths();
const ROLLING = books.rolling;
const CNC = books.cnc;
const SHOT = path.join(ROOT, 'test', 'screens');

const RETIRED = ['orders', 'wip', 'prep', 'screens', 'progress', 'material', 'history',
  'manualOrders', 'plan', 'guide', 'audit'];

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

const browser = await chromium.launch(chromiumOptions());
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

const errors = [];
// The cloud check deliberately points at an unreachable host, so its network
// failure is expected noise rather than a fault in the app.
const EXPECTED = /ERR_TUNNEL_CONNECTION_FAILED|example\.invalid|ERR_NAME_NOT_RESOLVED/;
page.on('console', (m) => {
  if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n     STACK: ' + (e.stack || '').split('\n').slice(0, 4).join(' | ')));

const step = (s) => console.log('  •', s);

/* Rendering is deferred to the next frame, so the click alone proves nothing.
   Waiting on the nav rather than the page title, because a machine that has
   been renamed no longer has the title the test started with — and on the
   tab's aria-label rather than its text, because a tool tab's text now also
   carries a short label and an outstanding-count badge. */
const gotoTab = async (name) => {
  // Setup is the gear beside the name picker, not a nav button, so both are
  // matched on their stated accessible name anywhere in the header.
  await page.click(`header.top [aria-label="${name}"]`);
  await page.waitForFunction(
    (n) => document.querySelector('header.top [aria-current="true"]')?.getAttribute('aria-label') === n,
    name);
  await page.waitForTimeout(120);
};

await page.goto(base + '/index.html');
await page.waitForSelector('header.top');
step('app booted');

// The nav carries a long and a short label per tool and shows one by width, so
// read the tab's stated accessible name rather than its concatenated text.
const tabs = await page.$$eval('nav.tabs button', (ns) =>
  ns.map((n) => (n.getAttribute('aria-label') || n.textContent).trim()));
step('tabs: ' + tabs.join(', '));
// Setup is deliberately not one of them — it is the gear beside the name
// picker, because configuration is not a peer of the pages people work on.
const setupGear = await page.$$eval('.hdr-setup', (ns) => ns.map((n) => n.getAttribute('aria-label')));
step('setup control: ' + JSON.stringify(setupGear));
if (setupGear.length !== 1) throw new Error('Setup is not reachable from the header');
if (tabs.join(',') !== 'Overview,Rolling,FOM,CNC & FMC,Multi Punch,Today,Staging,Rush,Back Orders,Die Lookup,Extrusions,Shift Update') {
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
await page.click('.hdr-setup');
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

// The cover is an operational briefing, not a decorative landing page: it
// must expose real work and every shortcut must remain a full-size control.
await gotoTab('Overview');
await page.waitForSelector('.overview');
const overview = await page.evaluate(() => ({
  bands: document.querySelectorAll('.overview-band').length,
  quickStarts: document.querySelectorAll('.overview-quick').length,
  hasPriority: !!document.querySelector('.overview-open'),
}));
step('overview: ' + JSON.stringify(overview));
if (overview.bands !== 3 || overview.quickStarts !== 4 || !overview.hasPriority) {
  throw new Error('overview briefing is incomplete: ' + JSON.stringify(overview));
}

// walk every centre page
for (const [tab, expectSubtabs, expectTitle] of [
  ['Rolling', 2, 'Rolling (Auto)'], ['FOM', 3, 'FOM 1'],
  ['CNC & FMC', 4, 'Unassigned'], ['Multi Punch', 2, 'Multi Punch'],
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

/* The sheet is chosen by its exact name, `Shift Update`. The workbook holds
   four similarly named tabs and the other three are archives that must never
   be reached for, not even as a fallback when the live one looks thin:

     Shift Update      Afternoon   7 machines   <- the live one
     Shift Update 2    Day         9 machines
     Shift Update (3)  Afternoon   7 machines
     Shift Update Old  -           7 machines

   `Shift Update 2` is the trap. It is the fullest sheet — it is the only one
   carrying FMC 1 and FMC 2 — so any rule that prefers the sheet with the most
   on it, or the one with the most machines, lands there and quietly serves an
   earlier shift. Later shift, fewer machines: the app reports what the live
   sheet says, including what it does not mention. */
for (const k of ['roll-auto', 'roll-man', 'fom1', 'fom2', 'fom3', 'cnc1', 'multipunch']) {
  if (!su.machines.includes(k)) throw new Error(`shift update missing ${k}`);
}
if (su.shift !== 'Afternoon') {
  throw new Error(`shift update should be the live sheet's Afternoon block, got ${su.shift}`
    + ' — reading Shift Update 2 gives Day');
}
for (const k of ['cnc2', 'cnc3', 'cnc140']) {
  if (su.machines.includes(k)) throw new Error(`${k} should no longer be a machine`);
}
// Every tracked machine must carry actual reported work, not just exist as a
// key. cnc1 previously passed the presence check above while being completely
// empty: the live block calls it "CNC-3" and the app was falling back to a
// blank "CNC 1" placeholder in the stale block at the top of the same sheet.
const suContent = await page.evaluate(() => import('/js/store.js').then((m) =>
  Object.fromEntries(Object.entries(m.state.shiftUpdate.machines).map(([k, e]) =>
    [k, { label: e.label, said: e.done.length + e.next.length + e.notes.length }]))));
const suEmpty = Object.entries(suContent).filter(([, v]) => v.said === 0).map(([k]) => k);
step('shift-update content per machine: ' + Object.entries(suContent)
  .map(([k, v]) => `${k}(${v.label})=${v.said}`).join(' '));
if (suEmpty.length) throw new Error('machines with an empty shift-update entry: ' + suEmpty.join(', '));

// It must come from the exact live tab the department uses in Excel — the
// other similarly named shift-update sheets are archived and never fallbacks.
const suSrc = await page.evaluate(() => import('/js/store.js').then(
  (m) => m.state.machineMeta?.cnc && m.state.shiftUpdate));
if (!suSrc) throw new Error('no shift update parsed');

/* A machine the live sheet does not mention has no update, and the app has to
   say so rather than dress up a stale one. FMC 1 and FMC 2 are exactly that
   case: real machines that only the archived `Shift Update 2` writes about. */
const suWhen = await page.evaluate(() => import('/js/model.js').then((m) => {
  const one = (k) => {
    const e = m.shiftUpdateFor(k);
    return e ? `${e.date} ${e.shift} (${e.source})` : null;
  };
  return { fom1: one('fom1'), fmc1: one('fmc1'), fmc2: one('fmc2') };
}));
step('per-machine shift-update source: ' + JSON.stringify(suWhen));
if (!suWhen.fom1) throw new Error('FOM 1 is on the live sheet and must have an update');
if (suWhen.fmc1 || suWhen.fmc2) {
  throw new Error('FMC 1/2 are not on the live Shift Update sheet, so they must report '
    + `no update rather than one from an archived tab — got ${suWhen.fmc1}`);
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
// The desktop command layout keeps the queue dense and puts the large status
// control in the selected-line inspector. Open the stable target line first;
// phone widths still carry the same control on each row.
await line.locator('.line-open').click();
await page.waitForSelector('.line-inspector');
const inspector = page.locator('.line-inspector');
const activeTitle = () => inspector.locator('.seg-btn[aria-pressed="true"]').getAttribute('title');
const before = await activeTitle();
// Explicit three-way control: pick the state directly rather than cycling.
await inspector.locator('.seg-btn[title="In Progress"]').click();
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
  await inspector.locator('.seg-btn[title="In Progress"]').click();
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
await page.click('.hdr-setup');
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

// "running now" panel — the target line is still In Progress at this point
await page.waitForSelector('.nowrun');
const nowRunShown = await page.$$eval('.nowrun-line', (ns) => ns.map((n) => n.querySelector('.mono.strong')?.textContent.trim()));
const nowRunCount = await page.$eval('.nowrun-count', (n) => n.textContent.trim());
step(`running now on Rolling (Auto): ${nowRunCount} total, ${nowRunShown.length} shown, e.g. ${nowRunShown.slice(0, 4).join(', ')}…`);
if (Number(nowRunCount) <= nowRunShown.length) throw new Error('expected the running-now panel to cap and offer Show more on a busy machine');
await page.screenshot({ path: path.join(SHOT, 'now-running.png') });

// Show more reveals every running line, including the target if it was
// capped out of the initial handful
await page.click('.nowrun .showmore');
await page.waitForTimeout(200);
const nowRunAll = await page.$$eval('.nowrun-line', (ns) => ns.map((n) => n.querySelector('.mono.strong')?.textContent.trim()));
if (!nowRunAll.includes(target.wo)) throw new Error('In-progress line missing from the running-now panel even expanded');
if (nowRunAll.length !== Number(nowRunCount)) throw new Error('Show more did not reveal every running line');

// its quick Done button works the same as the line's own status control
await page.locator('.nowrun-line').filter({ hasText: target.wo })
  .filter({ hasText: target.die || '—' }).first().locator('.nowrun-done').click();
await page.waitForTimeout(250);
const doneNow = await page.evaluate((k) => import('/js/store.js').then((m) => m.state.taskStatus[k]?.status), key);
step('quick Done from running-now panel: ' + doneNow);
if (doneNow !== 'DONE') throw new Error('running-now Done button did not update the line');
// undo it so the rest of the suite finds the line where it expects it
const nowRunUndo = page.locator('.toast-action button');
if (await nowRunUndo.count()) await nowRunUndo.click();
await page.waitForTimeout(250);

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
await inspector.getByRole('button', { name: /^(Note|Edit note)$/ }).click();
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
await editLine.locator('.line-open').click();
await inspector.getByRole('button', { name: 'Edit', exact: true }).click();
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
await inspector.getByRole('button', { name: 'History', exact: true }).click();
await page.waitForSelector('dialog .hist');
const histRows = await page.$$eval('dialog .hist li', (n) => n.length);
step('history entries shown on the line: ' + histRows);
await (await page.$('dialog')).screenshot({ path: path.join(SHOT, 'edit-dialog.png') });
await page.click('dialog header button');
await page.waitForSelector('dialog', { state: 'detached' });

await page.click('.hdr-setup');
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

// machine can be renamed. Scoped to the centre header: the Setup gear is an
// .iconbtn too, and it comes first in the document.
await page.locator('.centre-head .iconbtn').first().click();
await page.waitForSelector('dialog input');
await page.fill('dialog input', 'Etas Line 1');
await page.click('dialog footer button.primary');
await page.waitForFunction(() => document.querySelector('.centre-title')?.textContent.trim() === 'Etas Line 1');
step('machine renamed to: ' + await page.$eval('.centre-title', (n) => n.textContent.trim()));

// back order: flag a line, set pieces, assign it, note it
await page.click('nav.tabs button:has-text("Rolling")');
await page.waitForFunction(() => document.querySelector('.centre-title'));
const boLine = page.locator('.line').first();
const boWo = (await boLine.locator('.line-id .mono').textContent()).trim();
await boLine.locator('.line-open').click();
await inspector.getByRole('button', { name: 'Back order', exact: true }).click();
await page.waitForSelector('dialog .bo-flagrow');
const flagBox = page.locator('dialog .bo-flagrow input');
if (!(await flagBox.isChecked())) await flagBox.check();
await page.locator('dialog .field').filter({ hasText: 'Pieces short' }).locator('input').fill('12');
await page.selectOption('dialog select', 'Abhay');
await page.fill('dialog textarea', 'Mill ETA 8/24 — chasing.');
await page.click('dialog footer button.primary');
await page.waitForTimeout(300);

const boRec = await page.evaluate(() => import('/js/store.js').then((m) => {
  const e = Object.entries(m.state.backOrder)[0];
  return e ? { key: e[0], ...e[1] } : null;
}));
step('back order stored: ' + JSON.stringify(boRec));
if (!boRec || boRec.qty !== 12 || boRec.assignee !== 'Abhay') throw new Error('back order not stored correctly');

const boHist = await page.evaluate(() => import('/js/store.js').then((m) =>
  m.state.taskHistory.filter((h) => h.kind === 'backorder').length));
step('back order history entries: ' + boHist);
if (!boHist) throw new Error('back order changes were not recorded in history');

const badge = (await page.locator('.line').filter({ hasText: boWo }).first()
  .locator('.badge-bo').first().textContent()).trim();
step('line badge: ' + badge);
if (!badge.includes('12')) throw new Error('badge does not show the piece count');
await (await page.$('.line')).screenshot({ path: path.join(SHOT, 'bo-line.png') });

// the Back Orders page lists it under the right person
await page.click('nav.tabs button:has-text("Back Orders")');
await page.waitForSelector('.bo-who');
const owners = await page.$$eval('.bo-who', (ns) => ns.map((n) => n.textContent.trim()));
const boStats = await page.$$eval('.cstat', (ns) =>
  ns.map((n) => n.querySelector('i').textContent + '=' + n.querySelector('b').textContent));
step('back orders page — owners: ' + owners.join(', ') + ' | ' + boStats.join(' '));
if (!owners.includes('Abhay')) throw new Error('assignee group missing from Back Orders page');
await page.screenshot({ path: path.join(SHOT, 'backorders.png'), fullPage: true });

// tri-state: clearing a sheet-reported shortage drops it from the count
const beforeClear = await page.$$eval('.bo-line', (n) => n.length);
const sheetFlagged = page.locator('.bo-line').filter({ hasNotText: 'Abhay' }).first();
if (await sheetFlagged.count()) {
  await sheetFlagged.click();
  await page.waitForSelector('dialog .bo-flagrow');
  await page.locator('dialog .bo-flagrow input').uncheck();
  await page.click('dialog footer button.primary');
  await page.waitForTimeout(300);
  const afterClear = await page.$$eval('.bo-line', (n) => n.length);
  step(`tri-state clear: ${beforeClear} -> ${afterClear} lines`);
  if (afterClear >= beforeClear) throw new Error('unflagging a sheet-reported shortage did not remove it');
}

// back order survives re-import
await page.click('.hdr-setup');
await page.waitForSelector('.drop');
const ch4 = page.waitForEvent('filechooser');
await page.click('.drop:has-text("Rolling workbook") button');
await (await ch4).setFiles(ROLLING);
await page.waitForSelector('dialog .stat', { timeout: 120000 });
await page.click('dialog header button');
await page.waitForSelector('dialog', { state: 'detached' });
const boAfter = await page.evaluate((k) => import('/js/store.js').then((m) => m.state.backOrder[k]), boRec.key);
step('back order after re-import: ' + JSON.stringify(boAfter));
if (!boAfter || boAfter.qty !== 12) throw new Error('back order lost on re-import');

// ---------- rush ----------
await gotoTab('Rolling');
await page.$$eval('.dgroup-head[aria-expanded="false"]', (ns) => ns.forEach((n) => n.click()));
await page.waitForTimeout(200);

const rushWo = await page.$eval('.line .mono.strong', (n) => n.textContent.trim());
const rushLine = page.locator('.line').filter({ hasText: rushWo }).first();
await rushLine.locator('.line-open').click();
await inspector.getByRole('button', { name: 'Rush', exact: true }).click();
await page.waitForSelector('dialog .rush-flagrow');
await page.locator('dialog .rush-flagrow input').check();
// The needed-by date is the whole point: a shipping gate that beats the sheet.
const gate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
await page.locator('dialog input[type="date"]').fill(gate);
await page.selectOption('dialog select', 'Abhay');
await page.locator('dialog textarea').fill('Shipping gate moved up — trailer Friday.');
await page.click('dialog footer button.primary');
await page.waitForTimeout(300);

const rushRec = await page.evaluate(() => import('/js/store.js').then((m) => {
  const k = Object.keys(m.state.rush)[0];
  return { key: k, ...m.state.rush[k] };
}));
step('rush stored: ' + JSON.stringify(rushRec));
if (!rushRec.on || rushRec.assignee !== 'Abhay') throw new Error('rush record not saved');
if (!rushRec.needBy) throw new Error('needed-by date not saved');

// a rush line sorts above everything else on its machine, whatever its date
const firstWo = await page.$eval('.line .mono.strong', (n) => n.textContent.trim());
step(`first line on the machine: ${firstWo} (rushed ${rushWo})`);
if (firstWo !== rushWo) throw new Error('rush line did not sort to the top');

const rushBadge = await page.locator('.line').filter({ hasText: rushWo }).first()
  .locator('.badge-rush').first().textContent();
step('rush badge: ' + rushBadge.trim());
if (!rushBadge.includes('RUSH')) throw new Error('rush badge missing');

const rushHist = await page.evaluate((k) => import('/js/store.js').then(
  (m) => m.state.taskHistory.filter((h) => h.key === k && h.kind === 'rush').length), rushRec.key);
step('rush history entries: ' + rushHist);
if (!rushHist) throw new Error('rush changes were not recorded in history');

await gotoTab('Rush');
await page.waitForSelector('.rush-line');
const rushBuckets = await page.$$eval('.dgroup-label', (ns) => ns.map((n) => n.textContent.trim()));
const rushCount = await page.$$eval('.rush-line', (ns) => ns.length);
step(`rush page — buckets [${rushBuckets.join(' | ')}] · ${rushCount} lines`);
if (!rushBuckets.includes('Past its date')) throw new Error('a past-date rush should bucket as late');
await page.screenshot({ path: path.join(SHOT, 'rush.png'), fullPage: true });

// ---------- CNC & FMC: shared queue, assigned by hand ----------
await gotoTab('CNC & FMC');
await page.waitForSelector('.subtabs button');
const cncTabs = await page.$$eval('.subtabs button', (ns) => ns.map((n) => n.textContent.trim()));
step('CNC sub-tabs: ' + cncTabs.join(' | '));
if (!cncTabs.some((t) => t.startsWith('FMC 1')) || !cncTabs.some((t) => t.startsWith('FMC 2'))) {
  throw new Error('FMC 1 and FMC 2 missing from the CNC centre');
}

const queuedBefore = await page.evaluate(() =>
  import('/js/model.js').then((m) => m.openCountFor('cncfmc')));
const moveWo = await page.$eval('.line .mono.strong', (n) => n.textContent.trim());
const queueLine = page.locator('.line').filter({ hasText: moveWo }).first();
await queueLine.locator('.line-open').click();
await inspector.getByRole('button', { name: 'Assign', exact: true }).click();
await page.waitForSelector('dialog .movebtn');
await page.locator('dialog .movebtn', { hasText: 'FMC 2' }).first().click();
await page.waitForTimeout(300);

const moved = await page.evaluate(() => import('/js/model.js').then(async (m) => {
  const s = await import('/js/store.js');
  return {
    queue: m.openCountFor('cncfmc'),
    fmc2: m.openCountFor('fmc2'),
    assigns: Object.entries(s.state.taskAssign).map(([k, v]) => `${k} -> ${v.machine} by ${v.by}`),
  };
}));
step(`moved to FMC 2 — queue ${queuedBefore} -> ${moved.queue}, FMC 2 = ${moved.fmc2} | ${moved.assigns.join(', ')}`);
if (moved.queue !== queuedBefore - 1) throw new Error('line did not leave the queue');
if (moved.fmc2 !== 1) throw new Error('line did not arrive on FMC 2');
// The key must still be the imported one, or every overlay on that line is orphaned.
if (!moved.assigns[0].startsWith('cncfmc|')) {
  throw new Error('assignment changed the line key: ' + moved.assigns[0]);
}
await page.screenshot({ path: path.join(SHOT, 'centre-cnc-fmc.png'), fullPage: true });

// ---------- moving a job between machines in the same centre ----------
// The FOM sheets DO say which FOM a job is on, unlike CNC & FMC — but the
// floor moves work between them mid-shift, so the tracker has to follow.
await gotoTab('FOM');
await page.waitForSelector('.subtabs button');
const fomBefore = await page.evaluate(() => import('/js/model.js').then((m) => ({
  fom1: m.openCountFor('fom1'), fom2: m.openCountFor('fom2'),
})));
const fomWo = await page.$eval('.line .mono.strong', (n) => n.textContent.trim());
const fomLine = page.locator('.line').filter({ hasText: fomWo }).first();
await fomLine.locator('.line-open').click();
await inspector.getByRole('button', { name: 'Move', exact: true }).click();
await page.waitForSelector('dialog .movebtn');
const moveOpts = await page.$$eval('dialog .movebtn strong', (ns) => ns.map((n) => n.textContent.trim()));
step('FOM move targets: ' + moveOpts.join(', '));
if (moveOpts.join(',') !== 'FOM 1,FOM 2,FOM 3') throw new Error('unexpected FOM move targets');
await page.locator('dialog .movebtn', { hasText: 'FOM 2' }).first().click();
await page.waitForTimeout(300);

const fomAfter = await page.evaluate(() => import('/js/model.js').then(async (m) => {
  const s = await import('/js/store.js');
  return {
    fom1: m.openCountFor('fom1'), fom2: m.openCountFor('fom2'),
    assigns: Object.entries(s.state.taskAssign)
      .filter(([k]) => k.startsWith('fom1|')).map(([k, v]) => `${k} -> ${v.machine}`),
  };
}));
step(`FOM 1 ${fomBefore.fom1} -> ${fomAfter.fom1}, FOM 2 ${fomBefore.fom2} -> ${fomAfter.fom2} | ${fomAfter.assigns.join(', ')}`);
if (fomAfter.fom1 !== fomBefore.fom1 - 1) throw new Error('line did not leave FOM 1');
if (fomAfter.fom2 !== fomBefore.fom2 + 1) throw new Error('line did not arrive on FOM 2');
// The key must still carry the machine the sheet imported it under.
if (!fomAfter.assigns.length || !fomAfter.assigns[0].startsWith('fom1|')) {
  throw new Error('moving changed the line key: ' + JSON.stringify(fomAfter.assigns));
}

// It shows on FOM 2 badged with where the workbook has it, so the FOM 1
// operator can see where the job went.
await page.click('.subtabs button:has-text("FOM 2")');
await page.waitForTimeout(250);
const movedBadge = await page.locator('.line').filter({ hasText: fomWo }).first()
  .locator('.badge-moved').first().textContent();
step('moved badge on FOM 2: ' + movedBadge.trim());
if (!movedBadge.includes('FOM 1')) throw new Error('moved line does not say where it came from');
await page.screenshot({ path: path.join(SHOT, 'moved-line.png') });

// and it goes back where the sheet has it
const movedFomLine = page.locator('.line').filter({ hasText: fomWo }).first();
await movedFomLine.locator('.line-open').click();
await inspector.getByRole('button', { name: 'Move', exact: true }).click();
await page.waitForSelector('dialog .movebtn');
await page.click('dialog .body button.ghost');   // header has a ghost 'Close' too
await page.waitForTimeout(300);
const fomBack = await page.evaluate(() => import('/js/model.js').then((m) => m.openCountFor('fom1')));
step('after putting it back, FOM 1 = ' + fomBack);
if (fomBack !== fomBefore.fom1) throw new Error('putting the line back did not restore FOM 1');

// ---------- the shift update says how old it is ----------
// The workbook's entry is dated 2026-08-13; the test runs later than that, so
// it must not be presented as current. "Latest shift update" beside a neutral
// date is how a day-old entry got read as today's.
await gotoTab('Multi Punch');
const suChips = await page.$$eval('.su .chip', (ns) => ns.map((n) => n.textContent.trim()));
step('shift-update panel chips: ' + suChips.join(' | '));
if (!suChips.some((c) => /yesterday|days old|today/.test(c))) {
  throw new Error('shift-update panel does not say how old the entry is');
}

// ---------- stale-import warning ----------
// Exactly the situation that bit in practice: data already loaded, then a
// parsing fix ships. The stored result does not re-parse itself, so the app
// has to say so instead of presenting old output as current.
await gotoTab('Setup');
if (await page.locator('.banner.warn:has-text("Re-import")').count()) {
  throw new Error('fresh import should not be flagged stale');
}
await page.evaluate(() => import('/js/store.js').then((m) => {
  m.state.machineMeta.cnc.parser = 1;      // pretend it was read by an old build
  m.save();
}));
await gotoTab('Rolling'); await gotoTab('Setup');
const staleBanner = await page.locator('.banner.warn:has-text("Re-import")').first().textContent();
step('stale-import banner: ' + staleBanner.replace(/\s+/g, ' ').trim().slice(0, 78) + '…');
if (!/CNC/.test(staleBanner)) throw new Error('stale banner does not name the CNC workbook');

// and the shift-update panel flags itself rather than looking like current truth
await gotoTab('Multi Punch');
const suStaleChip = await page.locator('.su .chip:has-text("re-import")').count();
step('shift-update panel flags itself stale: ' + (suStaleChip ? 'yes' : 'no'));
if (!suStaleChip) throw new Error('shift-update panel did not flag stale data');

await page.evaluate(() => import('/js/store.js').then((m) => {
  m.state.machineMeta.cnc.parser = 4;
  m.save();
}));

// ---------- cloud sync config ----------
// No live Supabase here, so this covers the parts that must work without one:
// the config round-trip, the split of the snapshot into base/work, and that a
// bad address fails with a sentence rather than a stack trace.
const cloud = await page.evaluate(async () => {
  const c = await import('/js/cloud.js');
  c.setCloudConfig({ url: 'https://example.invalid', key: 'k', site: 'cutting' });
  const saved = c.cloudConfig();
  let err = null;
  try { await c.cloudTest({ url: 'https://example.invalid', key: 'k' }); }
  catch (e) { err = e.message; }
  let badUrl = null;
  try { await c.cloudTest({ url: 'not a url', key: 'k' }); }
  catch (e) { badUrl = e.message; }
  c.setCloudConfig(null);
  return { saved, enabled: c.cloudEnabled(), err, badUrl };
});
step('cloud config round-trip: ' + JSON.stringify(cloud.saved));
step('unreachable host says: ' + cloud.err);
step('bad url says: ' + cloud.badUrl);
if (cloud.saved.site !== 'cutting') throw new Error('cloud config did not round-trip');
if (cloud.enabled) throw new Error('cloud config was not cleared');
if (!/Could not reach/.test(cloud.err)) throw new Error('network failure not explained in words');
if (!/web address/.test(cloud.badUrl)) throw new Error('bad URL not explained in words');

// ---------- shift update ----------
await gotoTab('Shift Update');
await page.waitForSelector('.sucard');

const suCards = await page.$$eval('.sucard-name', (ns) => ns.map((n) => n.textContent.trim()));
const suGroups = await page.$$eval('.dgroup-label', (ns) => ns.map((n) => n.textContent.trim()));
step(`shift update — groups [${suGroups.join(' ')}] | ${suCards.length} cards: ${suCards.join(', ')}`);
if (suGroups.join(',') !== 'Department,Rolling,FOM,CNC & FMC,Multi Punch') {
  throw new Error('unexpected shift update sections: ' + suGroups.join(','));
}
if (!suCards.includes('FOM 1') || !suCards.includes('FOM 2')) {
  throw new Error('FOM machines missing their own section');
}

// the workbook's own entry is offered as a one-click pull
const pulls = await page.$$eval('.linkbtn', (ns) => ns.length);
step('cards offering "Pull last update": ' + pulls);
if (!pulls) throw new Error('no workbook entry offered on any card');

const suFom1 = page.locator('.sucard').filter({ hasText: 'FOM 1' }).first();
await suFom1.locator('.linkbtn').click();
await page.waitForTimeout(200);
const pulled = await suFom1.locator('textarea').first().inputValue();
step('FOM 1 pulled from workbook: ' + JSON.stringify(pulled.slice(0, 60)));
if (!pulled.trim()) throw new Error('pulling the workbook entry filled nothing in');

// a chip inserts a single line
const chipCount = await suFom1.locator('.sug-chip').count();
if (chipCount) {
  const chipText = (await suFom1.locator('.sug-chip').first().textContent()).trim();
  await suFom1.locator('.sug-chip').first().click();
  await page.waitForTimeout(200);
  const after = await suFom1.locator('textarea').first().inputValue();
  step(`chip "${chipText.slice(0, 40)}" -> ${after.split('\n').length} lines`);
}

await suFom1.locator('.sucard-ops input').fill('2');
await suFom1.locator('textarea').nth(2).fill('Blade change at 18:00');

await page.locator('.su-general textarea').fill('Three on midnights. Skid of 8560 due tomorrow.');
await page.screenshot({ path: path.join(SHOT, 'shift-write.png'), fullPage: true });

await page.click('.su-actions button.primary');
await page.waitForSelector('.suread');
const suSaved = await page.evaluate(() => import('/js/store.js').then((m) => {
  const k = Object.keys(m.state.shiftLogs)[0];
  const l = m.state.shiftLogs[k];
  return { key: k, by: l.by, at: !!l.at, ops: l.rows.fom1?.ops, notes: l.notes, machines: Object.keys(l.rows) };
}));
step('saved: ' + JSON.stringify(suSaved));
if (suSaved.ops !== '2') throw new Error('#Ops not saved against FOM 1');
if (suSaved.by !== 'Abhay' || !suSaved.at) throw new Error('shift update missing who/when');
if (!suSaved.notes.startsWith('Three on midnights')) throw new Error('general notes not saved');

const readNames = await page.$$eval('.suread-name strong', (ns) => ns.map((n) => n.textContent.trim()));
step('read view shows: ' + readNames.join(', '));
if (!readNames.includes('FOM 1')) throw new Error('saved machine missing from the read view');
await page.screenshot({ path: path.join(SHOT, 'shift-read.png'), fullPage: true });

// it survives a reload, and the recent list points back at it
await page.reload();
await page.waitForSelector('header.top');
await gotoTab('Shift Update');
await page.waitForSelector('.su-recentrow');
const recent = await page.$$eval('.su-recentrow', (ns) => ns.map((n) => n.textContent.trim()));
step('recent updates: ' + recent.join(' | '));
if (!recent.length) throw new Error('saved update missing from the recent list');

/* The machine page must now show what was just written here, not the workbook
   entry it outranks. This is the one that was wrong: an update typed in the app
   for today sat behind the workbook's snapshot from yesterday, so FOM and
   Rolling kept reporting the previous day's work. */
await gotoTab('FOM');
await page.waitForSelector('.su');
const suWritten = await page.evaluate(() => {
  const n = document.querySelector('.su');
  return {
    written: n.classList.contains('written'),
    title: n.querySelector('.su-title')?.textContent.trim(),
    body: n.querySelector('.su-body')?.textContent.trim(),
  };
});
step(`FOM 1 panel: ${suWritten.title} | ${suWritten.body.slice(0, 90)}…`);
if (!suWritten.written) {
  throw new Error('the machine page still shows the workbook over an update written today');
}
if (!suWritten.body.includes('Blade change at 18:00')) {
  throw new Error('the written update is labelled as such but is not what is shown');
}

// A machine nobody wrote up still falls back to the workbook.
await gotoTab('Multi Punch');
await page.waitForSelector('.su');
const suFallback = await page.evaluate(() =>
  document.querySelector('.su').classList.contains('written'));
step('Multi Punch falls back to the workbook: ' + (!suFallback));
if (suFallback) throw new Error('a machine with no written update claims to have one');

/* ---------- the die lookup ---------- */

/* A die on the schedule is a rolled sub-assembly, not one extrusion. The
   section book says what it is made of, and the schedule and the book write
   the same number differently — S80.106 against SA80-106 — which is the part
   that had to be got right. */
await gotoTab('Rolling');
const dieCheck = await page.evaluate(() => import('/js/dies.js').then((d) => {
  const known = d.lookupDie('S80.106');
  const bare = d.lookupDie('80-105');
  return {
    total: d.SUBASSEMBLIES.length,
    sa: known.assembly?.sa || null,
    desc: known.assembly?.desc || null,
    parts: d.componentsOf(known.assembly).map((c) => `${c.role}:${c.die}${c.qty > 1 ? '×' + c.qty : ''}`),
    usedInCount: bare.usedIn.length,
    usedIncludes: bare.usedIn.some((r) => r.sa === 'SA80-106'),
    aliases: ['S80.106', 'SA80.106', 'SA80-106'].map((q) => ({
      q, sa: d.lookupDie(q).assembly?.sa || null,
      parts: d.componentsOf(d.lookupDie(q).assembly).map((c) => `${c.role}:${c.die}:${c.qty}`),
    })),
    missing: d.lookupDie('ZZ9.999').assembly,
  };
}));
step('die lookup: ' + JSON.stringify(dieCheck));
if (dieCheck.total < 900) throw new Error('the section book did not load');
if (dieCheck.sa !== 'SA80-106') throw new Error('S80.106 did not resolve to SA80-106');
// The example the department gave: exterior 80-113, thermal break 84-901 top
// and bottom, interior 80-105.
const want = ['Exterior:80-113', 'Thermal break:84-901×2', 'Interior:80-105'];
if (JSON.stringify(dieCheck.parts) !== JSON.stringify(want)) {
  throw new Error('components wrong: ' + JSON.stringify(dieCheck.parts));
}
if (new Set(dieCheck.aliases.map((x) => JSON.stringify([x.sa, x.parts]))).size !== 1) {
  throw new Error('schedule and section-book spellings return different results: '
    + JSON.stringify(dieCheck.aliases));
}
if (!dieCheck.usedIncludes) throw new Error('the reverse lookup does not find SA80-106 from 80-105');
if (dieCheck.missing) throw new Error('an unknown die should resolve to nothing');

// Drawings ride along with the data, and every caller copes with their
// absence — the book is a set of PDFs and not all of them are in hand.
const drawCheck = await page.evaluate(() => import('/js/dies.js').then((d) => ({
  count: d.drawingCount(),
  isImage: (d.drawingFor('SA83-001')?.src || '').startsWith('data:image/webp;base64,'),
  sheetSource: d.drawingFor('SA83-001')?.source,
  series8000Source: d.drawingFor('SA80-106')?.source,
  newest8000Source: d.drawingFor('SA80-374')?.source,
  retired8000IsNull: d.drawingFor('SA80-240'),
  missingIsNull: d.drawingFor('SA99-999'),
})));
step('drawings: ' + JSON.stringify({ ...drawCheck, isImage: drawCheck.isImage }));
if (drawCheck.count < 400) throw new Error('the drawings did not load');
if (!drawCheck.isImage) throw new Error('a known drawing did not resolve to an image');
if (drawCheck.sheetSource !== 'sheet') throw new Error('a drawing sheet should say it is a sheet');
if (drawCheck.series8000Source !== 'sheet') throw new Error('8000 Series should use its full drawing sheets');
if (drawCheck.newest8000Source !== 'sheet') throw new Error('the new SA80-374 drawing did not load');
if (drawCheck.retired8000IsNull !== null) throw new Error('SA80-240 is absent from the replacement Series PDFs');
if (drawCheck.missingIsNull !== null) throw new Error('an unknown drawing should be null, not a broken image');

// It is also a proper Department Tools page, not only a dialog reached from a
// line. The book spelling with a dot must return the same complete card.
await gotoTab('Die Lookup');
await page.fill('.die-section .diesearch input', 'SA80.106');
await page.waitForFunction(() => document.querySelector('.die-section .diecard-sa')?.textContent.trim() === 'SA80-106');
const sectionLookup = await page.evaluate(() => ({
  title: document.querySelector('.die-section h1')?.textContent.trim(),
  sa: document.querySelector('.die-section .diecard-sa')?.textContent.trim(),
  drawing: !!document.querySelector('.die-section .diedrawing img'),
  parts: [...document.querySelectorAll('.die-section .diepart-die')].map((n) => n.textContent.trim()),
}));
step('die lookup section: ' + JSON.stringify(sectionLookup));
if (sectionLookup.title !== 'Die Lookup' || sectionLookup.sa !== 'SA80-106'
  || !sectionLookup.drawing || sectionLookup.parts.join(',') !== '80-113,84-901,80-105') {
  throw new Error('the Die Lookup section did not show the complete SA80.106 result');
}
await page.screenshot({ path: path.join(SHOT, 'die-lookup-section.png') });

/* Individual profiles live in their own engineering-master library. This is
   intentionally not the SA lookup: 80-113 is one extrusion used inside a
   rolled assembly. Empty numbered template cells must not inflate the count. */
const extrusionCheck = await page.evaluate(() => import('/js/extrusions.js').then((x) => ({
  total: x.extrusionCount(),
  direct: x.lookupExtrusions('80.113').map((r) => r.id),
  corrected: ['20-016', 'A&P', '87-442', '88-308', '89-087', '89-261', '89-368']
    .map((id) => [id, x.lookupExtrusions(id).length]),
  blankPlaceholder: x.lookupExtrusions('80-066').length,
  finalDie: x.searchExtrusions('S-25422').map((r) => r.id),
})));
step('extrusion data: ' + JSON.stringify(extrusionCheck));
if (extrusionCheck.total !== 1680 || extrusionCheck.direct.join(',') !== '80-113') {
  throw new Error('the reviewed extrusion library did not load');
}
if (extrusionCheck.corrected.some(([, count]) => count < 1)) {
  throw new Error('a visually reviewed extrusion correction is missing');
}
if (extrusionCheck.blankPlaceholder !== 0) {
  throw new Error('an empty numbered master cell appeared as an extrusion drawing');
}
if (!extrusionCheck.finalDie.includes('80-001')) {
  throw new Error('final die number search did not find its extrusion');
}

// A component on the SA card leads into the individual profile section, with
// the large image module loaded only after a result is selected.
await page.click('.diepart:has-text("80-113")');
await page.waitForFunction(() => location.hash === '#extrusions'
  && document.querySelector('.extrusion-id')?.textContent.trim() === '80-113');
await page.waitForSelector('.extrusion-drawing img', { timeout: 30000 });
const extrusionSection = await page.evaluate(() => ({
  title: document.querySelector('.extrusion-section h1')?.textContent.trim(),
  id: document.querySelector('.extrusion-id')?.textContent.trim(),
  source: document.querySelector('.extrusion-source')?.textContent.trim(),
  image: document.querySelector('.extrusion-drawing img')?.src.startsWith('data:image/webp;base64,'),
}));
step('extrusion section: ' + JSON.stringify(extrusionSection));
if (extrusionSection.title !== 'Extrusion Lookup' || extrusionSection.id !== '80-113'
  || !extrusionSection.image || !extrusionSection.source.includes('8000 Series')) {
  throw new Error('the individual extrusion section did not show 80-113');
}
await page.screenshot({ path: path.join(SHOT, 'extrusion-lookup-section.png') });

// And it opens from a die on a line.
await gotoTab('Rolling');
await page.waitForSelector('.line .dielink');
await page.click('.line .dielink');
await page.waitForSelector('dialog .diecard');
const shown = await page.$eval('.diecard-sa', (n) => n.textContent.trim());
step('lookup opened from a line: ' + shown);
await page.screenshot({ path: path.join(SHOT, 'die-lookup.png') });
await page.click('dialog header button');
await page.waitForSelector('dialog', { state: 'detached' });

/* ---------- one job, several stations ---------- */

/* W/O 30996 S80.104 is a real row in the Rolling and CNC workbooks, and the
   two sheets disagree: rolling says IP, FOM 2 says DONE. It cannot have been
   cut at FOM 2 without being rolled first — rolling's row is stale, and
   counting it open means every open count, staging list and shift update that
   reads it is wrong by the same amount. 99 jobs are in this state. */
const implied = await page.evaluate(() => Promise.all([
  import('/js/model.js'), import('/js/store.js'),
]).then(([M, S]) => {
  const rows = S.state.tasks.filter((t) => t.wo === '30996' && t.die === 'S80.104');
  return rows.map((t) => {
    const e = M.effectiveTaskStatus(t);
    return { machine: t.machine, sheet: t.status, shown: e.key, implied: !!e.implied, from: e.impliedFrom };
  });
}));
step('30996 S80.104 across stations: '
  + implied.map((r) => `${r.machine} ${r.sheet || '-'}→${r.shown}${r.implied ? '*' : ''}`).join(' | '));

const at = (m) => implied.find((r) => r.machine === m);
if (implied.length < 2) throw new Error('expected 30996 S80.104 on more than one machine');
if (at('roll-auto').shown !== 'DONE' || !at('roll-auto').implied) {
  throw new Error('rolling should be finished by FOM 2 downstream, not left as IP');
}
if (at('roll-auto').from !== 'fom2') throw new Error('the inference has to say which station it came from');
if (at('fom2').implied) throw new Error('the station actually marked done must not be called implied');

/* Never backwards. Rolling being finished says nothing about whether FOM 2 has
   cut it yet, and claiming it did would be the same stale-data mistake in the
   other direction. */
const backwards = await page.evaluate(() => Promise.all([
  import('/js/model.js'), import('/js/store.js'),
]).then(([M, S]) => {
  const rows = S.state.tasks.filter((t) => M.effectiveTaskStatus(t).implied);
  const STAGE = { 'roll-auto': 1, 'roll-man': 1, saw: 2, fom1: 2, fom2: 2, fom3: 2, multipunch: 3, cncfmc: 4, cnc1: 4, fmc1: 4, fmc2: 4 };
  return {
    total: rows.length,
    done: rows.filter((t) => M.effectiveTaskStatus(t).key === 'DONE').length,
    wrongWay: rows.filter((t) => STAGE[M.effectiveTaskStatus(t).impliedFrom] <= STAGE[t.machine]).length,
  };
}));
step('inferred across the whole book: ' + JSON.stringify(backwards));
if (backwards.wrongWay) throw new Error(`${backwards.wrongWay} inferences point backwards up the line`);
if (backwards.total < 20) throw new Error('the inference fired on almost nothing — check the stage map');

/* An operator's own call outranks it. They looked at the material; the app only
   looked at another row. */
const overruled = await page.evaluate(() => Promise.all([
  import('/js/model.js'), import('/js/store.js'),
]).then(([M, S]) => {
  const t = S.state.tasks.find((x) => x.wo === '30996' && x.die === 'S80.104' && x.machine === 'roll-auto');
  const k = M.taskStatusKey(t);
  S.setTaskStatus(k, 'IN_PROGRESS');
  const e = M.effectiveTaskStatus(t);
  S.setTaskStatus(k, null);
  return { shown: e.key, implied: !!e.implied, overridden: !!e.overridden };
}));
step('after an operator says otherwise: ' + JSON.stringify(overruled));
if (overruled.shown !== 'IN_PROGRESS' || overruled.implied) {
  throw new Error('an operator setting a status must beat the inference');
}

/* ---------- the routing panel ---------- */

/* Opened from a line, it has to show the SOP's stations with their paperwork —
   and nothing else. `append` is not `el`: el() drops a null child, a raw DOM
   append stringifies it, and the word "null" went out on the page for every
   line whose route had no discrepancy to report, which is most of them. */
await gotoTab('Rolling');
/* Two surfaces reach it depending on width: the icon rail on a narrow layout,
   and the inspector's action list once the workspace is wide enough to show a
   side panel — which is what this run's 1440px viewport gets. Open it by the
   route the layout actually offers rather than pinning one. */
if (await page.locator('.line-tools:visible').count()) {
  await page.click('.line .line-iconbtn[title*="paperwork"]');
} else {
  await page.click('.line .line-open');
  await page.waitForSelector('.inspector-actions');
  await page.click('.inspector-actions button:has-text("Route")');
}
await page.waitForSelector('dialog .routesteps');
const route = await page.evaluate(() => {
  const d = document.querySelector('dialog');
  return {
    steps: [...d.querySelectorAll('.route-station strong')].map((n) => n.textContent.trim()),
    paper: [...d.querySelectorAll('.route-paper strong')].length,
    stray: /(^|\s)(null|undefined|NaN|\[object Object\])(\s|$)/.test(d.textContent),
    src: /SOP-WW-CUT-008/.test(d.textContent),
  };
});
step('routing panel: ' + JSON.stringify(route));
if (!route.steps.length) throw new Error('the routing panel showed no stations');
if (!route.paper) throw new Error('the routing panel showed no paperwork — that is half the SOP');
if (!route.src) throw new Error('the routing panel does not say which document it is quoting');
if (route.stray) throw new Error('a null or undefined was rendered as text in the routing panel');
await page.screenshot({ path: path.join(SHOT, 'route-panel.png') });
await page.click('dialog header button');
await page.waitForSelector('dialog', { state: 'detached' });

/* ---------- staging ---------- */

/* The step before the first machine, and the one the department judges itself
   on. It is an overlay on the rolling lines, so a staged line is the same line
   the roller then picks up — not a copy of it. */
await gotoTab('Staging');
await page.waitForSelector('.stage-line');
const stageBefore = await page.$$eval('.dgroup-count', (ns) => ns.map((n) => n.textContent.trim()));
const stageWo = await page.$eval('.stage-line .mono.strong', (n) => n.textContent.trim());
step(`staging queue: ${stageBefore.join(' / ')} — first is ${stageWo}`);

await page.selectOption('.stage-line .stage-pick select', { index: 1 });
await page.waitForTimeout(300);
const stagedRec = await page.evaluate(() => import('/js/store.js').then((m) => {
  const [key, v] = Object.entries(m.state.staging)[0] || [];
  return key ? { key, staged: v.staged, stageFor: v.stageFor, by: v.by } : null;
}));
step('staged: ' + JSON.stringify(stagedRec));
if (!stagedRec?.staged || !stagedRec.stageFor) throw new Error('staging for a shift recorded nothing');
if (!/\|(DAY|AFT|NIGHT)$/.test(stagedRec.stageFor)) {
  throw new Error('stage-for should be a shift: ' + stagedRec.stageFor);
}

/* A line the roller has already started is past staging. Excluding only
   finished lines left every in-progress one on the stager's list — twenty at
   once on Rolling (Auto), for jobs already on the machine. */
const stageCounts = await page.evaluate(() => import('/js/model.js').then((m) => {
  const q = m.stagingQueue();
  return { todo: q.todo.length, staged: q.staged.length };
}));
const startedKey = await page.evaluate(() => import('/js/model.js').then(async (m) => {
  const s = await import('/js/store.js');
  const row = m.stagingQueue().todo.find((r) => !r.staging);
  s.setTaskStatus(row.key, 'IN_PROGRESS');
  return row.key;
}));
const stageAfterStart = await page.evaluate(() => import('/js/model.js').then((m) => {
  const q = m.stagingQueue();
  return { todo: q.todo.length, staged: q.staged.length };
}));
step(`staging after a line started rolling: ${stageCounts.todo} -> ${stageAfterStart.todo} to stage`);
if (stageAfterStart.todo !== stageCounts.todo - 1) {
  throw new Error('a line that started rolling is still listed as needing staging');
}
const stillListed = await page.evaluate((k) => import('/js/model.js').then((m) =>
  m.stagingQueue().todo.some((r) => r.key === k)
  || m.stagingQueue().staged.some((r) => r.key === k)), startedKey);
if (stillListed) throw new Error('a started line is still on the staging page');

// It shows on the rolling queue, so the roller knows before starting.
await gotoTab('Rolling');
await page.fill('.centre-filters input[type="search"]', stageWo);
await page.waitForTimeout(300);
const rollerSees = await page.$$eval('.line', (ns) => ns.map((n) => !!n.querySelector('.badge-staged')));
step('staged badge on the rolling queue: ' + JSON.stringify(rollerSees));
if (!rollerSees.some(Boolean)) throw new Error('a staged line does not show as staged to the roller');
await page.fill('.centre-filters input[type="search"]', '');

// And it survives a re-import, like every other overlay.
await gotoTab('Setup');
{
  const ch = page.waitForEvent('filechooser');
  await page.click('.drop:has-text("Rolling workbook") button');
  await (await ch).setFiles(ROLLING);
  await page.waitForSelector('dialog .stat', { timeout: 120000 });
  await page.click('dialog header button');
  await page.waitForSelector('dialog', { state: 'detached' });
}
const stageAfter = await page.evaluate((k) => import('/js/store.js').then((m) =>
  m.state.staging[k]?.staged ?? null), stagedRec.key);
step('staged after re-importing Rolling: ' + stageAfter);
if (stageAfter !== true) throw new Error('re-importing lost the staging record');

/* ---------- the saw is its own station ---------- */

await gotoTab('Multi Punch');
const punchTabs = await page.$$eval('.subtabs button', (ns) =>
  ns.map((n) => n.textContent.replace(/\d+$/, '').trim()));
step('Punch centre machines: ' + punchTabs.join(', '));
if (!punchTabs.some((t) => /Elumatec/i.test(t))) throw new Error('the saw is not a station');

/* ---------- learned routing ---------- */

/* The CNC & FMC sheet says nothing about which machine runs a line. Put the
   same component on FMC 1 twice by hand, and a third line carrying it must be
   recognised — that is the knowledge that otherwise lives in somebody's head
   and gets re-applied every import. */
await gotoTab('CNC & FMC');
await page.waitForSelector('.line');

const learn = await page.evaluate(() => import('/js/model.js').then(async (mo) => {
  const st = await import('/js/store.js');
  // A die with at least three unassigned lines in the queue, so two can teach
  // the app and one is left to be recognised.
  const byDie = new Map();
  for (const t of mo.tasksInScope()) {
    if (t.machine !== 'cncfmc' || !t.die) continue;
    if (st.state.taskAssign[mo.taskStatusKey(t)]) continue;
    // Finished lines are deliberately never routed, so they cannot teach or be
    // taught here either.
    if (mo.effectiveTaskStatus(t).key === 'DONE') continue;
    if (!byDie.has(t.die)) byDie.set(t.die, []);
    byDie.get(t.die).push(mo.taskStatusKey(t));
  }
  const found = [...byDie.entries()].find(([, keys]) => keys.length >= 3);
  if (!found) return { die: null };
  const [die, keys] = found;
  return { die, keys: keys.slice(0, 3), pool: keys.length };
}));
step(`teaching with die ${learn.die} (${learn.pool} lines in the queue)`);
if (!learn.die) throw new Error('no repeated component in the CNC queue to learn from');

// Nothing to suggest from a single sighting.
await page.evaluate(([k, m]) => import('/js/store.js').then((s) =>
  s.setTaskMachine(k, m, 'cncfmc')), [learn.keys[0], 'fmc1']);
const afterOne = await page.evaluate((k) => import('/js/model.js').then((mo) =>
  mo.suggestedMachine(mo.taskByKey(k)) ? 'suggested' : 'nothing yet'), learn.keys[2]);
step('after one assignment: ' + afterOne);
if (afterOne !== 'nothing yet') throw new Error('one sighting is a coincidence, not a habit');

// Two makes it a habit.
await page.evaluate(([k, m]) => import('/js/store.js').then((s) =>
  s.setTaskMachine(k, m, 'cncfmc')), [learn.keys[1], 'fmc1']);
const afterTwo = await page.evaluate((k) => import('/js/model.js').then((mo) => {
  const s = mo.suggestedMachine(mo.taskByKey(k));
  return s ? { machine: s.machine, seen: s.seen, total: s.total } : null;
}), learn.keys[2]);
step('after two: ' + JSON.stringify(afterTwo));
if (!afterTwo || afterTwo.machine !== 'fmc1' || afterTwo.seen !== 2) {
  throw new Error('the app did not learn where this component goes: ' + JSON.stringify(afterTwo));
}

// It shows on the row, and routes the queue in one action.
await page.reload();
await page.waitForSelector('header.top');
await gotoTab('CNC & FMC');
await page.waitForSelector('.routebar');
const routeOffer = await page.$eval('.routebar strong', (n) => n.textContent.trim());
step('route bar: ' + routeOffer);
await page.click('.routebar button.primary');
await page.waitForTimeout(400);
const routed = await page.evaluate((k) => import('/js/store.js').then((s) =>
  s.state.taskAssign[k]?.machine || null), learn.keys[2]);
step('third line after routing the queue: ' + routed);
if (routed !== 'fmc1') throw new Error('routing the queue did not move the recognised line');

// A line already put somewhere is never second-guessed.
const noSuggestForAssigned = await page.evaluate((k) => import('/js/model.js').then((mo) =>
  mo.suggestedMachine(mo.taskByKey(k))), learn.keys[0]);
if (noSuggestForAssigned) throw new Error('an assigned line should not be re-suggested');
step('assigned lines are left alone');

/* ---------- a job added by hand ---------- */

// It must appear in the queue like any other line, take a status, and survive
// a re-import of the workbook covering its machine — which is the whole reason
// manual jobs are not stored in `tasks`.
await gotoTab('FOM');
const beforeAdd = await page.$$eval('.line', (ns) => ns.length);
await page.click('.centre-head button[title^="Add a job"]');
await page.waitForSelector('dialog[open]');
await page.fill('dialog input[placeholder="31942"]', '90210');
await page.fill('dialog input[placeholder="S80.104"]', 'S80.999');
await page.fill('dialog input[placeholder="Harbour Point"]', 'Remake job');
await page.fill('dialog input[placeholder="0"]', '7');
await page.click('dialog footer button.primary');
await page.waitForSelector('dialog', { state: 'detached' });
await page.waitForTimeout(200);

const manual = await page.evaluate(() => import('/js/store.js').then((m) => {
  const t = Object.values(m.state.manualTasks)[0];
  return t ? { wo: t.wo, die: t.die, qty: t.qty, machine: t.machine, by: t.by, manual: t.manual } : null;
}));
step('manual job stored: ' + JSON.stringify(manual));
if (!manual || manual.wo !== '90210') throw new Error('the added job was not stored');

await page.fill('.centre-filters input[type="search"]', '90210');
await page.waitForTimeout(300);
const manualRow = await page.$$eval('.line', (ns) => ns.map((n) => ({
  wo: n.querySelector('.line-id .mono')?.textContent.trim(),
  badge: !!n.querySelector('.badge-manual'),
})));
step('manual job on the queue: ' + JSON.stringify(manualRow));
if (!manualRow.length || manualRow[0].wo !== '90210') throw new Error('the added job is not in the queue');
if (!manualRow[0].badge) throw new Error('the added job is not marked as added by hand');

// give it a status, then re-import the workbook it belongs to
await page.click('.line .line-open');
await inspector.locator('.seg-btn[title="In Progress"]').click();
await page.waitForTimeout(200);
await gotoTab('Setup');
{
  const ch = page.waitForEvent('filechooser');
  await page.click('.drop:has-text("CNC workbook") button');
  await (await ch).setFiles(CNC);
  await page.waitForSelector('dialog .stat', { timeout: 120000 });
  await page.click('dialog header button');
  await page.waitForSelector('dialog', { state: 'detached' });
}
const survived = await page.evaluate(() => import('/js/store.js').then((m) => {
  const t = Object.values(m.state.manualTasks)[0];
  const k = `${t.machine}|${t.wo}|${t.die || ''}`;
  return { present: !!t, status: m.state.taskStatus[k]?.status || null };
}));
step('manual job after re-importing CNC: ' + JSON.stringify(survived));
if (!survived.present) throw new Error('re-importing the workbook wiped a job added by hand');
if (survived.status !== 'IN_PROGRESS') throw new Error('the added job lost its status on re-import');

/* ---------- today's list ---------- */

await gotoTab('Today');
await page.waitForSelector('.todo-add input');
await page.fill('.todo-add input', 'Chase the mill on S80.999');
await page.click('.todo-add button.primary');
await page.waitForTimeout(200);
const todos = await page.evaluate(() => import('/js/store.js').then((m) =>
  Object.values(m.state.todos).map((t) => ({ text: t.text, done: t.done, by: t.by }))));
step('today list: ' + JSON.stringify(todos));
if (!todos.length || todos[0].text !== 'Chase the mill on S80.999') {
  throw new Error('the to-do was not stored');
}

await page.click('.todo .todo-check input');
await page.waitForTimeout(200);
const ticked = await page.evaluate(() => import('/js/store.js').then((m) => {
  const t = Object.values(m.state.todos)[0];
  return { done: t.done, doneBy: t.doneBy, hasAt: !!t.doneAt };
}));
step('ticked off: ' + JSON.stringify(ticked));
if (!ticked.done || !ticked.doneBy || !ticked.hasAt) throw new Error('ticking a to-do recorded nothing');

// the derived half reflects the schedules
const board = await page.$$eval('.att', (ns) => ns.map((n) =>
  n.querySelector('.att-k').textContent + '=' + n.querySelector('.att-n').textContent));
step('today board: ' + board.join(' '));
if (board.length !== 5) throw new Error('the today board lost a card');
await page.screenshot({ path: path.join(SHOT, 'today.png'), fullPage: true });

// Browser storage failures must be impossible to miss. A console warning is
// not enough on the floor: the operator needs a persistent recovery action.
await page.evaluate(async () => {
  window.__realStorageSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === 'bv.cutting.v1') throw new DOMException('Test quota exceeded', 'QuotaExceededError');
    return window.__realStorageSetItem.call(this, key, value);
  };
  (await import('/js/store.js')).save();
});
await page.waitForSelector('.storage-alert');
const storageAlarm = (await page.locator('.storage-alert').textContent()).replace(/\s+/g, ' ').trim();
step('storage failure alarm: ' + storageAlarm.slice(0, 100) + '…');
if (!/Do not close this page|exported a backup/.test(storageAlarm)) {
  throw new Error('storage failure did not give the operator a recovery action');
}
await page.evaluate(async () => {
  Storage.prototype.setItem = window.__realStorageSetItem;
  (await import('/js/store.js')).save();
});
await page.waitForSelector('.storage-alert', { state: 'detached' });

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
