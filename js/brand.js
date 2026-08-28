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

   The shared vector now lives in `brand-mark.js` so screen and print cannot
   drift apart. If an official vector turns up, replace `BRAND_MARK_SVG` there,
   keep the `viewBox`, drop fixed dimensions, and retain the three fill tokens. */

import { el } from './ui.js';
import { BRAND_MARK_SVG } from './brand-mark.js';

/** The mark, on a 32x32 grid taken from the source file's own proportions.

    Colours come from CSS custom properties rather than being baked into the
    paths, so correcting a brand value in one stylesheet corrects the mark too,
    and one copy can reverse on a dark ground. */
/** The mark on its own, at whatever size the surrounding CSS gives it. */
export function brandMark({ cls = '' } = {}) {
  const node = el('span.brandmark' + (cls ? '.' + cls : ''), { 'aria-hidden': 'true' });
  node.innerHTML = BRAND_MARK_SVG;
  return node;
}

/* The wordmark is set in the app's bundled type rather than traced, so it stays
   crisp and accessible at every responsive size. The mark beside it carries
   the exact geometry and colours from the supplied artwork. */
export function brandLockup() {
  return el('div.lockup', {},
    brandMark(),
    el('span.lockup-name', {},
      el('b', {}, 'BV GLAZING'),
      el('em', {}, 'Systems')));
}
