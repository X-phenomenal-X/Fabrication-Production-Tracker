/* Heavy section-book drawings live behind the Engineering Lookup feature boundary.

   Routing needs the small textual die catalogue on every production page, but
   it never needs four megabytes of embedded drawing images. Keeping these
   helpers separate lets the online app fetch that image library only when the
   lookup is opened. */

import { DRAWINGS, DRAWING_PREFIX, DRAWING_SOURCE } from './drawings.js';

/** The section drawing for a sub-assembly, as a data URI, or null. */
export function drawingFor(sa) {
  const key = DRAWINGS[sa] ? sa : String(sa || '').replace(/[A-Z]+$/, '');
  const body = DRAWINGS[key];
  if (!body) return null;
  return { src: DRAWING_PREFIX + body, source: DRAWING_SOURCE[key] || 'sheet' };
}

export function drawingCount() {
  return Object.keys(DRAWINGS).length;
}
