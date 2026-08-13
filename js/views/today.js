/* Today: the screen the shift opens on. What is running now, what is blocked,
   and what the last shift handed over. */

import { el, chip, bar, fmtDate, fmtNum, fmtWhen } from '../ui.js';
import { state } from '../store.js';
import {
  summary, queue, today, riskOf, reasonFor, rollup, purchTone, planFor, orderById,
  workInWindow, shiftWindow, addDays,
} from '../model.js';
import { SHIFTS, SHIFT_ORDER, shiftAt } from '../schema.js';
import { openOrder } from './board.js';

function statTile(n, label, tone = '') {
  return el('div.stat' + (tone ? '.' + tone : ''), {},
    el('div.n', {}, typeof n === 'number' ? fmtNum(n) : n), el('div.k', {}, label));
}

function lastHandover() {
  const logs = Object.values(state.shiftLogs)
    .filter((l) => l && !l.deleted)
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  return logs[0] || null;
}

export function renderToday(rerender, go) {
  const s = summary();
  const nowShift = shiftAt();
  const shift = SHIFTS[nowShift];
  const date = today();
  const q = queue({ limit: 12 });
  const blocked = q.filter((x) => x.risk.key === 'BLOCKED');
  const handover = lastHandover();

  if (!state.orders.length) {
    return el('div.panel', {},
      el('div.empty', {},
        el('h3', {}, 'No schedule loaded yet'),
        el('p', {}, 'Import the Daily Schedule workbook to get started.'),
        el('button.primary', { onclick: () => go('data') }, 'Go to Data & Import')));
  }

  /* current shift strip */
  const shiftStrip = el('div.panel', {},
    el('div.body', {},
      el('div.row', {},
        el('div', {},
          el('div.small.muted', {}, fmtDate(date, { withDay: true })),
          el('div', { style: { fontSize: '18px', fontWeight: '700' } },
            `${shift.label} shift`,
            shift.full ? '' : ' — skeleton crew')),
        el('span.spacer'),
        shift.full
          ? chip('Full operations', 'ok')
          : chip(`${shift.crew} on tonight`, 'warn'),
      ),
      !shift.full ? el('div.banner.warn', { style: { marginTop: '12px' } },
        el('div', {},
          el('strong', {}, 'Midnight runs a 3-person crew. '),
          'Plan single-station work and anything that does not need a second pair of hands. ',
          'Leave multi-operator setups for the day shift.')) : null
    ));

  /* headline numbers */
  const stats = el('div.panel', {},
    el('div.body.flush', {},
      el('div.stats', {},
        statTile(s.total, 'Active orders'),
        statTile(s.blocked, 'Blocked', s.blocked ? 'bad' : ''),
        statTile(s.late, 'Past cut date', s.late ? 'bad' : ''),
        statTile(s.due, 'Due this week', s.due ? 'warn' : ''),
        statTile(s.done, 'Cut complete', 'ok'),
        statTile(s.pct + '%', 'Pieces cut'),
      )));

  /* what this shift already did */
  const [from, to] = shiftWindow(date, nowShift);
  const workLog = workInWindow(from, to);
  const piecesThisShift = workLog.reduce((a, w) => a + (w.done || 0), 0);

  const shiftWork = el('div.panel', {},
    el('header', {}, 'Logged this shift',
      el('span.spacer'),
      el('span.small.muted', {}, `${fmtNum(piecesThisShift)} pieces · ${workLog.length} entries`)),
    workLog.length
      ? el('ul.list', {}, ...workLog.slice(0, 8).map((w) => el('li', {},
          el('div.row', {},
            el('span.mono.strong', {}, w.order.wo),
            el('span', {}, w.op?.label || ''),
            el('span.spacer'),
            el('span.mono.small', {}, fmtNum(w.done)),
            el('span.small.muted.nowrap', {}, `${w.by} · ${fmtWhen(w.at)}`)))))
      : el('div.empty', {}, 'Nothing logged yet this shift.')
  );

  /* the queue */
  const queuePanel = el('div.panel', {},
    el('header', {}, 'Cut queue — most urgent first',
      el('span.spacer'),
      el('button.sm.ghost', { onclick: () => go('board') }, 'Full board →')),
    el('div.body.flush', {}, el('div.tbl-wrap', {},
      el('table', {},
        el('thead', {}, el('tr', {},
          el('th', {}, 'W/O'), el('th', {}, 'Project'), el('th', {}, 'Floor'),
          el('th', {}, 'Why'), el('th.hide-sm', {}, 'Cut by'), el('th', {}, 'Left'))),
        el('tbody', {}, ...q.map(({ order, risk, roll }) => el('tr', {
          style: { cursor: 'pointer' }, onclick: () => openOrder(order, rerender),
        },
          el('td', {}, el('span.mono.strong', {}, order.wo)),
          el('td', {}, order.project || '—'),
          el('td', {}, order.floor || '—'),
          el('td', {}, chip(risk.label, risk.tone),
            (() => { const why = reasonFor(order, risk);
              return why ? el('div.small.muted', {}, why) : null; })()),
          el('td.hide-sm.nowrap', {}, fmtDate(order.cuttingDate)),
          el('td', {}, roll.target
            ? el('div.row', { style: { gap: '8px', flexWrap: 'nowrap' } },
                bar(roll.pct, roll.complete),
                el('span.mono.small.nowrap', {}, fmtNum(roll.remaining)))
            : el('span.small.muted', {}, '—'))
        )))
      ))));

  /* blockers get their own callout — they need a person, not a saw */
  const blockPanel = blocked.length ? el('div.panel', {},
    el('header', {}, `Blocked — needs material or a decision (${blocked.length})`),
    el('ul.list', {}, ...blocked.slice(0, 8).map(({ order }) => el('li', {},
      el('div.row', {},
        el('span.mono.strong', {}, order.wo),
        el('span', {}, order.project || '—'),
        el('span.small.muted', {}, order.floor || ''),
        el('span.spacer'),
        order.purch ? chip(order.purch, purchTone(order)) : null,
        order.extStatus ? el('span.small.muted.hide-sm', {}, order.extStatus) : null),
      order.notes ? el('div.small.muted', { style: { marginTop: '3px' } }, order.notes) : null
    )))) : null;

  /* last handover */
  const handoverPanel = el('div.panel', {},
    el('header', {}, 'Last handover',
      el('span.spacer'),
      el('button.sm.ghost', { onclick: () => go('shift') }, 'Shift log →')),
    handover
      ? el('div.body', {},
          el('div.row', { style: { marginBottom: '8px' } },
            chip(`${SHIFTS[handover.shift]?.label || handover.shift} · ${fmtDate(handover.date)}`, 'mute'),
            el('span.small.muted', {}, `${handover.by} · ${fmtWhen(handover.at)}`)),
          handover.notes ? el('p', { style: { margin: '0 0 8px' } }, handover.notes) : null,
          handover.carryOver
            ? el('div.banner.warn', {}, el('div', {}, el('strong', {}, 'Carrying over: '), handover.carryOver))
            : null,
          handover.issues
            ? el('div.banner.bad', { style: { marginTop: '8px' } },
                el('div', {}, el('strong', {}, 'Issues: '), handover.issues))
            : null)
      : el('div.empty', {}, 'No shift updates posted yet.')
  );

  /* today's plan */
  const planPanel = el('div.panel', {},
    el('header', {}, "Today's plan",
      el('span.spacer'),
      el('button.sm.ghost', { onclick: () => go('planner') }, 'Planner →')),
    el('div.body', {},
      el('div.grid.three', {}, ...SHIFT_ORDER.map((k) => {
        const ids = planFor(date, k);
        return el('div', {},
          el('div.row', { style: { marginBottom: '6px' } },
            el('strong', {}, SHIFTS[k].label),
            SHIFTS[k].full ? null : chip('3 crew', 'warn')),
          ids.length
            ? el('ul.list', { style: { fontSize: '13px' } }, ...ids.slice(0, 6).map((id) => {
                const o = orderById(id);
                if (!o) return null;
                const r = rollup(o);
                return el('li', { style: { padding: '5px 0', borderBottom: 'none' } },
                  el('span.mono.strong', {}, o.wo), ' ',
                  el('span.small.muted', {}, `${o.project || ''} ${o.floor || ''}`),
                  r.target ? el('span.small.muted', {}, ` · ${fmtNum(r.remaining)} left`) : null);
              }))
            : el('div.small.muted', {}, 'Nothing assigned.'));
      }))));

  return el('div', {},
    shiftStrip,
    stats,
    el('div.grid.two', { style: { marginTop: '16px' } },
      el('div', {}, queuePanel, blockPanel),
      el('div', {}, planPanel, shiftWork, handoverPanel)));
}
