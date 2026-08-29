/* What the workbooks actually contain, measured rather than assumed.

   Not part of `npm test`. It needs the real Rolling and CNC workbooks, which
   never enter the repository, and it asserts nothing — it reports. The point is
   that every number in the data findings can be re-derived on demand instead of
   ageing into a claim nobody can check. Run it against a newer pair of
   workbooks and the same questions get answered about those.

   Run: node test/data-audit.mjs
        BV_ROLLING_WORKBOOK=... BV_CNC_WORKBOOK=... node test/data-audit.mjs

   It reads through the app's own xlsx reader, not a second implementation, so
   what it sees is what the app would see. */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { ROOT, workbookPaths, chromiumOptions } from './env.mjs';

const books = workbookPaths();
if (books.synthetic) {
  console.log('  ! Using generated workbooks — this audit is only meaningful against the real ones.');
  console.log('    Set BV_ROLLING_WORKBOOK and BV_CNC_WORKBOOK.');
}

const browser = await chromium.launch(chromiumOptions());
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  if (url.hostname !== 'app.local') return route.continue();
  const file = path.join(ROOT, url.pathname);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return route.fulfill({ status: 404, body: 'no' });
  }
  return route.fulfill({
    status: 200,
    contentType: path.extname(file) === '.js' ? 'text/javascript' : 'text/html',
    body: fs.readFileSync(file),
  });
});
const harness = path.join(ROOT, '__audit.html');
fs.writeFileSync(harness, '<!doctype html><meta charset=utf-8><body>audit</body>');
await page.goto('http://app.local/__audit.html');

const b64 = {
  rolling: fs.readFileSync(books.rolling).toString('base64'),
  cnc: fs.readFileSync(books.cnc).toString('base64'),
};

const out = await page.evaluate(async (files) => {
  const toBuf = (s) => {
    const bin = atob(s);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a.buffer;
  };
  const { readXlsx } = await import('/js/xlsx.js');
  const { importMachineWorkbook } = await import('/js/import-machines.js');
  const { dieForms } = await import('/js/dies.js');

  /* Every sheet, so the audit can speak about the ones the importer skips.
     `hidden` is the department's own filing: a hidden tab is one they have
     archived, which is the difference between a sheet the app overlooks and a
     sheet nobody is using either. */
  const raw = {};
  for (const [kind, data] of Object.entries(files)) {
    // maxRows caps the million-row scratch sheet the workbook carries; every
    // real sheet here is far under it.
    const book = await readXlsx(toBuf(data), { only: () => true, maxRows: 6000 });
    raw[kind] = { ...book, hiddenSheets: [...book.hiddenSheets] };
  }

  const roll = await importMachineWorkbook(toBuf(files.rolling), { kind: 'rolling', fileName: 'rolling.xlsx' });
  const cnc = await importMachineWorkbook(toBuf(files.cnc), { kind: 'cnc', fileName: 'cnc.xlsx' });
  const tasks = roll.tasks.concat(cnc.tasks).filter((t) => !t.archived);
  const open = tasks.filter((t) => t.status !== 'DONE');

  /* ---- sheets: read, visible-but-unread, archived ---- */
  const READ = new Set(['Auto', 'Manual', 'Complete', 'FOM1', 'FOM2', 'FOM3',
    'CNC & FMC', 'MultiPunch & SAW', 'Shift Update']);
  const sheetReport = {};
  for (const [kind, book] of Object.entries(raw)) {
    const names = book.sheetNames || Object.keys(book.sheets || {});
    const hidden = new Set(book.hiddenSheets || []);
    const rowsOf = (n) => (book.sheets?.[n]?.rows?.filter((r) => !r.empty).length ?? 0);
    sheetReport[kind] = {
      total: names.length,
      read: names.filter((n) => READ.has(n)),
      readButHidden: names.filter((n) => READ.has(n) && hidden.has(n)),
      visibleUnread: names.filter((n) => !hidden.has(n) && !READ.has(n))
        .map((n) => ({ sheet: n, rows: rowsOf(n) }))
        .sort((a, b) => b.rows - a.rows),
      archived: names.filter((n) => hidden.has(n)).length,
    };
  }

  /* ---- what the workbooks call their machines ---- */
  const machineWords = {};
  for (const book of Object.values(raw)) {
    for (const sheet of Object.values(book.sheets || {})) {
      for (const row of sheet.rows || []) {
        for (const cell of row.cells) {
          const s = String(cell ?? '').trim();
          if (!s || s.length > 18) continue;
          if (!/^(cnc|fmc|elu|elumatec|notch|saw|multi ?punch)\b/i.test(s)) continue;
          const k = s.toUpperCase().replace(/\s+/g, ' ');
          machineWords[k] = (machineWords[k] || 0) + 1;
        }
      }
    }
  }
  const machineNames = Object.entries(machineWords)
    .sort((a, b) => b[1] - a[1]).slice(0, 14);

  /* ---- columns the app promises but the books do not fill ---- */
  const filled = (field) => open.filter((t) => String(t[field] ?? '').trim()).length;
  const fom2 = tasks.filter((t) => t.machine === 'fom2');

  /* ---- die identity ---- */
  const spellings = new Map();
  for (const t of tasks) {
    const d = String(t.die || '').trim();
    if (!d) continue;
    const sa = dieForms(d).sa;
    if (!sa) continue;
    if (!spellings.has(sa)) spellings.set(sa, new Set());
    spellings.get(sa).add(d);
  }
  const split = [...spellings.entries()].filter(([, v]) => v.size > 1)
    .map(([sa, v]) => ({ sa, spellings: [...v] }));
  const unrecognised = [...new Set(tasks.map((t) => t.die).filter(Boolean))]
    .filter((d) => !dieForms(d).sa);

  return {
    sheets: sheetReport,
    machineNames,
    tasks: tasks.length,
    open: open.length,
    coverage: {
      cuttingDate: filled('cuttingDate'),
      shipDate: filled('shipDate'),
      comments: filled('comments'),
      die: filled('die'),
    },
    fom2Rows: fom2.length,
    fom2With8560: fom2.filter((t) => /8560/i.test(String(t.pinHole || ''))).length,
    unassignedCnc: open.filter((t) => t.machine === 'cncfmc').length,
    dieStrings: new Set(tasks.map((t) => String(t.die || '').trim()).filter(Boolean)).size,
    dieComponents: spellings.size,
    splitSpellings: split,
    unrecognised,
  };
}, b64);

