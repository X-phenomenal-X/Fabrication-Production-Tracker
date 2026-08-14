/* Parses the Rolling and CNC workbooks and reports what came out.
   Run: node test/machines-check.mjs */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = '/root/.claude/uploads/042835a0-704b-5601-bc20-4ed82d27578f';
const FILES = {
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
  const { importMachineWorkbook } = await import('/js/import-machines.js');

  const roll = await importMachineWorkbook(toBuf(b64.rolling), { kind: 'rolling', fileName: 'Rolling.xlsx' });
  const cnc = await importMachineWorkbook(toBuf(b64.cnc), { kind: 'cnc', fileName: 'CNC.xlsx' });
  const tasks = roll.tasks.concat(cnc.tasks);

  const byMachine = {};
  const byStatus = {};
  for (const t of tasks) {
    byMachine[t.machine] = (byMachine[t.machine] || 0) + 1;
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  }

  const open = tasks.filter((t) => !t.archived && t.status !== 'DONE');
  const openBackOrder = open.filter((t) => t.backOrder);
  // A line that is running AND short of material: the case that used to
  // collapse into a plain "In progress" and lose the back-order half.
  const runningAndShort = open.filter((t) => t.status === 'IP' && t.backOrder);

  const su = cnc.shiftUpdate;
  return {
    rollingSheets: roll.report.sheets,
    cncSheets: cnc.report.sheets,
    shiftUpdate: {
      ...cnc.report.shiftUpdate,
      entries: Object.fromEntries(Object.entries(su.machines).map(([k, e]) =>
        [k, `${e.label} · ${e.date} ${e.shift} · ${e.done.length} done / ${e.next.length} next`])),
    },
    totalTasks: tasks.length,
    open: open.length,
    byMachine,
    byStatus,
    openBackOrder: openBackOrder.length,
    runningAndShort: runningAndShort.length,
    withCuttingDate: open.filter((t) => t.cuttingDate).length,
    dies: new Set(tasks.map((t) => t.die).filter(Boolean)).size,
    sample: open[0],
  };
}, b64);

console.log(JSON.stringify(out, null, 2).slice(0, 3000));

if (out.totalTasks < 3000) throw new Error(`expected ~3900 tasks, got ${out.totalTasks}`);
if (!out.runningAndShort) throw new Error('expected some lines that are both IP and back-ordered');
console.log('\nOK');

fs.unlinkSync(harness);
await browser.close();
