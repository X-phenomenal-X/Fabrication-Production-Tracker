/* The company mark, in one place.

   ⚠ THE MARK BELOW IS A PLACEHOLDER TRACE, NOT THE REAL LOGO.

   It was drawn from a picture of the BV Glazing Systems logo, because the logo
   has only ever reached this project as an image — never as a vector or a
   colour spec. The proportions and the exact hues are approximations.

   Replacing it is deliberately a one-file job:

     1. Drop the real artwork in as `MARK` below. If it is an SVG, paste its
        contents; strip any `width`/`height` and keep the `viewBox` so it
        scales with the lockup. If it is a PNG, use an `<img>` with a data URI
        — but a vector is much better on a wall-mounted screen.
     2. Correct the four `--brand-*` values at the top of css/app.css to the
        exact hex out of that artwork.

   Nothing else in the app needs to change. Everything coloured is derived from
   those four values, and every place the mark appears calls `brandMark()`. */

import { el } from './ui.js';

/** The four tiles, sheared into a glazed unit seen at an angle.

    Colours come from CSS custom properties rather than being hard-coded, so
    correcting a brand value in one stylesheet corrects the mark too — and so
    the mark can reverse on a dark ground without a second copy of the artwork. */
const MARK = `
<svg viewBox="0 0 40 40" role="img" aria-label="BV Glazing Systems" focusable="false">
  <g transform="skewX(-11) translate(5 0)">
    <rect x="0"  y="4"  width="13" height="14" fill="var(--mark-a)"/>
    <rect x="16" y="4"  width="11" height="14" fill="var(--mark-b)"/>
    <rect x="0"  y="21" width="13" height="14" fill="var(--mark-c)"/>
    <rect x="16" y="21" width="11" height="14" fill="var(--mark-d)"/>
  </g>
</svg>`;

/** The mark on its own, at whatever size the surrounding CSS gives it. */
export function brandMark({ cls = '' } = {}) {
  const node = el('span.brandmark' + (cls ? '.' + cls : ''), { 'aria-hidden': 'true' });
  node.innerHTML = MARK;
  return node;
}

/* The wordmark is set in type rather than traced, because the app has no web
   font and a traced wordmark would be the only thing on screen not matching
   everything around it. It reads as the company name; the mark beside it is
   what actually carries the identity. */
export function brandLockup() {
  return el('div.lockup', {},
    brandMark(),
    el('span.lockup-name', {},
      el('b', {}, 'BV GLAZING'),
      el('em', {}, 'Systems')));
}
