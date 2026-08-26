/* The company mark, in one place.

   Traced from `assets/bv-logo.png`, the artwork itself, by reading the pixels
   rather than by eye — every coordinate below comes from the bounding boxes
   and the row-by-row profile of the shapes in that file. It is kept in the
   repo beside this so the trace can be checked against its source.

   Three shapes, not four. An earlier version of this drew a 2x2 grid of tiles
   with a navy one among them; the file disproves it. The mark is a cyan square
   over a blue square, with a green wedge beside them that tapers from full
   width at the top to nothing at the bottom. The navy in the logo belongs to
   the wordmark, not to the mark.

   Both halves are split by the same horizontal gutter, at rows 15-16 of 32,
   which is what makes the left pair read as two squares rather than one.

   If a vector of the logo ever turns up, replacing `MARK` with its contents is
   the whole job — keep the `viewBox`, drop any `width`/`height`, and use
   `var(--mark-a|b|c)` for the fills so the dark-ground reversal keeps working. */

import { el } from './ui.js';

/** The mark, on a 32x32 grid taken from the source file's own proportions.

    Colours come from CSS custom properties rather than being baked into the
    paths, so correcting a brand value in one stylesheet corrects the mark too,
    and one copy can reverse on a dark ground. */
const MARK = `
<svg viewBox="0 0 32 32" role="img" aria-label="BV Glazing Systems" focusable="false">
  <rect x="0" y="0"  width="18" height="15" fill="var(--mark-a)"/>
  <rect x="0" y="17" width="18" height="15" fill="var(--mark-b)"/>
  <path d="M19 0 H31.5 L25.2 15 H19 Z"   fill="var(--mark-c)"/>
  <path d="M19 17 H24.4 L19 30 Z"        fill="var(--mark-c)"/>
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
