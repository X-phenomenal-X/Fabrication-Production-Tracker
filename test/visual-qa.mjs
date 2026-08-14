/* Visual QA over the sanitized fixture.

   Loads test/fixture.mjs into localStorage, then walks every principal screen
   at phone, tablet and desktop widths in both themes, capturing a screenshot of
   each and measuring the things the redesign is answerable for:

     - header height on a phone
     - the smallest hit target on the screen
     - horizontal overflow
     - text-vs-background contrast on the tokens that carry status

   Screenshots land in test/screens/qa/. Failures are printed as ERRORS and set
   a non-zero exit code, so this is a test, not just a screenshot run. */

import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeFixture } from './fixture.mjs';
import { chromiumOptions } from './env.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHOT = path.join(ROOT, 'test', 'screens', 'qa');
fs.mkdirSync(SHOT, { recursive: true });

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('no'); return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const errors = [];
const note = (m) => console.log('  • ' + m);
const fail = (m) => { errors.push(m); console.log('  ✗ ' + m); };

const browser = await chromium.launch(chromiumOptions());

/* The three principal layouts, plus the edges of the middle one. `shoot` marks
   the two that get captured for review; the rest are measured only, so the run
   covers every width without producing 80 screenshots to look through. */
const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, shoot: true },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'workstation', width: 1024, height: 768 },
  { name: 'monitor', width: 1280, height: 900 },
  { name: 'desktop', width: 1440, height: 960, shoot: true },
];

const SCREENS = [
  { hash: 'today', name: 'today' },
  { hash: 'staging', name: 'staging' },
  { hash: 'rolling', name: 'rolling' },
  { hash: 'fom', name: 'fom' },
  { hash: 'cnc', name: 'cnc' },
  { hash: 'punch', name: 'punch' },
  { hash: 'rush', name: 'rush' },
  { hash: 'backorders', name: 'backorders' },
  { hash: 'shift', name: 'shift' },
  { hash: 'setup', name: 'setup' },
];

const fixture = makeFixture();

/* Every interactive thing on the page, with its rendered box — so "the
   smallest tap target" is measured rather than asserted. Things that are
   deliberately small and not operator controls (inline text links) are
   exempt by class. */
const MEASURE = `(() => {
  // Reference affordances, not controls a shift operates. A die badge that
  // met the 44px floor outweighed the work order and the job name on the row
  // it belongs to, which is the opposite of what the page is for. Checked
  // separately, against a smaller floor.
  const EXEMPT = ['linkbtn', 'dielink'];
  const out = [];
  for (const n of document.querySelectorAll('button, [role="button"], a, input, select, textarea')) {
    let r = n.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (getComputedStyle(n).display === 'none') continue;
    if (EXEMPT.some((c) => n.classList.contains(c))) continue;
    if (n.type === 'hidden') continue;
    // A checkbox is 22px by design; what gets tapped is the label wrapped
    // around it, so that is what is measured.
    if (n.type === 'checkbox' || n.type === 'radio') {
      const lab = n.closest('label');
      if (lab) r = lab.getBoundingClientRect();
    }
    out.push({
      w: Math.round(r.width), h: Math.round(r.height),
      tag: n.tagName.toLowerCase(),
      cls: n.className && n.className.baseVal === undefined ? String(n.className) : '',
      text: (n.textContent || n.value || '').trim().slice(0, 24),
    });
  }
  return out;
})()`;

