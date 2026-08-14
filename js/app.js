/* Shell: tabs, the identity picker, and the render loop. */

import { el, clear, chip, icon } from './ui.js';
import { allRush, allBackOrders, hasTasks, openTodos, openCountFor } from './model.js';
import { machinesByGroup } from './machines.js';
import {
  state, loadLocal, save, onChange, me, sharedFileName, cloudEnabled, cloudHost,
  initCloud, pullCloud, pullSharedFile, storageStatus,
} from './store.js';
import { makeCentreView } from './views/centre.js';
import { renderBackOrders } from './views/backorders.js';
import { renderToday } from './views/today.js';
import { renderStaging } from './views/staging.js';
import { dieDialog } from './views/dies.js';
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
  { key: 'rolling', label: 'Rolling', kind: 'centre', icon: 'rollers', render: makeCentreView('Rolling') },
  { key: 'fom', label: 'FOM', kind: 'centre', icon: 'factory', render: makeCentreView('FOM') },
  { key: 'cnc', label: 'CNC & FMC', short: 'CNC', kind: 'centre', icon: 'cpu', render: makeCentreView('CNC') },
  { key: 'punch', label: 'Multi Punch', short: 'Punch', kind: 'centre', icon: 'punch', render: makeCentreView('Punch') },
  { key: 'today', label: 'Today', kind: 'tool', icon: 'calendar', render: renderToday },
  { key: 'staging', label: 'Staging', short: 'Stage', kind: 'tool', icon: 'staging', render: renderStaging },
  { key: 'rush', label: 'Rush', kind: 'tool', icon: 'bolt', render: renderRush },
  { key: 'backorders', label: 'Back Orders', short: 'B/O', kind: 'tool', icon: 'alert', render: renderBackOrders },
  { key: 'shift', label: 'Shift Update', short: 'Shift', kind: 'tool', icon: 'clipboard', render: renderShiftUpdate },
  { key: 'setup', label: 'Setup', kind: 'tool', icon: 'gear', render: renderData },
];

let current = location.hash.slice(1) || 'rolling';
if (!TABS.some((t) => t.key === current)) current = 'rolling';

const root = document.getElementById('app');
let scheduled = false;
let pageMotion = true;

