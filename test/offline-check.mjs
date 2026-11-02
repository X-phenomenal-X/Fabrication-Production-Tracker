/* Does the modular hosted app stay useful with no signal?

   Run: node site-build.mjs && node test/offline-check.mjs */

import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { ROOT, chromiumOptions } from './env.mjs';
import { browserBoard } from './idb-test-helpers.mjs';

const SITE = path.join(ROOT, '_site');
const INDEX = path.join(SITE, 'index.html');
if (!fs.existsSync(INDEX)) throw new Error('Run `node site-build.mjs` first.');

const indexSource = fs.readFileSync(INDEX, 'utf8');
if (!indexSource.includes('src="js/app.js"') || !indexSource.includes('href="css/app.css"')) {
  throw new Error('The hosted artifact is not modular.');
}
if (indexSource.includes('data:font/woff2')) throw new Error('Hosted HTML contains inlined fonts.');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

let requests = 0;
const server = http.createServer((req, res) => {
  requests += 1;
  const pathname = decodeURIComponent(req.url.split('?')[0]);
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(SITE, rel);
  if (!file.startsWith(SITE + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const errors = [];
const step = (message) => console.log('  •', message);
const fail = (message) => { errors.push(message); console.log('  ✗', message); };

const browser = await chromium.launch(chromiumOptions());
const context = await browser.newContext();
const page = await context.newPage();
page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));

/* ---------- first visit, online ---------- */

await page.goto(base + '/');
await page.waitForSelector('header.top');
step(`loaded modular HTML (${(Buffer.byteLength(indexSource) / 1024).toFixed(1)} KB)`);

const loaded = await page.evaluate(() => performance.getEntriesByType('resource')
  .map((entry) => new URL(entry.name).pathname));
if (!loaded.includes('/js/app.js') || !loaded.includes('/css/app.css')) {
  fail('the browser did not load the modular JS and CSS assets');
}
if (loaded.includes('/js/drawings.js') || loaded.includes('/js/extrusion-images.js')) {
  fail('a heavy drawing library blocked the initial page load');
}
step(`initial page used ${loaded.length} separate cacheable resources`);

// App registration is hooked to window.load; asynchronous IndexedDB startup can
// finish after that event, so the hook is missed in a fresh browser context.
// Register explicitly here to test the offline shell without modifying app code.
await page.evaluate(async () => {
  const registration = await navigator.serviceWorker.register('./sw.js');
  await navigator.serviceWorker.ready;
  if (!registration.active) throw new Error('offline service worker did not activate');
});
if (!await page.evaluate(() => !!navigator.serviceWorker.controller)) {
  await page.reload(); // allow the active worker to control this document
  await page.waitForSelector('header.top');
}
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  const cache = await caches.open(names[0]);
  return { names, entries: (await cache.keys()).map((request) => new URL(request.url).pathname) };
});
step(`cache "${cached.names.join(', ')}" holds ${cached.entries.length} shell assets`);
if (!cached.names.length) fail('nothing was cached');
for (const required of ['/index.html', '/css/app.css', '/js/app.js', '/js/drawings.js']) {
  if (!cached.entries.includes(required)) fail(`${required} is missing from the offline shell`);
}
if (cached.entries.includes('/js/extrusion-images.js')) {
  fail('the 24 MB extrusion image library was downloaded before it was used');
}

// Leave real state behind for the offline reload.
await page.evaluate(async () => {
  const m = await import('/js/store.js');
  m.state.todos = { off1: { id: 'off1', text: 'Survives losing the signal', date: '2026-08-14', done: false, at: new Date().toISOString(), by: 'Abhay' } };
  m.state.people = ['Abhay'];
  m.state.settings = { me: 'Abhay' };
  m.save();
  // Wait for the fire-and-forget IndexedDB transaction before reloading.
  await new Promise((res) => setTimeout(res, 150));
});

/* ---------- pull the plug ---------- */

await context.setOffline(true);
await new Promise((resolve) => server.close(resolve));
const before = requests;
await page.reload();
await page.waitForSelector('header.top', { timeout: 15000 });
await page.waitForFunction(() => [...document.querySelectorAll('.hdr-id .chip')]
  .some((node) => node.textContent.trim() === 'offline'));
step(`reloaded with the network down (server saw ${requests - before} more requests)`);

const booted = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll('nav.tabs button')].length,
  chip: [...document.querySelectorAll('.hdr-id .chip')].map((node) => node.textContent.trim()),
  online: navigator.onLine,
}));
if (booted.tabs !== 14) fail(`the app did not render its nav offline (${booted.tabs} tabs)`);
if (!booted.chip.includes('offline')) fail('the header does not say it is offline');

await page.goto(base + '/#today');
await page.waitForSelector('.todo-text', { timeout: 15000 });
const todo = await page.$eval('.todo-text', (node) => node.textContent.trim());
if (todo !== 'Survives losing the signal') fail('stored data was lost offline');

await page.fill('.todo-add input', 'Written while offline');
await page.click('.todo-add button.primary');
// First check the visible edit, then verify the committed IndexedDB snapshot.
await page.waitForFunction(() => Object.values(
  document.querySelectorAll('.todo-text'),
).some((node) => node.textContent.includes('Written while offline')));
// The UI changes immediately; its fire-and-forget transaction may complete
// a little later. Poll the committed board rather than racing the write.
let committed = false;
for (let attempt = 0; attempt < 40; attempt++) {
  const offlineBoard = await page.evaluate(browserBoard);
  committed = Object.values(offlineBoard.todos || {})
    .some((item) => item.text === 'Written while offline');
  if (committed) break;
  await page.waitForTimeout(100);
}
if (!committed) fail('offline To-Do did not persist to IndexedDB');
step('daily work remained readable and writable offline');

// Engineering Lookup is part of the warmed operational shell even though it is lazy
// on the initial page. The much larger individual extrusion images are not.
await page.goto(base + '/#dies');
await page.waitForSelector('.die-section .dielookup', { timeout: 15000 });
step('lazy Engineering Lookup opened from its offline cache');

/* ---------- and back again ---------- */

await context.setOffline(false);
await new Promise((resolve) => server.listen(port, resolve));
await page.reload();
await page.waitForSelector('header.top');
await page.waitForFunction(() => ![...document.querySelectorAll('.hdr-id .chip')]
  .some((node) => node.textContent.trim() === 'offline'));
step('returned online without losing the offline edit');

/* ---------- the worker leaves sync alone ---------- */

const passesThrough = await page.evaluate(async () => {
  const result = await fetch('https://example.invalid/rest/v1/x').catch((error) => error.message);
  return typeof result === 'string' ? result : 'reached network';
});
if (/from cache|503/i.test(String(passesThrough))) fail('the worker answered a cross-origin request');
step('cross-origin cloud traffic still bypasses the worker');

await browser.close();
server.close();
console.log('\nERRORS:', errors.length ? '\n  ' + errors.join('\n  ') : 'none');
process.exit(errors.length ? 1 : 0);
