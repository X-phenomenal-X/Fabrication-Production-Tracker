/* Midnight is a real shift: 23:45–07:15, saved as NIGHT.
   Work after midnight belongs to the date the shift started.
   Run: node test/midnight-shift-check.mjs */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT, chromiumOptions } from './env.mjs';

const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: (key) => memory.delete(key),
};

const { SHIFTS, SHIFT_ORDER, shiftAt, shiftContextAt, breakRanges } = await import('../js/shifts.js');
const { shiftWindow, workInShift } = await import('../js/model.js');
const { state, saveShiftLog, loadLocal } = await import('../js/store.js');
const { shiftRowHasContent } = await import('../js/floor-operations.js');

const at = (hour, minute = 0) => new Date(2026, 9, 18, hour, minute, 0, 0);

assert.deepEqual(SHIFT_ORDER, ['DAY', 'AFT', 'NIGHT']);
assert.equal(SHIFTS.NIGHT.label, 'Midnight');
assert.equal(SHIFTS.NIGHT.range, '23:45–07:15');
assert.equal(SHIFTS.NIGHT.start, 23 * 60 + 45);
assert.equal(SHIFTS.NIGHT.end, 7 * 60 + 15);
assert.deepEqual(breakRanges('NIGHT'), []);

assert.equal(shiftAt(at(7, 0)), 'DAY');
assert.equal(shiftAt(at(7, 14)), 'DAY', 'Day keeps the 07:00–07:15 overlap');
assert.equal(shiftAt(at(15, 30)), 'AFT');
assert.equal(shiftAt(at(23, 44)), 'AFT');
assert.equal(shiftAt(at(23, 45)), 'AFT', 'Afternoon keeps the floor through midnight');
assert.equal(shiftAt(at(23, 59)), 'AFT');
assert.equal(shiftAt(at(0, 0)), 'NIGHT');
assert.equal(shiftAt(at(6, 59)), 'NIGHT');

const early = shiftContextAt('2026-10-18', at(1, 30));
assert.deepEqual(
  { key: early.key, date: early.date, live: early.live },
  { key: 'NIGHT', date: '2026-10-17', live: true },
  '01:30 belongs to the Midnight shift that started the evening before',
);

const [from, to] = shiftWindow('2026-10-17', 'NIGHT');
const inside = (date) => date.getTime() >= from && date.getTime() < to;
assert.equal(inside(new Date(2026, 9, 17, 23, 50)), true);
assert.equal(inside(at(1, 30)), true);
assert.equal(inside(at(8, 0)), false);
const [nextFrom, nextTo] = shiftWindow('2026-10-18', 'NIGHT');
assert.equal(at(1, 30).getTime() >= nextFrom && at(1, 30).getTime() < nextTo, false);

state.tasks = [{ machine: 'fom1', wo: 'T-1', die: 'S80.104', source: 'cnc' }];
state.taskHistory = [{
  id: 'h1', key: 'fom1|T-1|S80.104', kind: 'status', to: 'DONE',
  at: at(1, 30).toISOString(),
}];
assert.equal(workInShift('fom1', '2026-10-17', 'NIGHT').length, 1);
assert.equal(workInShift('fom1', '2026-10-18', 'NIGHT').length, 0);

assert.equal(shiftRowHasContent({ targetPlan: { target: 10, unit: 'pieces' } }), true);
assert.equal(shiftRowHasContent({ targetPlan: { target: 0, unit: 'windows' } }), true);
assert.equal(shiftRowHasContent({ targetPlan: {} }), false);
assert.equal(shiftRowHasContent({ ops: '2' }), true);
assert.equal(shiftRowHasContent({}), false);

state.shiftLogs = {};
state.todos = {};
const savedKey = saveShiftLog('2026-10-17', 'NIGHT', {
  rows: { fom1: { notes: 'Sills done' } },
  notes: 'Midnight crew',
});
assert.equal(savedKey, '2026-10-17|NIGHT');
const blob = JSON.parse(memory.get('bv.cutting.v1'));
blob.shiftLogs['2026-08-01|NIGHT'] = {
  date: '2026-08-01', shift: 'NIGHT',
  rows: { fom1: { notes: 'old midnight' } },
};
memory.set('bv.cutting.v1', JSON.stringify(blob));
loadLocal();
assert.equal(state.shiftLogs['2026-08-01|NIGHT'].rows.fom1.notes, 'old midnight');
assert.equal(state.shiftLogs['2026-10-17|NIGHT'].notes, 'Midnight crew');

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch(chromiumOptions());
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((epoch) => {
    const RealDate = Date;
    const offset = epoch - RealDate.now();
    function ShopDate(...args) {
      const date = args.length ? new RealDate(...args) : new RealDate(RealDate.now() + offset);
      if (!new.target) return date.toString();
      return date;
    }
    ShopDate.prototype = RealDate.prototype;
    Object.setPrototypeOf(ShopDate, RealDate);
    ShopDate.now = () => RealDate.now() + offset;
    ShopDate.parse = RealDate.parse;
    ShopDate.UTC = RealDate.UTC;
    window.Date = ShopDate;
  }, new Date(2026, 9, 18, 1, 30, 0, 0).getTime());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('button', { name: 'Write handover', exact: true }).click();
  await page.getByRole('heading', { name: 'Shift update', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Shift date').inputValue(), '2026-10-17');
  assert.equal(await page.locator('.su-when .subtabs button', { hasText: 'Midnight' }).getAttribute('aria-current'), 'true');
  assert.match(await page.locator('.su-breaks').textContent(), /No scheduled breaks/);

  await page.locator('.mobile-su-step[title="FOM 1"]').click();
  await page.getByRole('heading', { name: /^FOM 1/ }).waitFor();
  const notes = page.locator('.mobile-su-editor textarea[aria-label="FOM 1 Notes"]');
  await notes.click();
  await notes.fill('Sills done');
  await notes.evaluate((el) => el.setSelectionRange(2, 5));
  await page.evaluate(async () => {
    const { save } = await import('/js/store.js');
    save();
  });
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-keep-focus')?.endsWith(':notes'));
  const caret = await page.evaluate(() => ({
    start: document.activeElement.selectionStart,
    end: document.activeElement.selectionEnd,
  }));
  assert.deepEqual(caret, { start: 2, end: 5 });

  await page.getByRole('button', { name: /^Save & next/ }).click();
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('bv.cutting.v1');
    return !!raw && JSON.parse(raw).shiftLogs?.['2026-10-17|NIGHT']?.rows?.fom1?.notes === 'Sills done';
  });

  await page.goto(`http://127.0.0.1:${server.address().port}/?monitor#overview`);
  await page.locator('.monitor-clock').waitFor();
  await page.locator('.monitor-clock').focus();
  await page.evaluate(async () => {
    const { save } = await import('/js/store.js');
    save();
  });
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-keep-focus') === 'monitor-clock');
  assert.deepEqual(errors, []);
  console.log('Midnight shift: creation, start-date rollover, saved history, phone focus and monitor clock OK');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
