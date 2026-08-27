/* Shell: tabs, the identity picker, and the render loop. */

import { el, chip, icon, fmtWhen, modal, toast } from './ui.js';
import { allRush, allBackOrders, hasTasks, openTodos, openCountFor } from './model.js';
import { machinesByGroup } from './machines.js';
import { brandLockup } from './brand.js';
import {
  state, loadLocal, save, onChange, me, sharedFileName, cloudEnabled,
  initCloud, storageStatus, cloudStatus, sharedFileStatus, retrySync,
  hasUnsyncedChanges,
} from './store.js';
import { makeCentreView } from './views/centre.js';
import { renderBackOrders } from './views/backorders.js';
import { renderToday } from './views/today.js';
import { renderStaging } from './views/staging.js';
import { renderOverview } from './views/overview.js';
import { renderShiftUpdate } from './views/shiftupdate.js';
import { renderRush } from './views/rush.js';
import { renderData, initSharedFile } from './views/data.js';
import { SHIFTS, shiftAt } from './shifts.js';
import { registerServiceWorker, watchConnection, isOnline } from './offline.js';

/* The engineering libraries contain thousands of records and drawings. They
   are useful, but they are not part of running a machine queue. Loading those
   routes on demand keeps the first online visit small; the service worker
   still caches them after use, so a return visit can open them without a
   signal. The standalone build bundles them exactly as before. */
function lazyView(load, exportName, label) {
  let renderer = null;
  let pending = null;
  let error = null;

  return (scheduleRender, go) => {
    if (renderer) return renderer(scheduleRender, go);
    if (!pending && !error) {
      pending = load()
        .then((module) => { renderer = module[exportName]; error = null; })
        .catch((reason) => { error = reason; })
        .finally(() => { pending = null; scheduleRender(); });
    }

    return el('section.panel.lazy-view', { 'aria-live': 'polite' },
      el('div.body.extrusion-loading', {},
        error ? icon('alert', { size: 18 }) : el('span.spinner', { 'aria-hidden': 'true' }),
        el('div', {},
          el('strong', {}, error ? `${label} is not available yet` : `Loading ${label}…`),
          error ? el('div.small.muted', {},
            'Connect once to download this library. Daily production pages remain available offline.') : null),
        error ? el('button', {
          onclick: () => { error = null; scheduleRender(); },
        }, 'Retry') : null));
  };
}

const renderDies = lazyView(() => import('./views/dies.js'), 'renderDies', 'die lookup');
const renderExtrusions = lazyView(
  () => import('./views/extrusions.js'), 'renderExtrusions', 'extrusion library');

// One page per work centre, so an operator opens their own machine's queue
// instead of scrolling past everyone else's.
//
// The nav is split in two because the pages are two different kinds of thing.
// `centre` pages are where a shift is actually run — an operator lives on one
// of them. `tool` pages are department-wide and visited: chase a shortage,
// write the update, set the app up. Mixing them in one row of eight made the
// four that matter no easier to find than Setup.
const TABS = [
  { key: 'overview', label: 'Overview', kind: 'centre', icon: 'home', render: renderOverview },
  { key: 'rolling', label: 'Rolling', kind: 'centre', icon: 'rollers', render: makeCentreView('Rolling') },
  { key: 'fom', label: 'FOM', kind: 'centre', icon: 'factory', render: makeCentreView('FOM') },
  { key: 'cnc', label: 'CNC & FMC', short: 'CNC', kind: 'centre', icon: 'cpu', render: makeCentreView('CNC') },
  { key: 'punch', label: 'Multi Punch', short: 'Punch', kind: 'centre', icon: 'punch', render: makeCentreView('Punch') },
  { key: 'today', label: 'Today', kind: 'tool', icon: 'calendar', render: renderToday },
  { key: 'staging', label: 'Staging', short: 'Stage', kind: 'tool', icon: 'staging', render: renderStaging },
  { key: 'rush', label: 'Rush', kind: 'tool', icon: 'bolt', render: renderRush },
  { key: 'backorders', label: 'Back Orders', short: 'B/O', kind: 'tool', icon: 'alert', render: renderBackOrders },
  { key: 'dies', label: 'Die Lookup', short: 'Dies', kind: 'tool', icon: 'search', render: renderDies },
  { key: 'extrusions', label: 'Extrusions', kind: 'tool', icon: 'extrusion', render: renderExtrusions },
  { key: 'shift', label: 'Shift Update', short: 'Shift', kind: 'tool', icon: 'clipboard', render: renderShiftUpdate },
  { key: 'setup', label: 'Setup', kind: 'tool', icon: 'gear', render: renderData },
];

