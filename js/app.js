/* Shell: tabs, the identity picker, and the render loop. */

import { el, clear, chip } from './ui.js';
import { state, loadLocal, save, onChange, me, sharedFileName } from './store.js';
import { makeCentreView } from './views/centre.js';
import { renderBackOrders } from './views/backorders.js';
import { renderData, initSharedFile } from './views/data.js';
import { SHIFTS, shiftAt } from './shifts.js';

// One page per work centre, so an operator opens their own machine's queue
// instead of scrolling past everyone else's.
const TABS = [
  { key: 'rolling', label: 'Rolling', render: makeCentreView('Rolling') },
  { key: 'fom', label: 'FOM', render: makeCentreView('FOM') },
  { key: 'cnc', label: 'CNC', render: makeCentreView('CNC') },
  { key: 'punch', label: 'Multi Punch', render: makeCentreView('Punch') },
  { key: 'backorders', label: 'Back Orders', render: renderBackOrders },
  { key: 'setup', label: 'Setup', render: renderData },
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
  const sel = el('select', {
    style: { width: 'auto', minWidth: '120px' },
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

function header() {
  const shift = SHIFTS[shiftAt()];
  const shared = sharedFileName();

  return el('header.top', {},
    el('div.brand', {}, 'Cutting',
      el('small', {}, 'BV Glazing · production tracker')),
    el('span.chip' + (shift.full ? '' : '.warn'), { title: 'Current shift' },
      shift.label + (shift.full ? '' : ` · ${shift.crew} crew`)),
    shared ? chip('shared file', 'ok', 'Connected to ' + shared) : chip('this device only', 'mute',
      'Not connected to a shared file — updates stay on this computer'),
    el('nav.tabs', {}, ...TABS.map((t) => el('button', {
      'aria-current': String(t.key === current),
      onclick: () => go(t.key),
    }, t.label))),
    el('div', { style: { marginLeft: '8px' } }, whoAmI())
  );
}

function render() {
  const tab = TABS.find((t) => t.key === current) || TABS[0];
  // Views are handed scheduleRender, never render, so a redraw requested from
  // inside a click or change handler lands after the browser has finished
  // moving focus — tearing the DOM down mid-event throws.
  const next = el('main', {}, tab.render(scheduleRender, go));
  root.replaceChildren(header(), next);
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
initSharedFile(render);

// Pick up other people's edits when the tab regains focus.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sharedFileName()) {
    import('./store.js').then((m) => m.pullSharedFile());
  }
});
