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

const { SHIFTS, SHIFT_ORDER, shiftAt, shiftContextAt, shiftFor, breakRanges } = await import('../js/shifts.js');
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
assert.equal(shiftAt(at(20, 29)), 'AFT', 'Sunday Afternoon runs until 20:30');
assert.equal(shiftAt(at(20, 30)), 'NIGHT', 'Sunday Midnight starts at 20:30');
assert.equal(shiftAt(at(20, 45)), 'NIGHT');
assert.equal(shiftAt(at(23, 59)), 'NIGHT', 'Sunday evening stays on Midnight');
const monday = (hour, minute = 0) => new Date(2026, 9, 19, hour, minute, 0, 0);
assert.equal(shiftAt(monday(23, 44)), 'AFT');
assert.equal(shiftAt(monday(23, 45)), 'AFT', 'Monday night still lets Afternoon keep the floor until midnight');
assert.equal(shiftAt(monday(23, 59)), 'AFT');
assert.equal(shiftAt(at(0, 0)), 'NIGHT');
assert.equal(shiftAt(at(6, 59)), 'NIGHT');
assert.equal(shiftAt(monday(2, 0)), 'NIGHT');

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
assert.equal(new Date(nextFrom).getHours(), 20);
assert.equal(new Date(nextFrom).getMinutes(), 30);
assert.equal(new Date(nextTo).getDate(), 19);
assert.equal(new Date(nextTo).getHours(), 7);
assert.equal(new Date(nextTo).getMinutes(), 0);
const sundayAt = (hour, minute) => new Date(2026, 9, 18, hour, minute).getTime();
const mondayAt = (hour, minute) => new Date(2026, 9, 19, hour, minute).getTime();
assert.equal(sundayAt(20, 45) >= nextFrom && sundayAt(20, 45) < nextTo, true, '8:45 PM Sunday is on Sunday Midnight');
assert.equal(mondayAt(2, 0) >= nextFrom && mondayAt(2, 0) < nextTo, true, '2:00 AM Monday still belongs to Sunday Midnight');
assert.equal(sundayAt(20, 29) >= nextFrom && sundayAt(20, 29) < nextTo, false);
assert.equal(mondayAt(7, 0) >= nextFrom && mondayAt(7, 0) < nextTo, false);
const [mondayNight] = shiftWindow('2026-10-19', 'NIGHT');
assert.equal(new Date(mondayNight).getDate(), 19);
assert.equal(new Date(mondayNight).getHours(), 23);
assert.equal(new Date(mondayNight).getMinutes(), 45, 'Monday-night Midnight still starts at 23:45');
assert.equal(mondayAt(2, 0) >= mondayNight && mondayAt(2, 0) < shiftWindow('2026-10-19', 'NIGHT')[1], false);
assert.equal(shiftFor('NIGHT', '2026-10-18').range, '20:30–07:00');
assert.equal(shiftFor('NIGHT', '2026-10-19').range, '23:45–07:15');
assert.equal(shiftFor('AFT', '2026-10-19').range, '15:30–00:00');
const sundayEvening = shiftContextAt('2026-10-18', at(20, 45));
assert.deepEqual(
  { key: sundayEvening.key, date: sundayEvening.date, live: sundayEvening.live, range: sundayEvening.shift.range },
  { key: 'NIGHT', date: '2026-10-18', live: true, range: '20:30–07:00' },
);
const mondayMorning = shiftContextAt('2026-10-19', monday(2, 0));
assert.deepEqual(
  { key: mondayMorning.key, date: mondayMorning.date, live: mondayMorning.live, range: mondayMorning.shift.range },
  { key: 'NIGHT', date: '2026-10-18', live: true, range: '20:30–07:00' },
);
assert.deepEqual(breakRanges('AFT', '2026-10-18'), ['18:00–18:15', '20:00–20:30']);
assert.ok(breakRanges('AFT', '2026-10-19').includes('23:00–23:15'));

state.tasks = [{ machine: 'fom1', wo: 'T-1', die: 'S80.104', source: 'cnc' }];
state.taskHistory = [{
  id: 'h1', key: 'fom1|T-1|S80.104', kind: 'status', to: 'DONE',
  at: at(1, 30).toISOString(),
}];
assert.equal(workInShift('fom1', '2026-10-17', 'NIGHT').length, 1);
assert.equal(workInShift('fom1', '2026-10-18', 'NIGHT').length, 0);
state.tasks.push({ machine: 'fom1', wo: 'T-2', die: 'S80.104', source: 'cnc' });
state.taskHistory.push(
  { id: 'sun', key: 'fom1|T-1|S80.104', kind: 'status', to: 'DONE', at: at(20, 45).toISOString() },
  { id: 'mon', key: 'fom1|T-2|S80.104', kind: 'status', to: 'DONE', at: monday(2, 0).toISOString() },
);
assert.deepEqual(
  workInShift('fom1', '2026-10-18', 'NIGHT').map((item) => item.task.wo).sort(),
  ['T-1', 'T-2'],
  'Sunday 8:45 PM and Monday 2:00 AM are both Sunday Midnight',
);
assert.equal(workInShift('fom1', '2026-10-19', 'NIGHT').length, 0);
assert.equal(workInShift('fom1', '2026-10-17', 'NIGHT').map((item) => item.task.wo).join(','), 'T-1');

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
  assert.match(await page.locator('.centre-sub').innerText(), /23:45–07:15/);
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

  const sunday = await browser.newPage({ viewport: { width: 390, height: 844 } });
  sunday.on('pageerror', (error) => errors.push(error.message));
  await sunday.addInitScript((epoch) => {
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
  }, new Date(2026, 9, 18, 20, 45, 0, 0).getTime());
  await sunday.goto(`http://127.0.0.1:${server.address().port}/`);
  await sunday.getByRole('button', { name: 'Write handover', exact: true }).click();
  await sunday.getByRole('heading', { name: 'Shift update', exact: true }).waitFor();
  assert.equal(await sunday.getByLabel('Shift date').inputValue(), '2026-10-18');
  assert.equal(await sunday.locator('.su-when .subtabs button', { hasText: 'Midnight' }).getAttribute('aria-current'), 'true');
  assert.match(await sunday.locator('.centre-sub').innerText(), /20:30–07:00/);
  await sunday.locator('.su-date').fill('2026-10-19');
  await sunday.locator('.su-when .subtabs button', { hasText: 'Midnight' }).click();
  await sunday.waitForFunction(() => document.querySelector('.centre-sub')?.textContent.includes('23:45–07:15'));

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
