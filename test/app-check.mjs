/* End-to-end smoke test: serves the app, imports the real workbook, walks every
   tab, exercises progress entry, and fails on any console error.
   Run: node test/app-check.mjs [path-to-xlsx] */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import http from 'http';

const ROOT = path.resolve(import.meta.dirname, '..');
const XLSX = process.argv[2] ||
  '/root/.claude/uploads/042835a0-704b-5601-bc20-4ed82d27578f/6c674bbc-Daily_Schedule_Aug_10_Rev_B.xlsx';
const SHOT = path.join(ROOT, 'test', 'screens');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(ROOT, rel === '/' ? '/index.html' : rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

fs.mkdirSync(SHOT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n     STACK: ' + (e.stack||'').split('\n').slice(0,4).join(' | ')));

const step = (s) => console.log('  •', s);

await page.goto(base + '/index.html');
await page.waitForSelector('header.top');
step('app booted');

// identity
await page.evaluate(() => {
  const s = document.querySelector('header.top select');
  s.value = '__add';
});
await page.evaluate(() => {
  // set identity directly; prompt() is not available headless
  return import('/js/store.js').then((m) => {
    m.state.people.push('Abhay');
    m.state.settings.me = 'Abhay';
    m.save();
  });
});
step('identity set');

// import the workbook
await page.click('nav.tabs button:has-text("Setup")');
await page.waitForSelector('.drop');
const chooser = page.waitForEvent('filechooser');
await page.click('.drop button:has-text("Choose file")');
await (await chooser).setFiles(XLSX);
await page.waitForSelector('dialog .stat', { timeout: 60000 });
const importStats = await page.$$eval('dialog .stat', (ns) =>
  ns.map((n) => n.querySelector('.k').textContent + '=' + n.querySelector('.n').textContent));
step('import dialog: ' + importStats.join(' '));
await page.screenshot({ path: path.join(SHOT, '1-import.png') });

await page.click('dialog footer button.primary');
await page.waitForSelector('dialog', { state: 'detached' });
step('workbook loaded');

// today
await page.click('nav.tabs button:has-text("Dashboard")');
await page.waitForSelector('.stats');
const stats = await page.$$eval('main .stat', (ns) =>
  ns.map((n) => n.querySelector('.k').textContent + '=' + n.querySelector('.n').textContent));
step('dashboard stats: ' + stats.slice(0, 6).join(' '));
const cards = await page.$$eval('main .panel header', (ns) => ns.map((n) => n.childNodes[0]?.textContent?.trim()).filter(Boolean));
step('machine cards: ' + cards.filter((c) => /FOM|CNC|Rolling|Elumatec|Punch|Prep/.test(c)).join(', '));
await page.screenshot({ path: path.join(SHOT, '2-dashboard.png'), fullPage: true });

// board + order detail + progress entry
await page.click('nav.tabs button:has-text("Orders")');
await page.waitForSelector('table tbody tr');
const boardRows = await page.$$eval('table tbody tr', (r) => r.length);
step(`board rows: ${boardRows}`);
await page.screenshot({ path: path.join(SHOT, '3-board.png'), fullPage: false });

await page.click('table tbody tr');
await page.waitForSelector('dialog .oprow');
const opCount = await page.$$eval('dialog .oprow', (n) => n.length);
step(`order detail ops: ${opCount}`);

// enter progress into the first numeric op
const input = await page.$('dialog .opinput input');
if (input) {
  await input.fill('10');
  await input.dispatchEvent('change');
  await page.waitForTimeout(200);
  step('logged progress = 10');
}
// profile grouping + per-profile material + history trail
const profiles = await page.$$eval('dialog .row > strong', (ns) => ns.map((n) => n.textContent.trim()).filter((t) => /Widths|Heights|Vents|Louvers|Service|Hinges|Extra/.test(t)));
step('profiles on order: ' + profiles.join(', '));
const matSel = await page.$('dialog select');
if (matSel) {
  await matSel.selectOption('SHORT');
  await page.waitForTimeout(250);
  step('set a profile material to Short');
}
const hist = await page.$$eval('dialog .list li', (n) => n.length);
step('history entries on order: ' + hist);
await (await page.$('dialog')).screenshot({ path: path.join(SHOT, '4-order.png') });
await page.click('dialog footer button.primary');
await page.waitForSelector('dialog', { state: 'detached' });

// verify it persisted
const persisted = await page.evaluate(() => import('/js/store.js').then((m) => {
  const keys = Object.keys(m.state.progress);
  return keys.length ? { key: keys[0], val: m.state.progress[keys[0]] } : null;
}));
step('persisted progress: ' + JSON.stringify(persisted));

// manual (service) order
await page.click('button:has-text("+ Add order")');
await page.waitForSelector('dialog input');
await page.fill('dialog input', 'SO-2026-014');
await page.click('dialog footer button.primary');
await page.waitForTimeout(300);
const manual = await page.evaluate(() => import('/js/store.js').then((m) =>
  Object.values(m.state.manualOrders).filter((o) => !o.deleted).map((o) => o.wo)));
step('manual orders: ' + JSON.stringify(manual));

// an 8560 job should pick up Hinges automatically
const hinge = await page.evaluate(() => Promise.all([import('/js/model.js'), import('/js/store.js')])
  .then(([mm, st]) => {
    const o = st.state.orders.find((x) => ['1107', '1093', '1131', '1124'].includes(String(x.job)));
    if (!o) return 'no 8560 job found';
    return { wo: o.wo, job: o.job, hinges: mm.hingesApply(o),
             profiles: mm.profileRollup(o).map((r) => r.profile.label) };
  }));
step('8560 hinge rule: ' + JSON.stringify(hinge));

// materials
await page.click('nav.tabs button:has-text("Materials")');
await page.waitForSelector('main .panel');
const matCards = await page.$$eval('main .panel header', (ns) => ns.map((n) => n.childNodes[0]?.textContent?.trim()).filter(Boolean));
step('material profiles: ' + matCards.join(', '));
await page.screenshot({ path: path.join(SHOT, '9-materials.png'), fullPage: true });

// planner
await page.click('nav.tabs button:has-text("Planner")');
await page.waitForSelector('.panel');
await page.click('button:has-text("Add work")');
await page.waitForSelector('dialog .oprow input[type=checkbox]');
await page.click('dialog .oprow input[type=checkbox]');
await page.click('dialog footer button.primary');
await page.waitForTimeout(300);
step('planned an order');
await page.screenshot({ path: path.join(SHOT, '5-planner.png'), fullPage: true });

// shift log
await page.click('nav.tabs button:has-text("Shift Update")');
await page.waitForSelector('textarea');
await page.fill('table tbody tr:first-child textarea', '1- Parcel 29 service order complete');
await page.fill('.panel .body textarea', 'Blade change on Elumatec 2 at 11pm.');
await page.click('button:has-text("Post update")');
await page.waitForTimeout(300);
const logs = await page.$$eval('.list li', (n) => n.length);
step(`shift log entries: ${logs}`);
await page.screenshot({ path: path.join(SHOT, '6-shift.png'), fullPage: true });

// guide
await page.click('nav.tabs button:has-text("Guide")');
await page.waitForSelector('.doc');
const docs = await page.$$eval('main .panel[id^="doc-"]', (n) => n.length);
step(`guide sections: ${docs}`);
await page.screenshot({ path: path.join(SHOT, '7-guide.png'), fullPage: true });

// phone layout
await page.setViewportSize({ width: 390, height: 844 });
await page.click('nav.tabs button:has-text("Dashboard")');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOT, '8-phone.png'), fullPage: true });
step('phone layout captured');

// reload -> data survives
await page.setViewportSize({ width: 1440, height: 950 });
await page.reload();
await page.waitForSelector('header.top');
const after = await page.evaluate(() => import('/js/store.js').then((m) => ({
  orders: m.state.orders.length,
  progress: Object.keys(m.state.progress).length,
  logs: Object.keys(m.state.shiftLogs).length,
  me: m.state.settings.me,
})));
step('after reload: ' + JSON.stringify(after));

console.log('\nERRORS:', errors.length ? '\n  ' + errors.join('\n  ') : 'none');
await browser.close();
server.close();
process.exit(errors.length ? 1 : 0);