let current = location.hash.slice(1) || 'overview';
if (!TABS.some((t) => t.key === current)) current = 'overview';

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
  if (TAB_GROUP[key] && hasTasks()) {
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

function latestSyncAt(...values) {
  return values.filter(Boolean).sort().at(-1) || null;
}

function syncViewState() {
  const cloud = cloudStatus();
  const file = sharedFileStatus();
  const configured = cloud.on || file.on;
  // One operator action queues the same snapshot to both transports. Taking
  // the maximum reports unsent actions without calling one edit "two pending"
  // when a device happens to have cloud and a shared file connected together.
  const pending = Math.max(cloud.pending || 0, file.pending || 0);
  const active = cloud.pushing || cloud.pulling || file.writing;
  const error = cloud.error || file.error;
  const at = latestSyncAt(cloud.at, file.at);

  if (!isOnline()) return {
    cloud, file, configured, pending, active: false, at, error,
    label: pending ? `offline · ${pending} pending` : 'offline', tone: 'warn', icon: 'cloud',
    detail: pending
      ? `${pending} saved change${pending === 1 ? '' : 's'} will sync when the connection returns.`
      : 'No connection. Everything still saves on this device.',
  };
  if (error) return {
    cloud, file, configured, pending, active, at, error,
    label: pending ? `sync error · ${pending} pending` : 'sync error', tone: 'bad', icon: 'alert',
    detail: error,
  };
  if (active) return {
    cloud, file, configured, pending, active, at, error,
    label: pending ? `syncing · ${pending} pending` : 'syncing', tone: 'work', icon: 'cloud',
    detail: 'Sending and checking for updates now.',
  };
  if (pending) return {
    cloud, file, configured, pending, active, at, error,
    label: `${pending} pending`, tone: 'warn', icon: 'clock',
    detail: `${pending} change${pending === 1 ? '' : 's'} saved here and waiting to sync.`,
  };
  if (configured) return {
    cloud, file, configured, pending, active, at, error,
    label: at ? `synced · ${fmtWhen(at)}` : 'connecting', tone: at ? 'ok' : 'work', icon: 'check',
    detail: at ? `Last successful sync ${fmtWhen(at)}.` : 'Checking the shared copy now.',
  };
  return {
    cloud, file, configured, pending, active, at, error,
    label: 'this device only', tone: 'mute', icon: 'cloud',
    detail: 'Not syncing — updates stay on this device. Set it up under Setup.',
  };
}

function diagnosticCard(label, st) {
  if (!st.on) return null;
  const stateLabel = st.error ? 'Needs attention'
    : st.pushing || st.pulling || st.writing ? 'Working now'
      : st.pending ? `${st.pending} pending` : 'Up to date';
  return el('div.sync-diagnostic-card', {},
    el('div.sync-diagnostic-head', {},
      el('strong', {}, label),
      chip(stateLabel, st.error ? 'bad' : st.pending ? 'warn' : 'ok')),
    el('dl.sync-facts', {},
      el('div', {}, el('dt', {}, 'Destination'), el('dd', {}, st.where || 'Connected')),
      el('div', {}, el('dt', {}, 'Last success'), el('dd', {}, st.at ? fmtWhen(st.at) : 'Not yet')),
      el('div', {}, el('dt', {}, 'Pending changes'), el('dd.mono', {}, String(st.pending || 0)))),
    st.error ? el('div.banner.bad.sync-error', { role: 'alert' },
      el('div', {}, el('strong', {}, 'Last error: '), st.error)) : null);
}

function openSyncDetails() {
  const view = syncViewState();
  const body = el('div.sync-diagnostics', {},
    el('div.sync-summary.' + view.tone, {},
      el('span.sync-summary-icon', {}, icon(view.icon, { size: 20 })),
      el('div', {}, el('strong', {}, view.label), el('div.small', {}, view.detail))),
    view.configured
      ? el('div.sync-diagnostic-list', {},
          diagnosticCard('Cloud', view.cloud),
          diagnosticCard('Shared file', view.file))
      : el('p.muted', {},
          'This device is saving locally, but its updates are not being shared with another device.'));

  const actions = view.configured ? [
    {
      label: 'Retry now', class: 'primary', onClick: async (dlg) => {
        const btn = dlg.querySelector('footer .primary');
        if (btn) { btn.disabled = true; btn.textContent = 'Retrying…'; }
        const ok = await retrySync();
        dlg.close();
        toast(ok ? 'Sync complete' : 'Sync still needs attention');
        scheduleRender();
      },
    },
    { label: 'Open Setup', onClick: (dlg) => { dlg.close(); go('setup'); } },
  ] : [
    { label: 'Set up sync', class: 'primary', onClick: (dlg) => { dlg.close(); go('setup'); } },
  ];
  modal('Sync status', body, { actions });
}

function syncIndicator() {
  const view = syncViewState();
  return el(`button.chip.sync-chip.${view.tone}${view.active ? '.is-active' : ''}`, {
    type: 'button',
    title: `${view.detail} Open sync details.`,
    'aria-label': `${view.label}. ${view.detail} Open sync details.`,
    'aria-live': 'polite',
    onclick: openSyncDetails,
  }, icon(view.icon, { size: 14 }), el('span', {}, view.label));
}

function header() {
  const shift = SHIFTS[shiftAt()];

  return el('header.top', {},
    el('div.hdr-id', {},
      // The company mark first, then what this particular tool is. Before
      // this the header opened with the word "Cutting" in system type and
      // nothing on any screen said who made the thing.
      brandLockup(),
      el('div.brand', {}, 'Cutting'),
      el('span.chip.shift-chip' + (shift.full ? '' : '.warn'), { title: 'Current shift' },
        shift.label + (shift.full ? '' : ` · ${shift.crew} crew`)),
      // Offline outranks the sync state: "synced" next to a dead connection
      // is the one thing the header must never say. Updates still save
      // locally and go up when the signal comes back.
      syncIndicator()),

    el('nav.tabs', { 'aria-label': 'Pages' },
      el('div.tabgroup.briefing', { role: 'group', 'aria-label': 'Overview' },
        el('span.nav-eyebrow', { 'aria-hidden': 'true' }, 'Overview'),
        ...TABS.filter((t) => t.key === 'overview').map(tabButton)),
      el('div.tabgroup.centres', { role: 'group', 'aria-label': 'Production centres' },
        el('span.nav-eyebrow', { 'aria-hidden': 'true' }, 'Production centres'),
        ...TABS.filter((t) => t.kind === 'centre' && t.key !== 'overview').map(tabButton)),
      el('span.tabsep', { 'aria-hidden': 'true' }),
      el('div.tabgroup.tools', { role: 'group', 'aria-label': 'Department tools' },
        el('span.nav-eyebrow', { 'aria-hidden': 'true' }, 'Department tools'),
        ...TABS.filter((t) => t.kind === 'tool' && t.key !== 'setup').map(tabButton))),

    // Setup is configuration, not a page anyone works on, so it sits with the
    // name picker as a gear rather than taking another slot in a nav row that
    // had already run out of width.
    el('div.hdr-right', {},
      whoAmI(),
      el('div.hdr-tools', {},
        // The section book, one tap from anywhere. Staging and rolling both ask
        // "what goes into this" all shift.
        el('button.iconbtn.hdr-dies' + (current === 'dies' ? '.on' : ''), {
          'aria-label': 'Die lookup',
          title: 'Look up a die in the section book',
          onclick: () => go('dies'),
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

   Ten pages are about 900px of tabs and a 390px phone gives the scroller
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

/* Monitor mode — the wall display in the bay.

   A shop-floor screen is read from across an aisle by people walking past, and
   the one thing it must never be is operable: a display within reach of a
   walkway gets pressed by accident, and a status set by a shoulder is worse
   than no status at all. So this is the ordinary centre page with its controls
   removed and its type ladder shifted up, not a second view to keep in step.

   Turned on with `?monitor` in the address, so a wall PC is just a bookmark —
   nothing to configure on a machine nobody logs into. The flag sits in the
   query rather than the hash because the hash is the page, and somebody
   walking the display between centres must not switch it off by doing so. */
if (/(^|[?&])(monitor|display=monitor)(&|$)/.test(location.search.slice(1))) {
  document.documentElement.dataset.display = 'monitor';
}

loadLocal();
onChange(scheduleRender);
render();
registerServiceWorker();
watchConnection(scheduleRender);
initSharedFile(render);
initCloud();

// Browsers intentionally ignore custom before-close wording, but setting
// returnValue still produces their standard warning while an outbound snapshot
// is pending. Locally saved, device-only work does not warn: it is already safe.
window.addEventListener('beforeunload', (e) => {
  if (!hasUnsyncedChanges()) return;
  e.preventDefault();
  e.returnValue = '';
});

// Do not wait up to thirty seconds after the shop Wi-Fi comes back.
window.addEventListener('online', () => { retrySync(); });

// Pick up other people's edits when the tab regains focus — coming back to the
// app on a phone is exactly the moment its copy is most likely to be stale.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (sharedFileName() || cloudEnabled()) retrySync();
});
