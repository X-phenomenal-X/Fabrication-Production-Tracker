/* The profile of the die a machine is cutting, on the Running Now card.

   An operator standing at the machine is holding the extrusion this drawing is
   of. Putting the section next to the work order answers "is this the right
   bar" without opening anything — which is the question the die lookup exists
   to answer, asked at the moment it actually comes up.

   The catch is the library: js/drawings.js is 3.8 MB of embedded sections, and
   it was deliberately moved behind a feature boundary so the online app does
   not fetch it on every launch. Rendering a thumbnail automatically would pull
   all of it onto the most-visited page in the app and undo that.

   So it is opt-in exactly once. The first tap loads the library; after that
   every Running Now card on every machine shows its profile for the rest of
   the session, and the service worker keeps the file for the next one. The
   small textual catalogue this needs to translate `S80.104` into `SA80-104`
   is already on every production page for routing, so only the images are
   deferred. */

import { dieForms } from '../dies.js';

let mod = null;
let pending = false;

/** Whether the drawing library is in memory yet. */
export function haveDrawings() {
  return !!mod;
}

/** Fetch it, once. `onReady` is the view's rerender — the cards cannot show
    anything until the module lands, and nothing else prompts a redraw. */
export function loadDrawings(onReady) {
  if (mod || pending) return;
  pending = true;
  import('../die-drawings.js')
    .then((m) => { mod = m; })
    // A failure here is not worth a message: the card simply keeps its button,
    // and the operator can try again. Nothing they were doing is blocked.
    .catch(() => {})
    .finally(() => { pending = false; onReady?.(); });
}

/** The drawing for a die as written on the schedule, or null — null both when
    the library is not loaded and when the book has no section for this one, so
    a caller never has to distinguish "not yet" from "not at all". */
export function thumbFor(die) {
  if (!mod || !die) return null;
  const { sa } = dieForms(die);
  return sa ? mod.drawingFor(sa) : null;
}
