/* Verifies Cutting-Tracker.html works when opened directly from disk (file://),
   which is how it will actually be used from the shared drive. Mirrors
   app-check.mjs's flow against the built single file instead of the dev server.
   Run: node build.mjs && node test/standalone-check.mjs */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = path.join(ROOT, 'Cutting-Tracker.html');
const DIR = '/root/.claude/uploads/042835a0-704b-5601-bc20-4ed82d27578f';
const ROLLING = `${DIR}/da7bb9f1-Rolling_Schedule_2026.xlsx`;
const CNC = `${DIR}/bae855fd-CNC_Schedule_Rev_E.xlsx`;

if (!fs.existsSync(FILE)) throw new Error('Run `node build.mjs` first.');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const step = (s) => console.log('  •', s);

await page.goto('file://' + FILE);
await page.waitForSelector('header.top');
step('opened from file:// — app booted');

step('secure context: ' + await page.evaluate(() => window.isSecureContext));
step('localStorage usable: ' + await page.evaluate(() => {
  try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); return true; }
  catch { return false; }
}));
step('File System Access available: ' + await page.evaluate(() => 'showOpenFilePicker' in window));

const tabs = await page.$$eval('nav.tabs button', (ns) => ns.map((n) => n.textContent.trim()));
step('tabs: ' + tabs.join(', '));
if (tabs.join(',') !== 'Rolling,FOM,CNC,Multi Punch,Back Orders,Shift Update,Setup') {
  throw new Error('unexpected nav: ' + tabs.join(','));
}

// import Rolling + CNC through the real UI
await page.click('nav.tabs button:has-text("Setup")');
await page.waitForSelector('.drop');
for (const [label, file] of [['Rolling workbook', ROLLING], ['CNC workbook', CNC]]) {
  const ch = page.waitForEvent('filechooser');
  await page.click(`.drop:has-text("${label}") button`);
  await (await ch).setFiles(file);
  await page.waitForSelector('dialog .stat', { timeout: 90000 });
  const n = await page.$eval('dialog .stat .n', (x) => x.textContent);
  step(`${label} parsed from file://: ${n} tasks`);
  await page.click('dialog header button');
  await page.waitForSelector('dialog', { state: 'detached' });
}

await page.click('nav.tabs button:has-text("Rolling")');
await page.waitForFunction(() => document.querySelector('.centre-title')?.textContent.trim() === 'Rolling (Auto)');
const groups = await page.$$eval('.dgroup-label', (ns) => ns.map((n) => n.textContent.trim()));
step('date groups on Rolling (Auto): ' + groups.join(', '));
if (!groups.length) throw new Error('no date groups rendered');
const suOk = await page.$$eval('.su-title', (ns) => ns.length > 0);
step('shift update panel: ' + (suOk ? 'shown' : 'absent'));

// status click survives a reload from disk. This build is a single bundled
// IIFE with no importable /js/*.js modules from outside it, so the target
// row is found from the rendered DOM rather than by reaching into JS state.
const scout = page.locator('.line').filter({ has: page.locator('.seg-btn[aria-pressed="true"][title="Not started"]') }).first();
const wo = (await scout.locator('.line-id .mono').textContent()).trim();
const dieEl = scout.locator('.die');
const die = (await dieEl.count()) ? (await dieEl.textContent()).trim() : '';
step(`target line: W/O ${wo} die ${die || '(none)'}`);

// Re-locate by W/O + die rather than reusing a locator built on "Not started"
// status text — that filter stops matching the instant the click changes the
// text, so re-resolving it would silently grab a different, unclicked row.
const stableRow = page.locator('.line').filter({ hasText: wo })
  .filter({ hasText: die || '—' }).first();
await stableRow.locator('.seg-btn[title="In Progress"]').click();
await page.waitForTimeout(300);
const afterClick = await stableRow.locator('.seg-btn[aria-pressed="true"]').getAttribute('title');
if (afterClick !== 'In Progress') throw new Error(`expected "In Progress", got "${afterClick}"`);

const key = `roll-auto|${wo}|${die}`;
const before = await page.evaluate((k) => {
  const raw = localStorage.getItem('bv.cutting.v1');
  return raw ? JSON.parse(raw).taskStatus?.[k] || null : null;
}, key);
step('status set: ' + JSON.stringify(before));
if (!before) throw new Error('status was not recorded in localStorage');

await page.reload();
await page.waitForSelector('header.top');
const after = await page.evaluate((k) => {
  const raw = localStorage.getItem('bv.cutting.v1');
  return raw ? JSON.parse(raw).taskStatus?.[k] || null : null;
}, key);
step('status after reload from disk: ' + JSON.stringify(after));
if (!after || after.status !== before.status) throw new Error('status did not survive reload from disk');

console.log('\nERRORS:', errors.length ? '\n  ' + errors.join('\n  ') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
