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
  { hash: 'overview', name: 'overview' },
  { hash: 'today', name: 'today' },
  { hash: 'staging', name: 'staging' },
  { hash: 'rolling', name: 'rolling' },
  { hash: 'fom', name: 'fom' },
  { hash: 'cnc', name: 'cnc' },
  { hash: 'punch', name: 'punch' },
  { hash: 'rush', name: 'rush' },
  { hash: 'backorders', name: 'backorders' },
  { hash: 'jobs', name: 'jobs' },
  { hash: 'dies', name: 'dies' },
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
        const nav = await page.evaluate((phone) => {
          if (phone) {
            const route = document.querySelector('.mobile-route');
            const box = route?.getBoundingClientRect();
            return {
              label: route?.querySelector('.mobile-route-label')?.textContent?.trim(),
              missing: !route,
              shown: !!box && box.width >= 44 && box.height >= 44,
              off: 0,
            };
          }
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
        }, vp.name === 'phone');
        if (nav.missing) {
          fail(`${screen.name} @ ${vp.name}/${theme}: no current-page control is visible`);
        } else if (!nav.shown) {
          fail(`${screen.name} @ ${vp.name}/${theme}: the "${nav.label}" page control is not fully visible`);
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
      /* The phone header once hid both quick actions to buy nav width. That
         made the section book and Setup unreachable even though both features
         were still bundled. Assert visibility, then follow the exact route an
         operator uses into the full Engineering Lookup section. */
      if (vp.name === 'phone' && screen.hash === 'rolling') {
        await page.click('.mobile-route');
        await page.waitForSelector('dialog.mobile-nav-dialog');
        const destinations = await page.$$eval('.mobile-nav-item', (nodes) =>
          nodes.map((node) => node.querySelector('.mobile-nav-label')?.textContent?.trim()));
        if (destinations.length !== 12) {
          fail(`rolling @ phone/${theme}: page menu exposes ${destinations.length} of 12 destinations`);
        }
        await page.click('dialog.mobile-nav-dialog button:has-text("Close")');

        const tools = await page.evaluate(() => Object.fromEntries(
          ['.hdr-dies', '.hdr-setup'].map((sel) => {
            const n = document.querySelector(sel);
            const r = n?.getBoundingClientRect();
            return [sel, !!r && r.width >= 44 && r.height >= 44];
          })));
        for (const [sel, visible] of Object.entries(tools)) {
          if (!visible) fail(`rolling @ phone/${theme}: ${sel} is not a visible 44px action`);
        }
        if (tools['.hdr-dies']) {
          await page.click('.hdr-dies');
          await page.waitForFunction(() => location.hash === '#dies'
            && !!document.querySelector('.die-section .dielookup'));
          const current = await page.getAttribute('nav.tabs [aria-current="true"]', 'aria-label');
          if (current !== 'Engineering Lookup') {
            fail(`rolling @ phone/${theme}: header search landed on ${current || 'no page'}`);
          }
        }
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
  // Use a real keyboard move. Programmatic .focus() inherits the last input
  // modality, so after the phone lookup test clicks a button Chrome correctly
  // suppresses :focus-visible and a good focus rule looks broken.
  // Put the browser inside the page's tab order first. Headless Chrome can
  // otherwise keep keyboard events on its own chrome and report <body> here.
  // The following real Tab is what switches to keyboard modality and must
  // produce the app's :focus-visible treatment.
  await page.locator('button:visible').first().focus();
  await page.keyboard.press('Tab');
  const focusRing = await page.evaluate(() => {
    const btn = document.activeElement;
    const style = getComputedStyle(btn);
    return {
      after: style.boxShadow,
      outline: style.outlineStyle,
      tag: btn?.tagName?.toLowerCase(),
      changed: style.boxShadow !== 'none' || style.outlineStyle !== 'none',
    };
  });
  if (!focusRing.changed) {
    fail(`keyboard focus is invisible on ${focusRing.tag || 'the first control'} `
      + `(box-shadow "${focusRing.after}", outline "${focusRing.outline}")`);
  }
  // --- the phone's persistent Done action clears the browser's safe area ---
  // The redesigned production flow removes the old checkbox-first phone queue.
  // Its repeated floor action is now the current job's Done dock, so that is
  // the persistent control that must never sit under the home indicator.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/#rolling`);
  await page.waitForSelector('.mobile-queue-row');
  await page.waitForSelector('.mobile-done-dock');
  // A desktop-selected line becomes a phone drawer when the same tab is
  // resized in place. Close it before measuring the production flow beneath.
  const phoneInspectorClose = page.locator('.line-inspector [aria-label="Close line details"]');
  if (await phoneInspectorClose.count()) {
    await phoneInspectorClose.click();
    await page.waitForSelector('.line-inspector', { state: 'detached' });
  }
  // The dock and ordered rows enter over 200ms; measure the settled state.
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT, `production-flow-phone-${theme}.png`) });
  const dock = await page.evaluate(() => {
    const b = document.querySelector('.mobile-done-dock').getBoundingClientRect();
    const rows = Array.from(document.querySelectorAll('.mobile-queue-row'))
      .filter((n) => n.getBoundingClientRect().height > 0);
    return {
      bottomGap: Math.round(window.innerHeight - b.bottom),
      right: Math.round(b.right),
      live: !!document.querySelector('.mobile-live-strip'),
      visibleRows: rows.filter((n) => n.getBoundingClientRect().top < b.top).length,
    };
  });
  if (dock.bottomGap < 8) fail(`Done dock sits ${dock.bottomGap}px off the bottom — too close to the safe area`);
  if (dock.right > 390) fail(`Done dock runs ${dock.right - 390}px off the right edge`);
  if (!dock.live) fail('phone production flow has no live-job strip');
  if (dock.visibleRows < 2) fail(`phone production flow shows only ${dock.visibleRows} queue row(s) above Done`);

  // --- a dialog on a phone: every action reachable without hidden buttons ---
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/#rolling`);
  await page.waitForSelector('.mobile-queue-row');
  await page.click('.mobile-queue-row .mobile-queue-open');
  await page.waitForSelector('.line-inspector');
  await page.locator('.line-inspector .inspector-action').filter({ hasText: /^Edit$/ }).click();
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
  await page.waitForSelector('.mobile-queue-row');
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

