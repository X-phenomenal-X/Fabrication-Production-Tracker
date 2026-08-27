/* Builds Cutting-Tracker.html — one self-contained file with the CSS and all
   JavaScript inlined, so it can be copied to a shared drive and opened by
   double-clicking. No server, no install, no internet.

   Run: node build.mjs
*/
import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const ROOT = import.meta.dirname;
const OUT = path.join(ROOT, 'Cutting-Tracker.html');

const bundle = await esbuild.build({
  entryPoints: [path.join(ROOT, 'js/app.js')],
  bundle: true,
  format: 'iife',
  target: 'chrome103',
  write: false,
  legalComments: 'none',
});

const js = bundle.outputFiles[0].text;
const cssSource = fs.readFileSync(path.join(ROOT, 'css/app.css'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* Keep the editable site pleasant to work on (ordinary font files beside the
   stylesheet) while preserving the one-file distribution contract. */
const css = cssSource.replace(
  /url\((["']?)\.\.\/assets\/fonts\/([^"')]+)\1\)/g,
  (_, _quote, filename) => {
    const font = fs.readFileSync(path.join(ROOT, 'assets/fonts', filename));
    return `url("data:font/woff2;base64,${font.toString('base64')}")`;
  },
);

const out = html
  .replace('<link rel="stylesheet" href="css/app.css">', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="js/app.js"></script>', `<script>\n${js}\n</script>`)
  // esbuild can leave indentation on otherwise empty generated lines. Keep
  // the committed rollback artifact clean and stable under `git diff --check`.
  .replace(/[ \t]+$/gm, '');

// esbuild annotates the bundle with `// js/foo.js` comments, so check for the
// original tags rather than the bare paths.
if (out.includes('<link rel="stylesheet"') || out.includes('<script type="module"')) {
  throw new Error('Inlining failed — index.html markup changed, update build.mjs');
}
if (out.includes('../assets/fonts/')) {
  throw new Error('Font inlining failed — standalone HTML still references assets/fonts');
}

fs.writeFileSync(OUT, out);
const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`Built ${path.relative(ROOT, OUT)} — ${kb} KB, fully self-contained`);
