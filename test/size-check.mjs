/* Weight budgets for the two builds.

   This app is opened on shop-floor phones over site wifi and on a wall panel
   that nobody is going to sit and watch load. Its weight is a feature, and the
   thing about weight is that nobody notices it going wrong: a stray top-level
   import pulls a megabyte into the first paint, or one line in site-build.mjs
   stops excluding a file and every first visit quietly starts warming 28 MB in
   the background. Neither breaks a test, neither shows up in a diff review, and
   both are found weeks later by somebody standing in a bay waiting.

   So the numbers are asserted. The budgets sit roughly 20% above what the build
   measures today — enough that ordinary work does not trip them, tight enough
   that a step change does. When one fires, the fix is usually to move code
   behind a dynamic import, not to raise the number; raising it is a decision
   worth making on purpose, which is the point of it being written down.

   Run: node test/size-check.mjs   (needs `npm run build:site` and `npm run build`)
*/

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { chromiumOptions } from './env.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, '_site');
const KB = 1024;
const MB = 1024 * 1024;

const errors = [];
const note = (m) => console.log('  • ' + m);
const fail = (m) => { errors.push(m); console.log('  ✗ ' + m); };

/** Assert a measured size against a budget, and say how much room is left —
    a budget you cannot see yourself approaching is one you only meet by
    breaking it. */
function budget(what, actual, limit, unit = KB, suffix = 'KB') {
  const a = actual / unit;
  const l = limit / unit;
  const room = Math.round(((limit - actual) / limit) * 100);
  if (actual > limit) {
    fail(`${what} is ${a.toFixed(1)} ${suffix}, over its ${l.toFixed(1)} ${suffix} budget`);
  } else {
    note(`${what}: ${a.toFixed(1)} ${suffix} of ${l.toFixed(1)} ${suffix} (${room}% spare)`);
  }
}

if (!fs.existsSync(OUT)) {
  console.log('  ✗ _site is missing — run `npm run build:site` first');
  process.exit(1);
}

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

const files = walk(OUT).map((f) => ({
  rel: path.relative(OUT, f).replaceAll(path.sep, '/'),
  size: fs.statSync(f).size,
}));
const sizeOf = Object.fromEntries(files.map((f) => [f.rel, f.size]));
const total = files.reduce((n, f) => n + f.size, 0);

/* ---------- the offline shell ---------- */

/* Every asset in this list is fetched in the background on a first visit,
   whether or not the person opens the page that needs it. That is the right
   trade for the die drawings the floor works from and the wrong one for the
   24 MB extrusion image map, which is why the map is fetched only when someone
   opens a profile. Losing that exclusion is the single most expensive mistake
   available in this build, and it is one line. */
