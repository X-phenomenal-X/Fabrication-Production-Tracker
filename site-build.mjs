/* Assemble the hosted, modular PWA.

   GitHub Pages should serve the source modules as separate cacheable files;
   Cutting-Tracker.html remains the self-contained shared-drive fallback. */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ROOT = import.meta.dirname;
const OUT = path.join(ROOT, '_site');
const COPY = ['index.html', 'cover-options.html', 'manifest.webmanifest', 'css', 'js', 'assets'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

for (const item of COPY) {
  const source = path.join(ROOT, item);
  const target = path.join(OUT, item);
  fs.cpSync(source, target, { recursive: true });
}

function filesUnder(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(full));
    else files.push(full);
  }
  return files;
}

const published = filesUnder(OUT).sort();
const hash = crypto.createHash('sha256');
for (const file of published) {
  hash.update(path.relative(OUT, file).replaceAll(path.sep, '/'));
  hash.update(fs.readFileSync(file));
}
hash.update(fs.readFileSync(path.join(ROOT, 'sw.js')));
const build = (process.env.GITHUB_SHA || hash.digest('hex')).slice(0, 12);

/* The 24 MB extrusion image map is cached by the runtime strategy only after
   somebody opens an individual profile. Everything else is small enough to
   warm in the background, including the die library needed on the floor. */
const precache = published
  .map((file) => path.relative(OUT, file).replaceAll(path.sep, '/'))
  .filter((rel) => rel !== 'cover-options.html' && rel !== 'js/extrusion-images.js')
  .map((rel) => `./${rel}`);

const workerSource = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const marker = /\/\* __PRECACHE_START__ \*\/[\s\S]*?\/\* __PRECACHE_END__ \*\//;
if (!marker.test(workerSource)) throw new Error('sw.js precache markers are missing');
const worker = workerSource
  .replace('__BUILD__', build)
  .replace(marker,
    `/* __PRECACHE_START__ */ ${JSON.stringify(precache, null, 2)} /* __PRECACHE_END__ */`);
fs.writeFileSync(path.join(OUT, 'sw.js'), worker);

const index = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
if (!index.includes('src="js/app.js"') || !index.includes('href="css/app.css"')) {
  throw new Error('Hosted index is not modular');
}
if (fs.existsSync(path.join(OUT, 'Cutting-Tracker.html'))) {
  throw new Error('Standalone build leaked into the hosted artifact');
}

const total = filesUnder(OUT).reduce((sum, file) => sum + fs.statSync(file).size, 0);
console.log(`Built _site — ${published.length + 1} files, ${(total / 1024 / 1024).toFixed(1)} MB, cache ${build}`);
console.log(`Initial HTML: ${(Buffer.byteLength(index) / 1024).toFixed(1)} KB; ${precache.length} offline shell assets`);