function go(key) {
  if (key !== current) pageMotion = true;
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
const TAB_GROUP = { rolling: 'Rolling', fom: 'FOM', cnc: 'CNC', punch: 'Punch' };

function tabBadge(tab) {
  const { key } = tab;
  if (tab.kind === 'centre' && hasTasks()) {
    const n = (machinesByGroup().get(TAB_GROUP[key]) || [])
      .reduce((total, machine) => total + openCountFor(machine.key), 0);
    return n ? el('span.tab-badge.centre-count', {}, String(n)) : null;
  }
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
  return el('button.tab-' + t.key + (t.short ? '.has-short' : ''), {
    'aria-current': String(on),
    title: t.label,
    // Both labels are in the DOM and CSS picks one by width, so the accessible
    // name is stated outright — otherwise a screen reader reads the pair
    // concatenated, as "Back OrdersB/O".
    'aria-label': t.label,
    onclick: () => go(t.key),
  },
    t.icon ? el('span.nav-icon', { 'aria-hidden': 'true' }, icon(t.icon, { size: 17 })) : null,
    el('span.tab-label', {}, t.label),
    t.short ? el('span.tab-short', { 'aria-hidden': 'true' }, t.short) : null,
    tabBadge(t));
}

function header() {
  const shift = SHIFTS[shiftAt()];
  const shared = sharedFileName();
  const sync = !isOnline()
    ? chip('offline', 'warn',
        'No connection. Everything still saves on this device and syncs when it comes back.')
    : cloudEnabled()
      ? chip('synced', 'ok', 'Syncing across devices via ' + cloudHost())
      : shared
        ? chip('shared file', 'ok', 'Connected to ' + shared)
        : chip('this device only', 'mute',
            'Not syncing — updates stay on this device. Set it up under Setup.');
  sync.classList.add('sync-chip');

  return el('header.top', {},
    el('div.hdr-id', {},
      el('div.brand', {}, 'Cutting',
        el('small', {}, 'BV Glazing · production tracker')),
      el('span.chip.shift-chip' + (shift.full ? '' : '.warn'), { title: 'Current shift' },
        shift.label + (shift.full ? '' : ` · ${shift.crew} crew`)),
      // Offline outranks the sync state: "synced" next to a dead connection
      // is the one thing the header must never say. Updates still save
      // locally and go up when the signal comes back.
      sync),

    el('nav.tabs', { 'aria-label': 'Pages' },
      el('div.tabgroup.centres', { role: 'group', 'aria-label': 'Production centres' },
        el('span.nav-eyebrow', { 'aria-hidden': 'true' }, 'Production centres'),
        ...TABS.filter((t) => t.kind === 'centre').map(tabButton)),
      el('span.tabsep', { 'aria-hidden': 'true' }),
      el('div.tabgroup.tools', { role: 'group', 'aria-label': 'Department tools' },
        el('span.nav-eyebrow', { 'aria-hidden': 'true' }, 'Department tools'),
        ...TABS.filter((t) => t.kind === 'tool' && t.key !== 'setup').map(tabButton))),

    // Setup is configuration, not a page anyone works on, so it sits with the
    // name picker as a gear rather than taking a tenth slot in a nav row that
    // had already run out of width.
    el('div.hdr-right', {},
      whoAmI(),
      el('div.hdr-tools', {},
        // The section book, one tap from anywhere. Staging and rolling both ask
        // "what goes into this" all shift.
        el('button.iconbtn.hdr-dies', {
          'aria-label': 'Die lookup',
          title: 'Look up a die in the section book',
          onclick: () => dieDialog(''),
        }, icon('search', { size: 18 })),
        el('button.iconbtn.hdr-setup' + (current === 'setup' ? '.on' : ''), {
          'aria-label': 'Setup',
          'aria-current': String(current === 'setup'),
          title: 'Setup',
          onclick: () => go('setup'),
        }, icon('gear', { size: 18 }))))
  );
}

/* Keeping the nav usable on a phone.

   Nine pages are about 790px of tabs and a 390px phone gives the scroller
   about 150px of that, so most of the nav is always off-screen — that part is
   forced by the 96px header budget and is not going away. What is not forced
   is landing on Rush and seeing "Rolling  FOM": the header is rebuilt on every
   render, so the scroller came back at zero every time and the page you were
   actually on was never in it.

   So the scroll position is carried across rebuilds, and the active tab is
   centred only when it *changes*. Centring on every render would drag the row
   back under someone's thumb mid-scroll, and renders happen constantly. */
let navScroll = 0;
let navCentredOn = null;

function paintNavEdges(nav) {
  const room = nav.scrollWidth - nav.clientWidth;
  // Fades stand in for a scrollbar, which is hidden here: they say there is
  // more that way, and on which side.
  nav.classList.toggle('can-l', room > 1 && nav.scrollLeft > 1);
  nav.classList.toggle('can-r', room > 1 && nav.scrollLeft < room - 1);
}

function settleNav() {
  const nav = root.querySelector('nav.tabs');
  if (!nav) return;
  nav.scrollLeft = navScroll;

  if (navCentredOn !== current) {
    const on = nav.querySelector('button[aria-current="true"]');
    // Centred rather than merely scrolled into view, so its neighbours stay
    // half-visible — which is the only hint on the page that the row moves.
    if (on) {
      const nr = nav.getBoundingClientRect();
      const br = on.getBoundingClientRect();
      nav.scrollLeft += (br.left + br.width / 2) - (nr.left + nr.width / 2);
    }
    navCentredOn = current;
  }

  navScroll = nav.scrollLeft;
  paintNavEdges(nav);
  nav.addEventListener('scroll', () => {
    navScroll = nav.scrollLeft;
    paintNavEdges(nav);
  }, { passive: true });
}

/* Sticky sections inside a page need to know how tall the app header is, or
   they slide underneath it and hide their own first line. Measured rather than
   assumed, because the header wraps differently at every width. */
function measureHeader() {
  const h = root.querySelector('header.top');
  if (!h) return;
  const set = () => document.documentElement.style.setProperty('--hdr-h',
    typeof matchMedia === 'function' && matchMedia('(min-width: 1101px)').matches
      ? '0px'
      : Math.round(h.getBoundingClientRect().height) + 'px');
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
  const storage = storageStatus();
  // Views are handed scheduleRender, never render, so a redraw requested from
  // inside a click or change handler lands after the browser has finished
  // moving focus — tearing the DOM down mid-event throws.
  const next = el('main' + (pageMotion ? '.page-enter' : ''), {},
    !storage.ok ? el('div.banner.bad.storage-alert', { role: 'alert' },
      el('div', {},
        el('strong', {}, storage.error + ' '),
        'Do not close this page until the problem is fixed or you have exported a backup.',
        el('div.small', { style: { marginTop: '4px' } },
          `${storage.detail} Open Setup → Backup, transfer and reset to export the current copy.`))) : null,
    tab.render(scheduleRender, go));
  root.replaceChildren(header(), next);
  pageMotion = false;
  measureHeader();
  settleNav();
}

function scheduleRender() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { scheduled = false; render(); });
}

// Rotating a phone changes how much of the nav fits, and nothing else about
// the app needs to redraw for that.
window.addEventListener('resize', () => {
  const nav = root.querySelector('nav.tabs');
  if (nav) paintNavEdges(nav);
}, { passive: true });

window.addEventListener('hashchange', () => {
  const k = location.hash.slice(1);
  if (TABS.some((t) => t.key === k) && k !== current) {
    current = k;
    pageMotion = true;
    scheduleRender();
  }
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