/* ---------- the nav scrolls on whichever axis the layout uses ----------

   A phone scrolls the nav sideways, a desktop scrolls a vertical rail, and both
   hide the scrollbar — so the fade at the edge is the only thing on the page
   saying there is more nav than fits. The vertical case had no fade and no
   scroll memory: on a 960px-tall screen the rail runs 734px of buttons through
   a 620px window, so three of the twelve pages sat below the fold looking like
   they did not exist. */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  await page.addInitScript((snap) => {
    localStorage.setItem('bv.cutting.v1', JSON.stringify(snap));
  }, fixture);
  await page.goto(`${base}/#overview`);
  await page.waitForSelector('nav.tabs button');

  const rail = await page.evaluate(() => {
    const nav = document.querySelector('nav.tabs');
    return {
      overflows: nav.scrollHeight - nav.clientHeight > 1,
      classes: nav.className,
      tabs: nav.querySelectorAll('button').length,
    };
  });

  if (!rail.overflows) {
    note(`desktop rail: all ${rail.tabs} pages fit without scrolling`);
  } else if (!/can-d/.test(rail.classes)) {
    fail('the desktop nav rail scrolls but shows no fade — pages below the fold'
      + ' are invisible and nothing says the rail moves');
  } else {
    note(`desktop rail: ${rail.tabs} pages, scrolls, fade shown`);
  }

  /* Whichever page you pick has to be visible in the rail once you are on it,
     including the last one. The header is rebuilt on every render, so this also
     covers the scroll position surviving that rebuild. */
  const last = await page.$$eval('nav.tabs button', (ns) => ns.at(-1).getAttribute('aria-label'));
  await page.click(`nav.tabs button[aria-label="${last}"]`);
  await page.waitForTimeout(300);
  const landed = await page.evaluate(() => {
    const nav = document.querySelector('nav.tabs');
    const on = nav.querySelector('button[aria-current="true"]');
    if (!on) return { visible: false, name: null };
    const nr = nav.getBoundingClientRect();
    const br = on.getBoundingClientRect();
    return {
      visible: br.top >= nr.top - 1 && br.bottom <= nr.bottom + 1,
      name: on.getAttribute('aria-label'),
      classes: nav.className,
    };
  });
  if (!landed.visible) {
    fail(`selecting "${last}" left it out of view in the rail — the active page is unfindable`);
  } else {
    note(`rail follows the active page: "${landed.name}" in view`);
  }
  await page.screenshot({ path: path.join(SHOT, 'nav-rail.png'), clip: { x: 0, y: 0, width: 260, height: 960 } });
  await ctx.close();
}

