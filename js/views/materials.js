/* Materials: the department's material picture by profile type.

   The Daily Schedule carries one material status for a whole order, which hides
   the thing that actually stops a saw — "widths are pulled but we are still
   waiting on vents". This screen tracks material per profile. */

import { el, chip, bar, fmtDate, fmtNum, fmtWhen, toast } from '../ui.js';
import { state, setMaterial } from '../store.js';
import { materialByProfile, activeOrders, profileRollup, today } from '../model.js';
import { PROFILES, MATERIAL, MATERIAL_ORDER } from '../profiles.js';
import { openOrder } from './board.js';

let openProfile = null;

function statusChips(counts) {
  const order = [...MATERIAL_ORDER, 'UNKNOWN'];
  return order
    .filter((k) => counts[k])
    .map((k) => chip(`${counts[k]} ${k === 'UNKNOWN' ? 'not set' : MATERIAL[k].label}`,
      k === 'UNKNOWN' ? 'mute' : MATERIAL[k].tone));
}

function profileCard(data, rerender) {
  const p = data.profile;
  const waiting = data.orders.length;
  const isOpen = openProfile === p.key;

  return el('div.panel', {},
    el('header', {}, p.label,
      el('span.spacer'),
      el('span.small.muted', {}, `${fmtNum(data.remaining)} pieces left`)),
    el('div.body', {},
      el('div.tag-row', { style: { marginBottom: '10px' } }, ...statusChips(data.counts)),
      el('div.row', {},
        waiting
          ? el('span.small', {},
              el('strong', {}, `${waiting} order${waiting === 1 ? '' : 's'}`), ' waiting on material')
          : el('span.small.muted', {}, 'Nothing waiting on material.'),
        el('span.spacer'),
        waiting ? el('button.sm', {
          onclick: () => { openProfile = isOpen ? null : p.key; rerender(); },
        }, isOpen ? 'Hide' : 'Show') : null)),

    isOpen && waiting ? el('div.tbl-wrap', {}, el('table', {},
      el('thead', {}, el('tr', {},
        el('th', {}, 'W/O'), el('th', {}, 'Project'), el('th', {}, 'Floor'),
        el('th.hide-sm', {}, 'Cut by'), el('th.num', {}, 'Left'), el('th', {}, 'Material'))),
      el('tbody', {}, ...data.orders.slice(0, 60).map(({ order, row }) => el('tr', {},
        el('td', { style: { cursor: 'pointer' }, onclick: () => openOrder(order, rerender) },
          el('span.mono.strong', {}, order.wo)),
        el('td', {}, order.project || '—'),
        el('td', {}, order.floor || '—'),
        el('td.hide-sm.nowrap', {}, fmtDate(order.cuttingDate)),
        el('td.num', {}, fmtNum(row.remaining)),
        el('td', {},
          el('select', {
            style: { maxWidth: '150px' },
            onchange: (e) => {
              setMaterial(order.id, p.key, e.target.value || null);
              toast(`${order.wo} · ${p.label} → ${e.target.value ? MATERIAL[e.target.value].label : 'not set'}`);
              rerender();
            },
          },
            el('option', { value: '', selected: !row.material.status }, 'Not set'),
            ...MATERIAL_ORDER.map((k) => el('option', {
              value: k, selected: row.material.status === k,
            }, MATERIAL[k].label))),
          row.material.status && !row.material.explicit
            ? el('div.small.muted', {}, 'from schedule')
            : row.material.by
              ? el('div.small.muted', {}, `${row.material.by} · ${fmtWhen(row.material.at)}`)
              : null)))))) : null);
}

export function renderMaterials(rerender, go) {
  if (!state.orders.length) {
    return el('div.panel', {},
      el('div.empty', {},
        el('h3', {}, 'No schedule loaded yet'),
        el('button.primary', { onclick: () => go('setup') }, 'Go to Setup')));
  }

  const data = materialByProfile();
  const totalWaiting = Array.from(data.values()).reduce((a, b) => a + b.orders.length, 0);

  const head = el('div.panel', {},
    el('div.body', {},
      el('div.row', {},
        el('div', {},
          el('div', { style: { fontWeight: '700', fontSize: '16px' } }, 'Material by profile'),
          el('div.small.muted', {},
            'The schedule carries one status per order. This tracks each profile separately.')),
        el('span.spacer'),
        totalWaiting
          ? chip(`${totalWaiting} waiting on material`, 'bad')
          : chip('Nothing waiting', 'ok'))));

  return el('div', {}, head,
    el('div.grid.two', { style: { marginTop: '16px' } },
      ...PROFILES.map((p) => profileCard(data.get(p.key), rerender))));
}
