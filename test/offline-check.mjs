/* Does the tracker open with no signal?

   Serves the built site the way GitHub Pages does — Cutting-Tracker.html as
   index.html, plus the manifest and the worker — then loads it once online,
   cuts the network, and reloads. The app must boot, keep its data, and say
   that it is offline.

   Run: node build.mjs && node test/offline-check.mjs */

import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { ROOT, chromiumOptions } from './env.mjs';

const BUILT = path.join(ROOT, 'Cutting-Tracker.html');
if (!fs.existsSync(BUILT)) throw new Error('Run `node build.mjs` first.');

/* The published site, assembled exactly as .github/workflows/pages.yml does. */
const SITE = {
  '/': [fs.readFileSync(BUILT), 'text/html'],
  '/index.html': [fs.readFileSync(BUILT), 'text/html'],
  '/manifest.webmanifest': [fs.readFileSync(path.join(ROOT, 'manifest.webmanifest')), 'application/manifest+json'],
  '/sw.js': [
    Buffer.from(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').replace('__BUILD__', 'testbuild')),
    'text/javascript',
  ],
};

let requests = 0;
const server = http.createServer((req, res) => {
  requests += 1;
  const hit = SITE[req.url.split('?')[0]];
  if (!hit) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': hit[1] });
  res.end(hit[0]);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const errors = [];
const step = (s) => console.log('  •', s);
const fail = (m) => { errors.push(m); console.log('  ✗', m); };

const browser = await chromium.launch(chromiumOptions());
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

/* ---------- first visit, online ---------- */

await page.goto(base + '/');
await page.waitForSelector('header.top');
step('loaded online');

// The worker has to be in control before anything can be served from it.
await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
step('service worker took control');

const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  const c = await caches.open(names[0]);
  return { caches: names, entries: (await c.keys()).map((r) => new URL(r.url).pathname) };
});
step(`cache "${cached.caches.join(', ')}" holds: ${cached.entries.join(', ')}`);
if (!cached.caches.length) fail('nothing was cached');

// Leave something behind, so the offline reload can be checked for real data
// rather than just an empty shell.
await page.evaluate(() => import('/js/store.js').catch(() => null));
await page.evaluate(() => {
  const raw = localStorage.getItem('bv.cutting.v1');
  const snap = raw ? JSON.parse(raw) : {};
  snap.todos = { off1: { id: 'off1', text: 'Survives losing the signal', date: '2026-08-14', done: false, at: new Date().toISOString(), by: 'Abhay' } };
  snap.people = ['Abhay'];
  snap.settings = { me: 'Abhay' };
  localStorage.setItem('bv.cutting.v1', JSON.stringify(snap));
});

/* ---------- pull the plug ---------- */

await ctx.setOffline(true);
// Chromium may exempt loopback traffic from network emulation. Stop the
// origin too, so the worker has to take its real cached-fallback path.
await new Promise((r) => server.close(r));
const before = requests;
await page.reload();
await page.waitForSelector('header.top', { timeout: 15000 });
await page.waitForFunction(() => [...document.querySelectorAll('.hdr-id .chip')]
  .some((n) => n.textContent.trim() === 'offline'));
step(`reloaded with the network down (server saw ${requests - before} more requests)`);

const booted = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll('nav.tabs button')].length,
  chip: [...document.querySelectorAll('.hdr-id .chip')].map((n) => n.textContent.trim()),
  online: navigator.onLine,
}));
step('offline boot: ' + JSON.stringify(booted));
if (booted.tabs !== 12) fail(`the app did not render its nav offline (${booted.tabs} tabs)`);
if (!booted.chip.includes('offline')) fail('the header does not say it is offline: ' + booted.chip.join(', '));

// The day's list is still there, and still writable.
await page.goto(base + '/#today');
await page.waitForSelector('.todo-text', { timeout: 15000 });
const todo = await page.$eval('.todo-text', (n) => n.textContent.trim());
step('data offline: ' + todo);
if (todo !== 'Survives losing the signal') fail('stored data was lost offline');

await page.fill('.todo-add input', 'Written while offline');
await page.click('.todo-add button.primary');
await page.waitForFunction(() => {
  const snap = JSON.parse(localStorage.getItem('bv.cutting.v1'));
  return Object.values(snap.todos || {}).some((t) => t.text === 'Written while offline');
}, null, { timeout: 3000 });
const wrote = await page.evaluate(() => {
  const snap = JSON.parse(localStorage.getItem('bv.cutting.v1'));
  return Object.values(snap.todos).map((t) => t.text);
});
step('written offline: ' + JSON.stringify(wrote));
if (!wrote.includes('Written while offline')) fail('could not record anything while offline');

/* ---------- and back again ---------- */

await ctx.setOffline(false);
await new Promise((r) => server.listen(port, r));
await page.reload();
await page.waitForSelector('header.top');
await page.waitForFunction(() => ![...document.querySelectorAll('.hdr-id .chip')]
  .some((n) => n.textContent.trim() === 'offline'));
const backChip = await page.$$eval('.hdr-id .chip', (ns) => ns.map((n) => n.textContent.trim()));
step('back online: ' + backChip.join(', '));
if (backChip.includes('offline')) fail('still claims to be offline after the network returned');

/* ---------- the worker leaves sync alone ---------- */

// Supabase is cross-origin; a cached or stalled answer there would have the
// app quietly disagreeing with the cloud.
const passesThrough = await page.evaluate(async () => {
  const res = await fetch('https://example.invalid/rest/v1/x').catch((e) => e.message);
  return typeof res === 'string' ? res : 'reached network';
});
step('cross-origin request handling: ' + passesThrough);
if (/from cache|503/i.test(String(passesThrough))) fail('the worker answered a cross-origin request');

await browser.close();
server.close();
console.log('\nERRORS:', errors.length ? '\n  ' + errors.join('\n  ') : 'none');
process.exit(errors.length ? 1 : 0);