fs.unlinkSync(harness);
await browser.close();

const line = (s = '') => console.log(s);
const rule = (t) => line(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`);

rule('sheets');
for (const [kind, s] of Object.entries(out.sheets)) {
  line(`${kind}: ${s.total} sheets — ${s.read.length} read, ${s.archived} hidden by the department`);
  if (s.readButHidden.length) {
    line(`  read despite being hidden: ${s.readButHidden.join(', ')}`);
  }
  line(`  visible and unread (${s.visibleUnread.length}) — these are tabs in daily use:`);
  for (const v of s.visibleUnread.slice(0, 12)) line(`    ${String(v.rows).padStart(6)} rows  ${v.sheet}`);
}

rule('what the workbooks call their machines');
for (const [name, n] of out.machineNames) line(`  ${String(n).padStart(5)}×  ${name}`);

rule('column coverage on open lines');
line(`  ${out.open} open of ${out.tasks} lines`);
for (const [field, n] of Object.entries(out.coverage)) {
  const pct = out.open ? Math.round((n / out.open) * 100) : 0;
  line(`  ${field.padEnd(13)} ${String(n).padStart(5)} of ${out.open}  (${pct}%)`);
}
line(`  FOM 2 rows carrying an 8560 marker: ${out.fom2With8560} of ${out.fom2Rows}`);
line(`  CNC lines importing with no machine: ${out.unassignedCnc}`);

rule('die identity');
line(`  ${out.dieStrings} distinct die strings in the books`);
line(`  ${out.dieComponents} recognised components + ${out.unrecognised.length} unrecognised strings`);
line(`  ${out.splitSpellings.length} components spelled more than one way:`);
for (const s of out.splitSpellings) line(`    ${s.sa.padEnd(12)} ${s.spellings.join('  ')}`);
line(`  ${out.unrecognised.length} strings the die parser does not recognise:`);
line(`    ${out.unrecognised.join(', ')}`);
line();
