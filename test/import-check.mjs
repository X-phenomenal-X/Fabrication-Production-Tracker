/* Runs the real importer against the real workbook in Chromium and prints
   what it produced and what it rejected. Run: node test/import-check.mjs */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const XLSX = process.argv[2] ||
  '/root/.claude/uploads/042835a0-704b-5601-bc20-4ed82d27578f/6c674bbc-Daily_Schedule_Aug_10_Rev_B.xlsx';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.hostname !== 'app.local') return route.continue();
  const f = path.join(ROOT, url.pathname);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    return route.fulfill({ status: 404, body: 'not found' });
  }
  const ext = path.extname(f);
  const type = ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/html';
  return route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(f) });
});

const harness = path.join(ROOT, '__harness.html');
fs.writeFileSync(harness, '<!doctype html><meta charset=utf-8><body>harness</body>');
await page.goto('http://app.local/__harness.html');

const b64 = fs.readFileSync(XLSX).toString('base64');
const out = await page.evaluate(async (b64) => {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const { importWorkbook } = await import('/js/import.js');
  const t0 = performance.now();
  const r = await importWorkbook(arr.buffer, { fileName: 'Rev_B.xlsx' });
  const ms = Math.round(performance.now() - t0);

  const sections = {};
  for (const o of r.orders) sections[o.section || '(none)'] = (sections[o.section || '(none)'] || 0) + 1;

  const cutCounts = {};
  for (const o of r.orders) {
    const s = o.ops.cut?.status || o.ops.cut?.text || '(blank)';
    cutCounts[s] = (cutCounts[s] || 0) + 1;
  }

  const withQty = r.orders.filter((o) => Object.values(o.ops).some((v) => v.target > 0));
  const totalPieces = r.orders.reduce(
    (s, o) => s + Object.values(o.ops).reduce((a, v) => a + (v.target || 0), 0), 0);

  return {
    ms,
    counts: r.report.counts,
    sheetsFound: r.report.sheetsFound,
    sheetsMissing: r.report.sheetsMissing,
    skipped: r.report.skipped.length,
    skippedSample: r.report.skipped.slice(0, 5),
    duplicates: r.report.duplicates.length,
    dupSample: r.report.duplicates.slice(0, 3),
    errorCells: r.report.errorCells.length,
    unknownStatus: r.report.unknownStatus.length,
    unknownSample: r.report.unknownStatus.slice(0, 5),
    sections,
    cutCounts,
    ordersWithQtyOps: withQty.length,
    totalPieces,
    withWip: r.orders.filter((o) => o.wip).length,
    sample: r.orders.slice(0, 2),
  };
}, b64);

console.log(JSON.stringify(out, null, 2));
fs.unlinkSync(harness);
await browser.close();
