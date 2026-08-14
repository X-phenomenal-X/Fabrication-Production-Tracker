/* Registering the service worker, and knowing when there is no signal.

   Both are conditional on actually being on the web. The same built file is
   opened straight off the shared drive over file://, where service workers do
   not exist at all — so this has to do nothing there rather than throw. */

import { el, icon, toast } from './ui.js';

let onlineListener = null;

export function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** Redraw when the connection comes or goes, so the header can say so. */
export function watchConnection(rerender) {
  if (onlineListener) return;
  onlineListener = () => rerender();
  window.addEventListener('online', onlineListener);
  window.addEventListener('offline', onlineListener);
}

/* A new build is on the server. Worth interrupting for — a shift reading a
   version of the app two deploys old is how "it does not do that on mine"
   starts — but never worth reloading out from under someone mid-sentence, so
   it asks. */
let awaitingUpdate = false;

function offerUpdate(worker) {
  const bar = el('div.toast.toast-action', {},
    el('span', {}, 'A newer version of the tracker is ready'),
    el('button', {
      onclick: () => {
        awaitingUpdate = true;
        worker.postMessage('skip-waiting');
        bar.remove();
      },
    }, 'Reload'));
  document.body.append(bar);
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // file:// has no service worker, and calling register() there rejects.
  if (!location.protocol.startsWith('http')) return;

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');

      // Already waiting when the page loaded — a previous visit installed it.
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);

      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener('statechange', () => {
          // `controller` is null on the very first install, which is not an
          // update — there is nothing to replace and nothing to tell anyone.
          if (next.state === 'installed' && navigator.serviceWorker.controller) {
            offerUpdate(next);
          }
        });
      });
    } catch (e) {
      // Not being able to work offline is a reduced service, not a failure —
      // the app itself is fine, so this must never surface as an error.
      console.info('offline support unavailable:', e.message);
    }
  });

  /* Only reload when the user asked for the update.

     `clients.claim()` in the worker's activate step also fires this event, on
     the very first visit, as control passes from nobody to the new worker.
     Reloading there would bounce the page out from under someone who has just
     arrived — and would do it mid-interaction in a test. */
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!awaitingUpdate || reloading) return;
    reloading = true;
    location.reload();
  });
}
