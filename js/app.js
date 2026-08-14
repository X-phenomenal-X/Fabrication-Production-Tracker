/* Shell: tabs, the identity picker, and the render loop. */

import { el, clear, chip, icon } from './ui.js';
import { allRush, allBackOrders, hasTasks, openTodos } from './model.js';
import {
  state, loadLocal, save, onChange, me, sharedFileName, cloudEnabled, cloudHost,
  initCloud, pullCloud, pullSharedFile,
} from './store.js';
import { makeCentreView } from './views/centre.js';
import { renderBackOrders } from './views/backorders.js';
import { renderToday } from './views/today.js';
import { renderShiftUpdate } from './views/shiftupdate.js';
import { renderRush } from './views/rush.js';
import { renderData, initSharedFile } from './views/data.js';
import { SHIFTS, shiftAt } from './shifts.js';
import { registerServiceWorker, watchConnection, isOnline } from './offline.js';

// One page per work centre, so an operator opens their own machine's queue
// instead of scrolling past everyone else's.
//
// The nav is split in two because the pages are two different kinds of thing.
// `centre` pages are where a shift is actually run — an operator lives on one
// of them. `tool` pages are department-wide and visited: chase a shortage,
// write the update, set the app up. Mixing them in one row of eight made the
// four that matter no easier to find than Setup.
const TABS = [
  { key: 'rolling', label: 'Rolling', kind: 'centre', render: makeCentreView('Rolling') },
  { key: 'fom', label: 'FOM', kind: 'centre', render: makeCentreView('FOM') },
  { key: 'cnc', label: 'CNC & FMC', short: 'CNC', kind: 'centre', render: makeCentreView('CNC') },
  { key: 'punch', label: 'Multi Punch', short: 'Punch', kind: 'centre', render: makeCentreView('Punch') },
  { key: 'today', label: 'Today', kind: 'tool', icon: 'list', render: renderToday },
  { key: 'rush', label: 'Rush', kind: 'tool', icon: 'bolt', render: renderRush },
  { key: 'backorders', label: 'Back Orders', short: 'B/O', kind: 'tool', icon: 'alert', render: renderBackOrders },
  { key: 'shift', label: 'Shift Update', short: 'Shift', kind: 'tool', icon: 'note', render: renderShiftUpdate },
  { key: 'setup', label: 'Setup', kind: 'tool', icon: 'gear', render: renderData },
];

let current = location.hash.slice(1) || 'rolling';
if (!TABS.some((t) => t.key === current)) current = 'rolling';

const root = document.getElementById('app');
let scheduled = false;

function go(key) {
  current = key;
  location.hash = key;
  scheduleRender();
  window.scrollTo({ top: 0 });
}

function whoAmI() {
  const people = state.people.length ? state.people : [];
  // Width is a layout decision and belongs in the stylesheet — as an inline
  // style it beat the phone rules and squeezed the centre scroller to nothing.
  const sel = el('select.whopick', {
    'aria-label': 'Who are you?',
    onchange: (e) => {
      if (e.target.value === '__add') {
        const name = prompt('Your name');
        if (name && name.trim()) {
          const n = name.trim();
          if (!state.people.includes(n)) state.people.push(n);
          state.settings.me = n;
          save();
        }
        scheduleRender();
        return;
      }
      state.settings.me = e.target.value || null;
      save();
      scheduleRender();
    },
  },
    el('option', { value: '', selected: !state.settings.me }, 'Who are you?'),
    ...people.map((p) => el('option', { value: p, selected: state.settings.me === p }, p)),
    el('option', { value: '__add' }, '+ Add name…'));
  return sel;
}

/* Counts that belong on the nav rather than only inside the page: an operator
   should not have to open Rush to learn there is rush work. Cheap enough to
   recompute per render — both walk the same in-memory task list the page does. */
function toolBadge(key) {
  // The day's list works with no schedule loaded, so its count is not gated
  // on an import the way the schedule-derived ones are.
  if (key === 'today') {
    const n = openTodos().open.length;
    return n ? el('span.tab-badge.warn', {}, String(n)) : null;
  }
  if (!hasTasks()) return null;
  if (key === 'rush') {
    const n = allRush().length;
    return n ? el('span.tab-badge.warn', {}, String(n)) : null;
  }
  if (key === 'backorders') {
    // allBackOrders() returns one entry per assignee, not per line — the badge
    // has to count the shortages, not the people chasing them.
    const n = allBackOrders().reduce((a, g) => a + g.rows.length, 0);
    return n ? el('span.tab-badge', {}, String(n)) : null;
  }
  return null;
}

