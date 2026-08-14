/* Parses the Rolling and CNC workbooks and verifies them against the Daily
   Schedule. Run: node test/machines-check.mjs */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = '/root/.claude/uploads/042835a0-704b-5601-bc20-4ed82d27578f';
const FILES = {
  daily: `${DIR}/6c674bbc-Daily_Schedule_Aug_10_Rev_B.xlsx`,
  rolling: `${DIR}/da7bb9f1-Rolling_Schedule_2026.xlsx`,
  cnc: `${DIR}/bae855fd-CNC_Schedule_Rev_E.xlsx`,
};

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.hostname !== 'app.local') return route.continue();
  const f = path.join(ROOT, url.pathname);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return route.fulfill({ status: 404, body: 'nf' });
  const ext = path.extname(f);
  return route.fulfill({
    status: 200,
    contentType: ext === '.js' ? 'text/javascript' : 'text/html',
    body: fs.readFileSync(f),
  });
});

const harness = path.join(ROOT, '__mharness.html');
fs.writeFileSync(harness, '<!doctype html><meta charset=utf-8><body>h</body>');
await page.goto('http://app.local/__mharness.html');

const b64 = Object.fromEntries(
  Object.entries(FILES).map(([k, v]) => [k, fs.readFileSync(v).toString('base64')]));

const out = await page.evaluate(async (b64) => {
  const toBuf = (s) => {
    const bin = atob(s);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a.buffer;
  };
  const { importMachineWorkbook, verifyAgainstDaily } = await import('/js/import-machines.js');
  const { importWorkbook } = await import('/js/import.js');

  const roll = await importMachineWorkbook(toBuf(b64.rolling), { kind: 'rolling', fileName: 'Rolling.xlsx' });
  const cnc = await importMachineWorkbook(toBuf(b64.cnc), { kind: 'cnc', fileName: 'CNC.xlsx' });
  const daily = await importWorkbook(toBuf(b64.daily), { fileName: 'Daily.xlsx' });

  const tasks = roll.tasks.concat(cnc.tasks);
  const v = verifyAgainstDaily(tasks, daily.orders);

  const byMachine = {};
  const byStatus = {};
  for (const t of tasks) {
    byMachine[t.machine] = (byMachine[t.machine] || 0) + 1;
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  }
  const kinds = {};
  for (const i of v.issues) kinds[i.kind] = (kinds[i.kind] || 0) + 1;

  const live = tasks.filter((t) => !t.archived && t.status !== 'DONE');
  const withSetup = tasks.filter((t) => t.setup).length;
  const pinHole = tasks.filter((t) => t.pinHole).length;

  return {
    rollingSheets: roll.report.sheets, cncSheets: cnc.report.sheets,
    totalTasks: tasks.length, live: live.length,
    byMachine, byStatus,
    withSetup, pinHole,
    dieCount: new Set(tasks.map((t) => t.die).filter(Boolean)).size,
    verify: {
      machineWos: v.machineWos, dailyWos: v.dailyWos, matched: v.matched,
      issues: v.issues.length, kinds,
      notScheduled: v.notScheduled.length,
      sampleIssues: v.issues.slice(0, 4).map((i) => ({ kind: i.kind, wo: i.wo, detail: i.detail })),
    },
    sampleTask: live[0],
  };
}, b64);

console.log(JSON.stringify(out, null, 2).slice(0, 4200));
fs.unlinkSync(harness);
await browser.close();