for (const theme of ['light', 'dark']) {
  console.log(`\n=== ${theme} ===`);
  const ctx = await browser.newContext({ colorScheme: theme });
  const page = await ctx.newPage();

  // Seed storage before the app boots, so the very first render is populated.
  await page.addInitScript((snap) => {
    localStorage.setItem('bv.cutting.v1', JSON.stringify(snap));
  }, fixture);

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });

    for (const screen of SCREENS) {
      await page.goto(`${base}/#${screen.hash}`);
      // Setup is reached by the gear beside the name picker rather than a nav
      // button, so wait on the page having rendered instead.
      await page.waitForSelector('main > *');
      await page.waitForTimeout(120);

      if (vp.shoot) {
        const file = `${screen.name}-${vp.name}-${theme}.png`;
        await page.screenshot({ path: path.join(SHOT, file), fullPage: true });
      }

      /* --- you can see which page you are on ---

         The nav scrolls sideways on anything narrower than a monitor, and the
         header is rebuilt on every render, so the scroller used to come back
         at zero: on a phone, every page past FOM highlighted a tab that was
         hundreds of pixels off-screen. Nothing caught it, because nothing
         asked. Setup is the exception — it is the gear, not a nav tab. */
      if (screen.hash !== 'setup') {
        const nav = await page.evaluate(() => {
          const n = document.querySelector('nav.tabs');
          const on = n.querySelector('button[aria-current="true"]');
          if (!on) return { missing: true };
          const nr = n.getBoundingClientRect();
          const br = on.getBoundingClientRect();
          return {
            label: on.getAttribute('aria-label'),
            // Fully inside the scroller's window, not merely overlapping it —
            // half a tab is not an answer to "where am I".
            shown: br.left >= nr.left - 1 && br.right <= nr.right + 1,
            off: Math.round(Math.max(nr.left - br.left, br.right - nr.right)),
          };
        });
        if (nav.missing) {
          fail(`${screen.name} @ ${vp.name}/${theme}: no nav tab is marked current`);
        } else if (!nav.shown) {
          fail(`${screen.name} @ ${vp.name}/${theme}: the "${nav.label}" tab is `
            + `${nav.off}px outside the nav — you cannot see which page you are on`);
        }
      }

      // --- horizontal overflow ---
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) {
        fail(`${screen.name} @ ${vp.name}/${theme}: page scrolls sideways by ${overflow}px`);
      }

      // --- hit targets ---
      const targets = await page.evaluate(MEASURE);
      const min = vp.name === 'phone' ? 44 : 32;
      const small = targets.filter((t) => Math.min(t.w, t.h) < min);
      if (small.length) {
        const worst = small.sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h))[0];
        fail(`${screen.name} @ ${vp.name}/${theme}: ${small.length} control(s) under ${min}px`
          + ` — smallest ${worst.w}×${worst.h} (${worst.tag}.${worst.cls} "${worst.text}")`);
      }

      // --- reference affordances are small, but not too small ---
      const tiny = await page.evaluate(() => {
        const out = [];
        for (const n of document.querySelectorAll('.dielink')) {
          const r = n.getBoundingClientRect();
          if (r.height && r.height < 26) out.push(Math.round(r.height));
        }
        return out;
      });
      if (tiny.length) {
        fail(`${screen.name} @ ${vp.name}/${theme}: ${tiny.length} die link(s) under 26px`
          + ` — smallest ${Math.min(...tiny)}px`);
      }

      // --- long text wraps rather than spilling ---
      // Work orders, projects, notes and assignee names are all free text off a
      // spreadsheet; the fixture carries deliberately absurd ones.
      const spill = await page.evaluate(() => {
        const sel = '.line-where, .line-usernote, .line-bonote, .line-rushband,'
          + ' .line-id .mono, .bo-who, .suread-text, .centre-title, .sucard-name';
        const out = [];
        for (const n of document.querySelectorAll(sel)) {
          // A nowrap element is opting out on purpose (dates, dies).
          if (getComputedStyle(n).whiteSpace === 'nowrap') continue;
          const over = n.scrollWidth - n.clientWidth;
          if (over > 2) {
            out.push({ cls: String(n.className), over, text: (n.textContent || '').trim().slice(0, 30) });
          }
        }
        return out;
      });
      for (const s of spill.slice(0, 2)) {
        fail(`${screen.name} @ ${vp.name}/${theme}: "${s.text}" overflows .${s.cls} by ${s.over}px`);
      }

      // --- every control has an accessible name ---
      const unnamed = await page.evaluate(() => {
        const out = [];
        for (const n of document.querySelectorAll('button, input, select, textarea')) {
          if (!n.getBoundingClientRect().width) continue;
          const name = (n.textContent || '').trim() || n.getAttribute('aria-label')
            || n.getAttribute('title') || n.getAttribute('placeholder')
            || (n.labels && n.labels.length ? (n.labels[0].textContent || '').trim() : '');
          if (!name) out.push(n.tagName.toLowerCase() + '.' + String(n.className || ''));
        }
        return out;
      });
      if (unnamed.length) {
        fail(`${screen.name} @ ${vp.name}/${theme}: ${unnamed.length} control(s) with no accessible name`
          + ` — e.g. ${unnamed[0]}`);
      }
    }

    if (vp.name === 'phone') {
      const h = await page.evaluate(() =>
        Math.round(document.querySelector('header.top').getBoundingClientRect().height));
      note(`phone header: ${h}px`);
      if (h > 96) fail(`phone header is ${h}px, over the 96px budget`);
    }

    // On a production monitor every page must be reachable without discovering
    // that the nav scrolls sideways. Phones and tablets may scroll; 1280+ may not.
    if (vp.width >= 1280) {
      const clipped = await page.evaluate(() => {
        const nav = document.querySelector('nav.tabs');
        const box = nav.getBoundingClientRect();
        return Array.from(nav.querySelectorAll('button'))
          .filter((b) => {
            const r = b.getBoundingClientRect();
            return r.left < box.left - 1 || r.right > box.right + 1;
          })
          .map((b) => b.getAttribute('aria-label'));
      });
      if (clipped.length) {
        fail(`${vp.name}/${theme}: nav tabs cut off at ${vp.width}px — ${clipped.join(', ')}`);
      }
    }
  }

  // --- a machine page shows the newest shift update, not just the workbook ---
  // The fixture writes an afternoon update for Rolling (Auto) and FOM 1 that is
  // newer than the workbook's own entry; every other machine has only the
  // workbook. Both must show, each labelled with where it came from.
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${base}/#fom`);
  await page.waitForSelector('.su');
  const suSource = await page.evaluate(() => {
    const n = document.querySelector('.su');
    return { written: n.classList.contains('written'), title: n.querySelector('.su-title')?.textContent.trim() };
  });
  if (!suSource.written) {
    fail(`FOM 1 shows "${suSource.title}" — the update written in the app is newer than the workbook`);
  }
  // A hash-only navigation re-renders on the next frame, so the old page's
  // panel is still in the DOM when goto resolves — wait for the nav to agree.
  await page.goto(`${base}/#punch`);
  await page.waitForFunction(() =>
    document.querySelector('header.top [aria-current="true"]')?.getAttribute('aria-label') === 'Multi Punch');
  await page.waitForSelector('.su');
  const suPunch = await page.evaluate(() => {
    const n = document.querySelector('.su');
    return { written: n.classList.contains('written'), title: n.querySelector('.su-title')?.textContent.trim() };
  });
  if (suPunch.written) {
    fail(`Multi Punch shows "${suPunch.title}" but nothing was written for it — should be the workbook`);
  }

  // --- status is never carried by colour alone ---
  // Every state indicator must also say what it is, in words or an icon.
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${base}/#fom`);
  await page.waitForSelector('.line');
  const colourOnly = await page.evaluate(() => {
    const sel = ['.seg-btn.on', '.badge-rush', '.badge-bo', '.badge-moved', '.badge-edited',
      '.badge-down', '.cstat', '.dgroup-label', '.nowrun-head', '.chip'];
    const out = [];
    for (const s of sel) {
      for (const n of Array.from(document.querySelectorAll(s)).slice(0, 4)) {
        const words = (n.textContent || '').trim();
        const hasIcon = !!n.querySelector('svg');
        if (!words && !hasIcon) out.push(s);
      }
    }
    return out;
  });
  if (colourOnly.length) fail(`state shown by colour alone: ${[...new Set(colourOnly)].join(', ')}`);

  // --- keyboard focus is visible ---
  const focusRing = await page.evaluate(() => {
    const btn = document.querySelector('nav.tabs button:not([aria-current="true"])');
    const before = getComputedStyle(btn).boxShadow;
    btn.focus();
    // :focus-visible only matches keyboard focus, which programmatic .focus()
    // grants on a button, so this reads the real rule rather than a simulation.
    const after = getComputedStyle(btn).boxShadow;
    return { before, after, changed: before !== after && after !== 'none' };
  });
  if (!focusRing.changed) fail(`keyboard focus is invisible (box-shadow stayed "${focusRing.after}")`);

  // --- bulk actions clear the browser's safe area ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/#fom`);
  await page.waitForSelector('.line');
  // A desktop-selected line becomes a phone drawer when the same tab is
  // resized in place. Close it before testing the queue underneath.
  const phoneInspectorClose = page.locator('.line-inspector [aria-label="Close line details"]');
  if (await phoneInspectorClose.count()) {
    await phoneInspectorClose.click();
    await page.waitForSelector('.line-inspector', { state: 'detached' });
  }
  await page.click('.line .line-pick');
  await page.waitForSelector('.bulkbar');
  // The bar slides in over 180ms; measured mid-flight it reads 5px low.
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT, `bulkbar-phone-${theme}.png`) });
  const bulk = await page.evaluate(() => {
    const b = document.querySelector('.bulkbar').getBoundingClientRect();
    return { bottomGap: Math.round(window.innerHeight - b.bottom), right: Math.round(b.right) };
  });
  if (bulk.bottomGap < 8) fail(`bulk bar sits ${bulk.bottomGap}px off the bottom — too close to the safe area`);
  if (bulk.right > 390) fail(`bulk bar runs ${bulk.right - 390}px off the right edge`);
  await page.click('.bulk-x');

  // --- a dialog on a phone: every action reachable without hidden buttons ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/#fom`);
  await page.waitForSelector('.line');
  await page.click('.line .line-iconbtn[title*="Edit this line"]');
  await page.waitForSelector('dialog[open]');
  await page.screenshot({ path: path.join(SHOT, `dialog-phone-${theme}.png`) });
  const cut = await page.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    const f = d.querySelector('footer');
    if (!f) return 0;
    return Math.round(f.getBoundingClientRect().bottom - window.innerHeight);
  });
  if (cut > 0) fail(`dialog footer hangs ${cut}px below the phone viewport`);
  await page.keyboard.press('Escape');

  // --- 200% zoom ---
  // Browser zoom halves the CSS viewport, so a 1280px monitor at 200% is a
  // 640px layout. Emulated by the viewport rather than the `zoom` property,
  // which reports scroll metrics in unzoomed pixels and always looks broken.
  await page.setViewportSize({ width: 640, height: 512 });
  await page.goto(`${base}/#fom`);
  await page.waitForSelector('.line');
  await page.waitForTimeout(150);
  const zoomOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.screenshot({ path: path.join(SHOT, `zoom200-${theme}.png`) });
  if (zoomOverflow > 2) fail(`at 200% zoom (640px layout) the page scrolls sideways by ${zoomOverflow}px`);

  await ctx.close();
}