/* ---------- forced theme ----------

   Dark is reachable two ways: the OS asks for it, or the user picks "Always
   dark" in Setup and the app stamps data-theme="dark". Those live in two
   separate blocks of app.css holding the same palette, and a token added to
   one and not the other is invisible until somebody on a light laptop picks
   dark and gets half a theme. So: resolve every token both ways and compare
   the values, rather than trusting the copies stayed in step. */
{
  const tokensIn = async (opts, attr) => {
    const ctx = await browser.newContext({ colorScheme: opts });
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${base}/`);
    const got = await page.evaluate((theme) => {
      if (theme) document.documentElement.dataset.theme = theme;
      else delete document.documentElement.dataset.theme;
      // Token names come from the stylesheet itself, so a token that exists in
      // only one of the two blocks still gets asked for in both.
      const names = new Set();
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        for (const r of rules) {
          // Style rules carry an empty `cssRules` of their own now that
          // Chromium supports nesting, so match on `style` before recursing.
          const walk = (rr) => {
            if (rr.style && /:root/.test(rr.selectorText || '')) {
              for (const prop of rr.style) if (prop.startsWith('--')) names.add(prop);
            }
            if (rr.cssRules) for (const k of rr.cssRules) walk(k);
          };
          walk(r);
        }
      }
      const st = getComputedStyle(document.documentElement);
      const out = {};
      for (const n of [...names].sort()) out[n] = st.getPropertyValue(n).trim();
      return out;
    }, attr);
    await ctx.close();
    return got;
  };

  const osDark = await tokensIn('dark', null);
  const forcedDark = await tokensIn('light', 'dark');
  const osLight = await tokensIn('light', null);
  const forcedLight = await tokensIn('dark', 'light');

  if (!Object.keys(osDark).length) fail('forced theme: no :root tokens found to compare');
  if (osDark['--bg'] === osLight['--bg']) {
    fail('forced theme: the dark media query is not applying — light and dark --bg match');
  }

  const drift = Object.keys(osDark).filter((k) => osDark[k] !== forcedDark[k]);
  if (drift.length) {
    for (const k of drift) {
      fail(`forced theme: ${k} is "${osDark[k]}" under OS dark but "${forcedDark[k]}"`
        + ' under data-theme="dark" — the two dark blocks in app.css have drifted');
    }
  } else {
    note(`forced theme: all ${Object.keys(osDark).length} tokens match between OS dark`
      + ' and data-theme="dark"');
  }

  const lightDrift = Object.keys(osLight).filter((k) => osLight[k] !== forcedLight[k]);
  if (lightDrift.length) fail(`forced theme: data-theme="light" differs on ${lightDrift.join(', ')}`);
  else note('forced theme: data-theme="light" reproduces the light palette under OS dark');
}

/* The picker itself, end to end: a stored choice has to survive the boot and
   actually repaint, not just set an attribute. Deliberately no addInitScript
   here — that re-seeds on every navigation and would hide a persistence bug. */
{
  const ctx = await browser.newContext({ colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${base}/#setup`);
  await page.evaluate((snap) => {
    localStorage.setItem('bv.cutting.v1', JSON.stringify(snap));
  }, fixture);
  await page.goto(`${base}/#setup`);
  await page.waitForSelector('.themeopt');

  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const dark = await page.$$eval('.themeopt', (btns) =>
    btns.findIndex((b) => /dark/i.test(b.textContent || '')));
  if (dark < 0) fail('theme picker: no "Always dark" option in Setup');
  else {
    await page.$$eval('.themeopt', (btns, i) => btns[i].click(), dark);
    await page.waitForTimeout(120);
    const after = await page.evaluate(() => ({
      bg: getComputedStyle(document.body).backgroundColor,
      attr: document.documentElement.dataset.theme,
    }));
    if (after.attr !== 'dark') fail(`theme picker: data-theme is "${after.attr}" after choosing dark`);
    else if (after.bg === before) fail(`theme picker: page did not repaint — body stayed ${before}`);
    else note(`theme picker: dark repaints ${before} -> ${after.bg}`);

    await page.reload();
    await page.waitForSelector('.themeopt');
    const kept = await page.evaluate(() => ({
      bg: getComputedStyle(document.body).backgroundColor,
      attr: document.documentElement.dataset.theme,
    }));
    if (kept.attr !== 'dark' || kept.bg !== after.bg) {
      fail(`theme picker: choice lost on reload — data-theme "${kept.attr}", body ${kept.bg}`);
    } else note('theme picker: choice survives a reload');
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

/* ---------- monitor mode ----------

   The wall display in a bay. Two things have to hold, and the second is the
   one that matters: it has to be readable from across an aisle, and it has to
   be impossible to operate. A screen within reach of a walkway gets pressed by
   accident, and a status set by a shoulder is worse than no status at all —
   so "nothing is pressable" is the assertion, counted rather than assumed. */
{
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.addInitScript((snap) => {
    localStorage.setItem('bv.cutting.v1', JSON.stringify(snap));
  }, fixture);
  await page.goto(`${base}/?monitor#rolling`);
  await page.waitForSelector('.line');
  await page.waitForTimeout(200);

  const mon = await page.evaluate(() => {
    const live = [...document.querySelectorAll('button, input, select, textarea, a[href]')]
      .filter((n) => {
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(n).pointerEvents !== 'none';
      })
      .map((n) => String(n.className || n.tagName).slice(0, 30));
    const wo = document.querySelector('.line-id .mono.strong');
    return {
      mode: document.documentElement.dataset.display || null,
      live: [...new Set(live)],
      liveCount: live.length,
      wo: wo ? Math.round(parseFloat(getComputedStyle(wo).fontSize)) : 0,
    };
  });

  note(`monitor mode: ${mon.liveCount} pressable, work order ${mon.wo}px`);
  if (mon.mode !== 'monitor') fail('?monitor did not put the page in monitor mode');
  if (mon.liveCount) {
    fail(`monitor mode leaves ${mon.liveCount} control(s) operable — e.g. ${mon.live[0]}`);
  }
  // Read from across a bay, not from a chair.
  if (mon.wo < 36) fail(`monitor mode work order is ${mon.wo}px — too small to read at distance`);
  await page.screenshot({ path: path.join(SHOT, 'monitor.png') });
  await ctx.close();
}

await browser.close();
server.close();

console.log(`\nScreenshots: ${path.relative(ROOT, SHOT)}/`);
console.log(errors.length ? `\nERRORS:\n  ${errors.join('\n  ')}` : '\nERRORS: none');
process.exit(errors.length ? 1 : 0);
