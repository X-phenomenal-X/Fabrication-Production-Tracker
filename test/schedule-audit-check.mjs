/* Search, spreadsheet navigation and detail fidelity on the separate workbook. */
import { chromium } from 'playwright';
import { chromiumOptions } from './env.mjs';
import { makeFixture } from './fixture.mjs';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.join(root, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', ({'.css':'text/css','.js':'text/javascript','.html':'text/html'})[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch(chromiumOptions());
const fixture = makeFixture();
fixture.dailyOrders.push({ ...fixture.dailyOrders[0], id: 'undated-check', wo: 'UNDATED-01', cuttingDate: null, notes: 'Undated order note', row: 999 });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(snap => {
    localStorage.setItem('bv.cutting.v1', JSON.stringify(snap));
    window.print = () => { window.__schedulePrint = document.body.innerText; };
  }, fixture);
  await page.goto(`http://127.0.0.1:${server.address().port}/#schedule`);
  await page.waitForSelector('.schedule-table');
  const scope = page.getByLabel('Date range', { exact: true });
  const search = page.getByLabel('Find an order', { exact: true });
  await scope.selectOption('all');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.schedule-table tbody tr').count(), 60);
  await page.locator('.schedule-sheet > .schedule-more').click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.schedule-table tbody tr').count(), 97);
  await search.fill('61042');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.schedule-table tbody tr').count(), 1);
  assert.match(await page.locator('.schedule-table tbody').innerText(), /61042/);
  assert.equal(await search.evaluate(node => node === document.activeElement), true);
  await page.locator('.schedule-table .schedule-order-link').click();
  await page.waitForSelector('dialog');
  const target = fixture.dailyOrders.find(row => row.wo === '61042');
  const detail = await page.locator('dialog').innerText();
  for (const value of [target.project, target.materialStatus, target.shipDate, String(target.row)]) assert.ok(detail.includes(value));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await search.fill('');
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Units', exact: true }).click();
  await page.waitForTimeout(100);
  const amounts = await page.locator('.schedule-table tbody td.num').allTextContents();
  assert.deepEqual(amounts.map(Number), amounts.map(Number).sort((a,b)=>a-b));
  await scope.selectOption('undated');
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.schedule-table tbody tr').count(), 1);
  assert.match(await page.locator('.schedule-table tbody').innerText(), /UNDATED-01/);
  await page.getByRole('button', { name: 'Print results', exact: true }).click();
  assert.match(await page.evaluate(() => window.__schedulePrint), /UNDATED-01/);
  await scope.selectOption('all');
  await page.getByLabel('Cut status', { exact: true }).selectOption('ok');
  await page.waitForTimeout(100);
  const statuses = await page.locator('.schedule-table tbody td:nth-child(12)').allTextContents();
  console.log('STATUS DIAGNOSTIC', statuses, await page.locator('.schedule-result-summary').innerText(), await page.locator('.schedule-table thead').innerText());
  assert.ok(statuses.length && statuses.every(status => /^(DONE|OK)$/.test(status)));
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await page.waitForTimeout(100);
  for (const [label, width, height, scheme] of [['desktop',1440,960,'light'], ['phone',390,844,'dark'], ['tablet',768,1024,'light']]) {
    await page.setViewportSize({width,height});
    await page.emulateMedia({colorScheme:scheme});
    await page.waitForTimeout(400);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: page overflow`);
    const mobile = width <= 720;
    assert.equal(await page.locator('.schedule-sheet').isVisible(), !mobile);
    assert.equal(await page.locator('.schedule-mobile').isVisible(), mobile);
    fs.mkdirSync(path.join(root, 'test/screens/qa'), {recursive:true});
    await page.screenshot({path:path.join(root, `test/screens/qa/schedule-workbook-${label}.png`),fullPage:true});
    if (mobile) {
      await page.locator('.schedule-mobile button.schedule-row').first().click();
      await page.waitForSelector('dialog');
      await page.getByRole('button', {name:'Close',exact:true}).click();
    }
  }
  assert.deepEqual(errors, []);
  console.log('Schedule: cross-date search, pagination, details, sorting, undated rows, filters, print and responsive layouts passed.');
} finally { await browser.close(); server.close(); }