/* ---------- contrast ---------- */

/* Status must never be carried by colour alone, and the colours it is carried
   by have to be legible under shop lighting. This measures the real rendered
   pairs rather than trusting the tokens. */
const CONTRAST = `(() => {
  const lum = (c) => {
    const modern = c.startsWith('color(srgb');
    const [r, g, b] = c.match(/[\\d.]+/g).slice(0, 3).map(Number).map((v) => {
      // Chromium serializes color-mix() results as color(srgb 0..1) but plain
      // tokens as rgb(0..255). Treating both as 255-based made high-contrast
      // dark text on a pale mixed surface look like a 1.2:1 failure.
      const s = modern ? v : v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const bgOf = (n) => {
    for (let e = n; e; e = e.parentElement) {
      const bg = getComputedStyle(e).backgroundColor;
      if (bg && !/rgba?\\(0, 0, 0, 0\\)/.test(bg)) return bg;
    }
    return 'rgb(255,255,255)';
  };
  const out = [];
  const seen = new Set();
  for (const sel of ['.badge-rush', '.badge-bo', '.badge-moved', '.badge-edited', '.die',
                     '.cstat b', '.cstat i', '.dgroup-label', '.line-where', '.muted',
                     '.chip', '.seg-btn.on', '.nowrun-head', '.line-id .mono']) {
    for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 3)) {
      const st = getComputedStyle(n);
      const pair = st.color + '|' + bgOf(n);
      if (seen.has(sel + pair)) continue;
      seen.add(sel + pair);
      const size = parseFloat(st.fontSize);
      const bold = Number(st.fontWeight) >= 700;
      const large = size >= 18.66 || (size >= 14 && bold);
      out.push({
        sel, r: Math.round(ratio(st.color, bgOf(n)) * 100) / 100,
        need: large ? 3 : 4.5, size,
        fg: st.color, bg: bgOf(n),
        where: (n.parentElement?.className || '') + ' > ' + (n.textContent || '').trim().slice(0, 20),
      });
    }
  }
  return out;
})()`;

