/* Planner: assign work orders to a day and shift. Deliberately simple —
   pick a date, pick a shift, add orders from the queue. */

import { el, chip, bar, fmtDate, fmtNum, modal, toast } from '../ui.js';
import { setPlan } from '../store.js';
import { queue, planFor, orderById, rollup, today, addDays, riskOf } from '../model.js';
import { SHIFTS, SHIFT_ORDER } from '../schema.js';
import { openOrder } from './board.js';

let cursor = today();

function pickOrders(date, shift, rerender) {
  const current = new Set(planFor(date, shift));
  const q = queue();
  const search = el('input', { type: 'search', placeholder: 'Filter by W/O, project, floor…' });
  const listBox = el('div', { style: { maxHeight: '46vh', overflow: 'auto' } });

  const draw = () => {
    const term = search.value.toLowerCase();
    listBox.replaceChildren(...q
      .filter(({ order: o }) => !term ||
        [o.wo, o.project, o.floor, o.job].filter(Boolean).join(' ').toLowerCase().includes(term))
      .slice(0, 200)
      .map(({ order, risk, roll }) => {
        const cb = el('input', {
          type: 'checkbox', checked: current.has(order.id), style: { width: 'auto' },
          onchange: (e) => { e.target.checked ? current.add(order.id) : current.delete(order.id); },
        });
        return el('label.oprow', { style: { cursor: 'pointer' } },
          cb,
          el('span.mono.strong', { style: { width: '70px' } }, order.wo),
          el('span', { style: { flex: '1' } }, `${order.project || '—'} · ${order.floor || '—'}`),
          chip(risk.label, risk.tone),
          roll.target ? el('span.mono.small.nowrap', {}, `${fmtNum(roll.remaining)} left`) : null);
      }));
    if (!listBox.children.length) {
      listBox.append(el('div.empty', {}, 'Nothing matches.'));
    }
  };
  search.addEventListener('input', draw);
  draw();

  modal(`Add work — ${SHIFTS[shift].label}, ${fmtDate(date, { withDay: true })}`,
    el('div', {}, el('div', { style: { marginBottom: '10px' } }, search), listBox),
    {
      wide: true,
      actions: [
        {
          label: 'Save plan', class: 'primary', onClick: (dlg) => {
            setPlan(date, shift, Array.from(current));
            toast(`${current.size} order${current.size === 1 ? '' : 's'} planned`);
            dlg.close();
            rerender();
          }
        },
      ],
    });
}

function shiftColumn(date, shiftKey, rerender) {
  const shift = SHIFTS[shiftKey];
  const ids = planFor(date, shiftKey);
  const orders = ids.map(orderById).filter(Boolean);

  const totalLeft = orders.reduce((a, o) => a + rollup(o).remaining, 0);

  return el('div.panel', {},
    el('header', {}, shift.label,
      shift.full ? null : chip(`${shift.crew} crew`, 'warn'),
      el('span.spacer'),
      el('span.small.muted', {}, `${fmtNum(totalLeft)} pcs`)),
    el('div.body', {},
      el('button.sm', { onclick: () => pickOrders(date, shiftKey, rerender) },
        ids.length ? 'Edit work' : 'Add work'),
      !shift.full && ids.length > 4
        ? el('div.banner.warn', { style: { marginTop: '10px' } },
            el('div', {}, `${ids.length} orders on a ${shift.crew}-person shift — that may be optimistic.`))
        : null,
    ),
    orders.length
      ? el('ul.list', {}, ...orders.map((o) => {
          const r = rollup(o);
          const risk = riskOf(o);
          return el('li', { style: { cursor: 'pointer' }, onclick: () => openOrder(o, rerender) },
            el('div.row', {},
              el('span.mono.strong', {}, o.wo),
              el('span', {}, o.project || '—'),
              el('span.spacer'),
              chip(risk.label, risk.tone)),
            el('div.row.small.muted', { style: { marginTop: '4px' } },
              o.floor || '',
              el('span.spacer'),
              r.target ? el('span.row', { style: { gap: '6px', flexWrap: 'nowrap' } },
                bar(r.pct, r.complete),
                el('span.mono', {}, `${fmtNum(r.done)}/${fmtNum(r.target)}`)) : null));
        }))
      : el('div.empty', {}, 'Nothing planned.')
  );
}

export function renderPlanner(rerender) {
  const bar_ = el('div.panel', {},
    el('div.body', {},
      el('div.row', {},
        el('button.sm', { onclick: () => { cursor = addDays(cursor, -1); rerender(); } }, '← Prev'),
        el('button.sm', { onclick: () => { cursor = today(); rerender(); } }, 'Today'),
        el('button.sm', { onclick: () => { cursor = addDays(cursor, 1); rerender(); } }, 'Next →'),
        el('div', { style: { fontWeight: '700', fontSize: '16px', marginLeft: '8px' } },
          fmtDate(cursor, { withDay: true })),
        el('span.spacer'),
        el('label.field', { style: { width: 'auto' } },
          el('input', {
            type: 'date', value: cursor,
            onchange: (e) => { if (e.target.value) { cursor = e.target.value; rerender(); } },
          })))));

  return el('div', {}, bar_,
    el('div.grid.three', { style: { marginTop: '16px' } },
      ...SHIFT_ORDER.map((k) => shiftColumn(cursor, k, rerender))));
}
