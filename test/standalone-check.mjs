/* Verifies Cutting-Tracker.html works when opened directly from disk (file://),
   which is how it will actually be used from the shared drive. Mirrors
   app-check.mjs's flow against the built single file instead of the dev server.
   Run: node build.mjs && node test/standalone-check.mjs */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { ROOT, workbookPaths, chromiumOptions } from './env.mjs';

const FILE = path.join(ROOT, 'Cutting-Tracker.html');
const books = workbookPaths();
const ROLLING = books.rolling;
const CNC = books.cnc;
const DAILY = books.daily;

if (!fs.existsSync(FILE)) throw new Error('Run `node build.mjs` first.');

const built = fs.readFileSync(FILE, 'utf8');
if (built.includes('../assets/fonts/')) throw new Error('standalone build still references external font files');
if (!built.includes('data:font/woff2;base64,')) throw new Error('standalone build did not inline the bundled fonts');

const browser = await chromium.launch(chromiumOptions());
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const step = (s) => console.log('  •', s);

await page.goto('file://' + FILE);
await page.waitForSelector('header.top');
step('opened from file:// — app booted');

await page.evaluate(() => document.fonts.ready);
const type = await page.evaluate(() => ({
  sans: getComputedStyle(document.body).fontFamily,
  mono: getComputedStyle(document.querySelector('.mono')).fontFamily,
}));
step('bundled typefaces: ' + JSON.stringify(type));
if (!type.sans.includes('IBM Plex Sans') || !type.mono.includes('IBM Plex Mono')) {
  throw new Error('bundled IBM Plex typefaces are not active');
}

step('secure context: ' + await page.evaluate(() => window.isSecureContext));
step('localStorage usable: ' + await page.evaluate(() => {
  try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); return true; }
  catch { return false; }
}));
step('File System Access available: ' + await page.evaluate(() => 'showOpenFilePicker' in window));

// Tool tabs carry a long label, a short one for narrow widths, and an
// outstanding-count badge, so the stated accessible name is what to read.
const tabs = await page.$$eval('nav.tabs button', (ns) =>
  ns.map((n) => (n.getAttribute('aria-label') || n.textContent).trim()));
step('tabs: ' + tabs.join(', '));
if (tabs.join(',') !== 'Overview,Rolling,FOM,CNC & FMC,Multi Punch,Jobs,Today,Daily Schedule,Projects,Staging,Rush,Back Orders,Material Helper,Forms,Employees,Engineering Lookup,Shift Update') {
  throw new Error('unexpected nav: ' + tabs.join(','));
}

// Import all three source workbooks through the real UI.
await page.click('.hdr-setup');
await page.waitForSelector('.drop');
for (const [label, file] of [
  ['Rolling workbook', ROLLING], ['CNC workbook', CNC], ['Daily Schedule workbook', DAILY],
]) {
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
await stableRow.locator('.line-open').click();
const inspector = page.locator('.line-inspector');
await inspector.locator('.seg-btn[title="In Progress"]').click();
await page.waitForTimeout(300);
const afterClick = await inspector.locator('.seg-btn[aria-pressed="true"]').getAttribute('title');
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