for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ colorScheme: theme });
  const page = await ctx.newPage();
  await page.addInitScript((snap) => {
    localStorage.setItem('bv.cutting.v1', JSON.stringify(snap));
  }, fixture);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${base}/#fom`);
  await page.waitForSelector('.line');
  const pairs = await page.evaluate(CONTRAST);
  const bad = pairs.filter((p) => p.r < p.need);
  if (bad.length) {
    for (const b of bad) {
      fail(`${theme}: ${b.sel} contrast ${b.r}:1, needs ${b.need}:1`
        + ` — ${b.fg} on ${b.bg} @${b.size}px, in "${b.where}"`);
    }
  } else {
    note(`${theme}: all ${pairs.length} measured text pairs pass WCAG AA`);
  }
  await ctx.close();
}

/* ---------- reduced motion ---------- */

{
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.addInitScript((snap) => {
    localStorage.setItem('bv.cutting.v1', JSON.stringify(snap));
  }, fixture);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${base}/#fom`);
  await page.waitForSelector('.line');
  const moving = await page.evaluate(() => {
    const out = [];
    for (const sel of ['.centre', '.line', 'button.primary', '.dgroup-caret', '.subtabs button']) {
      const n = document.querySelector(sel);
      if (!n) continue;
      const st = getComputedStyle(n);
      const ms = (v) => Math.max(...String(v).split(',').map((x) =>
        parseFloat(x) * (x.includes('ms') ? 1 : 1000) || 0));
      const t = ms(st.transitionDuration);
      const a = ms(st.animationDuration);
      if (t > 1 || a > 1) out.push(`${sel} transition ${t}ms / animation ${a}ms`);
    }
    return out;
  });
  if (moving.length) fail(`reduced motion not honoured: ${moving.join('; ')}`);
  else note('reduced motion: all sampled transitions and animations disabled');
  await ctx.close();
}

await browser.close();
server.close();

console.log(`\nScreenshots: ${path.relative(ROOT, SHOT)}/`);
console.log(errors.length ? `\nERRORS:\n  ${errors.join('\n  ')}` : '\nERRORS: none');
process.exit(errors.length ? 1 : 0);
