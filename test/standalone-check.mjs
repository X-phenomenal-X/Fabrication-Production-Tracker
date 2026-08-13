/* Verifies Cutting-Tracker.html works when opened directly from disk (file://),
   which is how it will actually be used from the shared drive.
   Run: node build.mjs && node test/standalone-check.mjs */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = path.join(ROOT, 'Cutting-Tracker.html');
const XLSX = process.argv[2] ||
  '/root/.claude/uploads/042835a0-704b-5601-bc20-4ed82d27578f/6c674bbc-Daily_Schedule_Aug_10_Rev_B.xlsx';

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

// import the workbook through the real UI
await page.click('nav.tabs button:has-text("Data & Import")');
await page.waitForSelector('.drop');
const chooser = page.waitForEvent('filechooser');
await page.click('.drop button:has-text("Choose file")');
await (await chooser).setFiles(XLSX);
await page.waitForSelector('dialog .stat', { timeout: 90000 });
const orders = await page.$eval('dialog .stat .n', (n) => n.textContent);
step(`import parsed ${orders} orders from file://`);
await page.click('dialog footer button.primary');
await page.waitForSelector('dialog', { state: 'detached' });

await page.click('nav.tabs button:has-text("Board")');
await page.waitForSelector('table tbody tr');
step('board rows: ' + await page.$$eval('table tbody tr', (r) => r.length));

// progress entry survives a reload from file://
await page.click('table tbody tr');
await page.waitForSelector('dialog .opinput input');
const input = await page.$('dialog .opinput input');
await input.fill('7');
await input.dispatchEvent('change');
await page.waitForTimeout(300);
await page.click('dialog footer button.primary');
await page.waitForSelector('dialog', { state: 'detached' });

await page.reload();
await page.waitForSelector('header.top');
const after = await page.evaluate(() => {
  const raw = localStorage.getItem('bv.cutting.v1');
  if (!raw) return null;
  const d = JSON.parse(raw);
  return { orders: d.orders.length, progress: Object.keys(d.progress).length };
});
step('after reload from disk: ' + JSON.stringify(after));

await page.screenshot({ path: path.join(ROOT, 'test', 'screens', '9-standalone.png'), fullPage: false });

console.log('\nERRORS:', errors.length ? '\n  ' + errors.join('\n  ') : 'none');
await browser.close();
process.exit(errors.length || !after ? 1 : 0);