const sw = fs.readFileSync(path.join(OUT, 'sw.js'), 'utf8');
const marked = sw.match(/__PRECACHE_START__ \*\/([\s\S]*?)\/\* __PRECACHE_END__/);
if (!marked) {
  fail('sw.js has no precache manifest — the offline shell would be empty');
} else {
  const precache = JSON.parse(marked[1].trim()).map((s) => s.replace(/^\.\//, ''));
  const missing = precache.filter((rel) => !(rel in sizeOf));
  if (missing.length) fail(`precache lists files the build did not produce: ${missing.join(', ')}`);

  const NEVER_PRECACHE = ['js/extrusion-images.js', 'js/photo-todos.js'];
  for (const rel of NEVER_PRECACHE) {
    if (precache.includes(rel)) {
      fail(`${rel} (${(sizeOf[rel] / MB).toFixed(1)} MB) is in the offline shell`
        + ' — every first visit would download it in the background');
    }
  }
  const documents = precache.filter((rel) => /\.(pdf|docx|xlsx|pptx)$/i.test(rel));
  if (documents.length) {
    fail(`department documents are in the offline shell (${documents.join(', ')})`
      + ' — forms should cache only after first use');
  }

  const shell = precache.reduce((n, rel) => n + (sizeOf[rel] || 0), 0);
  note(`offline shell: ${precache.length} assets`);
  budget('offline shell', shell, 6 * MB, MB, 'MB');

  /* One file is three quarters of the shell. Naming it here means a second
     one that size gets noticed as a decision rather than absorbed. */
  const heaviest = precache
    .map((rel) => ({ rel, size: sizeOf[rel] || 0 }))
    .sort((a, b) => b.size - a.size)[0];
  note(`heaviest shell asset: ${heaviest.rel} at ${(heaviest.size / MB).toFixed(2)} MB`
    + ` — ${Math.round((heaviest.size / shell) * 100)}% of the shell`);
  budget('heaviest shell asset', heaviest.size, 4.5 * MB, MB, 'MB');
}

/* ---------- the whole hosted build ---------- */

/* The controlled forms library is a deliberate download archive, not app
   startup weight. Keep its own ceiling and retain the original 32 MB budget
   for everything else so adding documents cannot hide core growth. */
const formLibrary = files
  .filter((file) => file.rel.startsWith('assets/forms/'))
  .reduce((sum, file) => sum + file.size, 0);
budget('forms library', formLibrary, 13 * MB, MB, 'MB');
budget('hosted app excluding forms', total - formLibrary, 32 * MB, MB, 'MB');
budget('hosted build', total, 45 * MB, MB, 'MB');
budget('initial HTML', sizeOf['index.html'] || 0, 4 * KB);

/* ---------- the standalone rollback ---------- */

/* The single file that goes on the shared drive when the hosted app is not
   reachable. It carries everything, so it is allowed to be large — but it has
   to stay a file somebody can actually copy and a browser can actually open. */
const standalone = path.join(ROOT, 'Cutting-Tracker.html');
if (!fs.existsSync(standalone)) {
  fail('Cutting-Tracker.html is missing — run `npm run build` first');
} else {
  budget('standalone rollback', fs.statSync(standalone).size, 34 * MB, MB, 'MB');
}

/* ---------- what a first visit actually costs ---------- */

/* The shell is what gets warmed in the background; this is what has to arrive
   before anybody can do anything, which is the number a person on site wifi
   experiences. Measured by loading the built site and adding up every response,
   rather than by reasoning about the import graph — a lazy boundary that has
   quietly stopped being lazy looks exactly the same in the source. */
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml',
};
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(OUT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(OUT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('no'); return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch(chromiumOptions());
const ctx = await browser.newContext();
const page = await ctx.newPage();
const got = new Map();
page.on('response', async (res) => {
  try { got.set(new URL(res.url()).pathname, (await res.body()).length); } catch { /* redirect or aborted */ }
});
await page.goto(`${base}/#rolling`, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await ctx.close();
await browser.close();
server.close();

const firstLoad = [...got.values()].reduce((n, s) => n + s, 0);
budget('first load', firstLoad, 1100 * KB);
if (got.size > 40) fail(`first load takes ${got.size} requests, over the budget of 40`);
else note(`first load: ${got.size} requests of 40`);

/* The lazy boundaries, checked by their weight rather than by their syntax. */
for (const heavy of ['js/extrusion-images.js', 'js/drawings.js', 'js/die-drawings.js']) {
  if (!(heavy in sizeOf)) continue;
  if (got.has('/' + heavy)) {
    fail(`${heavy} (${(sizeOf[heavy] / MB).toFixed(2)} MB) is fetched on first load`
      + ' — its dynamic import boundary has been lost');
  }
}
note('heavy modules stayed behind their lazy boundaries on first load');

/* The lazy routes, pinned.

   The obvious version of this check reads the lazyView() calls out of app.js
   and asserts none of them is fetched. It does not work, and the way it fails
   is instructive: converting a route back to a static import *removes* its
   lazyView() call, so the list shrinks and the check goes quiet about exactly
   the change it exists to catch. Measured — making Employees eager that way
   cost 20 KB and a request, and the derived check passed.

   So the set is written down. Which pages are lazy is a product decision, not
   an implementation detail, and a diff that drops one should be something a
   reviewer has to look at rather than something a regex stops mentioning.

   Two assertions, because there are two ways to lose a boundary: the
   registration can disappear, or it can survive while something else drags the
   module into the shell anyway. */
const LAZY_ROUTES = [
  'js/views/dies.js', 'js/views/schedule.js', 'js/views/projects.js',
  'js/views/resources.js', 'js/views/employees.js', 'js/views/shiftupdate.js',
  'js/views/materials.js',
];
const shell = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const registered = [...shell.matchAll(/lazyView\(\s*\(\)\s*=>\s*import\('\.\/([^']+)'\)/g)]
  .map((match) => 'js/' + match[1]).sort();
const expected = [...LAZY_ROUTES].sort();
if (registered.join(',') !== expected.join(',')) {
  const lost = expected.filter((rel) => !registered.includes(rel));
  const added = registered.filter((rel) => !expected.includes(rel));
  fail('the set of lazy routes changed'
    + (lost.length ? ` — ${lost.join(', ')} no longer loads on demand` : '')
    + (added.length ? ` — ${added.join(', ')} is new; add it to LAZY_ROUTES` : ''));
}
const eager = LAZY_ROUTES.filter((rel) => got.has('/' + rel));
if (eager.length) {
  const cost = eager.reduce((n, rel) => n + (sizeOf[rel] || 0), 0);
  fail(`${eager.join(', ')} (${(cost / KB).toFixed(1)} KB) loaded on first paint`
    + ' — a lazy route has lost its dynamic import');
} else {
  note(`${LAZY_ROUTES.length} lazy routes stayed off the first load:`
    + ` ${LAZY_ROUTES.map((rel) => rel.replace('js/views/', '')).join(', ')}`);
}

if (got.has('/js/photo-todos.js')) {
  fail('js/photo-todos.js is fetched on first load — an online-only feature lost its lazy boundary');
} else {
  note('Photo to To-Do stayed behind its on-demand boundary');
}

console.log(errors.length ? '\nERRORS:\n  ' + errors.join('\n  ') : '\nERRORS: none');
process.exit(errors.length ? 1 : 0);