function tabButton(t) {
  const on = t.key === current;
  // Two labels, one shown at a time by width: a phone's centre scroller has no
  // room for "Back Orders" and "Shift Update" spelled out next to four machines.
  return el('button' + (t.short ? '.has-short' : ''), {
    'aria-current': String(on),
    title: t.label,
    // Both labels are in the DOM and CSS picks one by width, so the accessible
    // name is stated outright — otherwise a screen reader reads the pair
    // concatenated, as "Back OrdersB/O".
    'aria-label': t.label,
    onclick: () => go(t.key),
  },
    t.icon ? icon(t.icon, { size: 14 }) : null,
    el('span.tab-label', {}, t.label),
    t.short ? el('span.tab-short', { 'aria-hidden': 'true' }, t.short) : null,
    toolBadge(t.key));
}

function header() {
  const shift = SHIFTS[shiftAt()];
  const shared = sharedFileName();

  return el('header.top', {},
    el('div.hdr-id', {},
      el('div.brand', {}, 'Cutting',
        el('small', {}, 'BV Glazing · production tracker')),
      el('span.chip' + (shift.full ? '' : '.warn'), { title: 'Current shift' },
        shift.label + (shift.full ? '' : ` · ${shift.crew} crew`)),
      // Offline outranks the sync state: "synced" next to a dead connection
      // is the one thing the header must never say. Updates still save
      // locally and go up when the signal comes back.
      !isOnline()
        ? chip('offline', 'warn',
            'No connection. Everything still saves on this device and syncs when it comes back.')
        : cloudEnabled()
          ? chip('synced', 'ok', 'Syncing across devices via ' + cloudHost())
          : shared
            ? chip('shared file', 'ok', 'Connected to ' + shared)
            : chip('this device only', 'mute',
                'Not syncing — updates stay on this device. Set it up under Setup.')),

    el('nav.tabs', { 'aria-label': 'Pages' },
      el('div.tabgroup.centres', { role: 'group', 'aria-label': 'Production centres' },
        ...TABS.filter((t) => t.kind === 'centre').map(tabButton)),
      el('span.tabsep', { 'aria-hidden': 'true' }),
      el('div.tabgroup.tools', { role: 'group', 'aria-label': 'Department tools' },
        ...TABS.filter((t) => t.kind === 'tool').map(tabButton))),

    el('div.hdr-right', {}, whoAmI())
  );
}

/* Sticky sections inside a page need to know how tall the app header is, or
   they slide underneath it and hide their own first line. Measured rather than
   assumed, because the header wraps differently at every width. */
function measureHeader() {
  const h = root.querySelector('header.top');
  if (!h) return;
  const set = () => document.documentElement.style
    .setProperty('--hdr-h', Math.round(h.getBoundingClientRect().height) + 'px');
  set();
  if (typeof ResizeObserver === 'function') {
    hdrObserver?.disconnect();
    hdrObserver = new ResizeObserver(set);
    hdrObserver.observe(h);
  }
}
let hdrObserver = null;

function render() {
  const tab = TABS.find((t) => t.key === current) || TABS[0];
  // Views are handed scheduleRender, never render, so a redraw requested from
  // inside a click or change handler lands after the browser has finished
  // moving focus — tearing the DOM down mid-event throws.
  const next = el('main', {}, tab.render(scheduleRender, go));
  root.replaceChildren(header(), next);
  measureHeader();
}

function scheduleRender() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; render(); });
}

window.addEventListener('hashchange', () => {
  const k = location.hash.slice(1);
  if (TABS.some((t) => t.key === k) && k !== current) { current = k; scheduleRender(); }
});

loadLocal();
onChange(scheduleRender);
render();
registerServiceWorker();
watchConnection(scheduleRender);
initSharedFile(render);
initCloud();

// Pick up other people's edits when the tab regains focus — coming back to the
// app on a phone is exactly the moment its copy is most likely to be stale.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (sharedFileName()) pullSharedFile();
  if (cloudEnabled()) pullCloud({ parts: ['work'] });
});
