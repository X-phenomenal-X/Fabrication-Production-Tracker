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

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
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
  await page.click(`nav.tabs button[aria-label="${name}"]`);
  await page.waitForFunction(
    (n) => document.querySelector('nav.tabs button[aria-current="true"]')?.getAttribute('aria-label') === n,
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
if (tabs.join(',') !== 'Rolling,FOM,CNC & FMC,Multi Punch,Rush,Back Orders,Shift Update,Setup') {
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
  ['CNC & FMC', 4, 'Unassigned'], ['Multi Punch', 0, 'Multi Punch'],
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
// FMC 1 and FMC 2 only exist in the newer block stacked below the old one in
// `Shift Update 2` — proof the stacked-block parse works, not just the sheet
// named exactly "Shift Update".
for (const k of ['roll-auto', 'fom1', 'cnc1', 'fmc1', 'fmc2', 'multipunch']) {
  if (!su.machines.includes(k)) throw new Error(`shift update missing ${k}`);
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

// It must come from the tab the department can actually see in Excel — the
// other three shift-update sheets in that workbook are hidden, i.e. archived.
const suSrc = await page.evaluate(() => import('/js/store.js').then(
  (m) => m.state.machineMeta?.cnc && m.state.shiftUpdate));
if (!suSrc) throw new Error('no shift update parsed');

const suWhen = await page.evaluate(() => import('/js/model.js').then((m) => ({
  fom1: m.shiftUpdateFor('fom1'), fmc1: m.shiftUpdateFor('fmc1'),
})).then((r) => Object.fromEntries(
  Object.entries(r).map(([k, e]) => [k, `${e.label} ${e.date} ${e.shift}`]))));
step('per-machine shift-update source: ' + JSON.stringify(suWhen));
if (suWhen.fom1 === suWhen.fmc1) throw new Error('entries should carry their own block date/shift');

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

// back order: flag a line, set pieces, assign it, note it
await page.click('nav.tabs button:has-text("Rolling")');
await page.waitForFunction(() => document.querySelector('.centre-title'));
const boLine = page.locator('.line').first();
const boWo = (await boLine.locator('.line-id .mono').textContent()).trim();
await boLine.locator('.line-iconbtn[title="Flag as back order"], .line-iconbtn[title="Edit back order"]').click();
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
await page.click('nav.tabs button:has-text("Setup")');
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
await page.locator('.line').filter({ hasText: rushWo }).first()
  .locator('.line-iconbtn[title="Mark as rush"]').click();
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
await page.locator('.line').filter({ hasText: moveWo }).first()
  .locator('.line-iconbtn[title="Put this line on a machine"]').click();
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
await page.locator('.line').filter({ hasText: fomWo }).first()
  .locator('.line-iconbtn[title="Move this line to another machine"]').click();
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
await page.locator('.line').filter({ hasText: fomWo }).first()
  .locator('.line-iconbtn[title="Move this line to another machine"]').click();
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
  m.state.machineMeta.cnc.parser = 3;
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
