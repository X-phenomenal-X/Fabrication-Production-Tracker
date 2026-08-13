/* Dashboard: the department at a glance, divided by work centre.
   One card per machine — how much is on it, how much is done, what is blocked,
   and the next few orders. Click a card to see everything on that machine. */

import { el, chip, bar, fmtDate, fmtNum, fmtWhen, modal, toast } from '../ui.js';
import { state, save, me } from '../store.js';
import {
  byMachine, unroutedOps, routedMachines, summary, today, reasonFor, rollup, opRouting,
  workInWindow, shiftWindow,
} from '../model.js';
import { MACHINES, MACHINE_BY_KEY, machinesByGroup, machineForOp, isAssumed, OP_MACHINE_DEFAULT } from '../machines.js';
import { SHIFTS, shiftAt, QTY_OPS } from '../schema.js';
import { openOrder } from './board.js';

/* ---------- routing editor ---------- */

export function editRouting(rerender) {
  const overrides = { ...opRouting() };

  const body = el('div', {},
    el('p.small.muted', { style: { marginTop: 0 } },
      'Which machine runs each cutting operation. Rows marked ' ,
      chip('assumed', 'warn'),
      ' are the app\'s best guess from the column names — please correct them.'),
    el('div', {}, ...QTY_OPS.map((op) => {
      const current = overrides[op.key] !== undefined
        ? overrides[op.key]
        : (OP_MACHINE_DEFAULT[op.key]?.machine || '');
      const assumed = isAssumed(op.key, opRouting());
      return el('div.oprow', {},
        el('span.oplabel', { title: op.alt || '' }, op.label),
        op.alt ? el('span.small.muted.hide-sm', { style: { width: '80px' } }, op.alt) : el('span', { style: { width: '80px' } }),
        assumed ? chip('assumed', 'warn') : el('span', { style: { width: '62px' } }),
        el('select', {
          style: { maxWidth: '190px' },
          onchange: (e) => { overrides[op.key] = e.target.value; },
        },
          el('option', { value: '', selected: !current }, 'Not tracked'),
          ...MACHINES.map((m) => el('option', {
            value: m.key, selected: current === m.key,
          }, m.label))));
    })));

  modal('Which machine runs each operation', body, {
    wide: true,
    actions: [
      {
        label: 'Reset to defaults', onClick: (dlg) => {
          delete state.settings.opRouting;
          save();
          dlg.close();
          toast('Routing reset');
          rerender();
        }
      },
      {
        label: 'Save', class: 'primary', onClick: (dlg) => {
          state.settings.opRouting = overrides;
          save();
          dlg.close();
          toast('Routing saved');
          rerender();
        }
      },
    ],
  });
}

/* ---------- machine detail ---------- */

function openMachine(key, data, rerender) {
  const m = MACHINE_BY_KEY[key];
  const rows = data?.orders || [];

  const body = el('div', {},
    el('div.stats', { style: { marginBottom: '16px', border: '1px solid var(--line-soft)', borderRadius: '8px', overflow: 'hidden' } },
      el('div.stat', {}, el('div.n', {}, fmtNum(data?.remaining || 0)), el('div.k', {}, 'Pieces left')),
      el('div.stat', {}, el('div.n', {}, (data?.pct || 0) + '%'), el('div.k', {}, 'Complete')),
      el('div.stat' + (data?.blocked ? '.bad' : ''), {}, el('div.n', {}, fmtNum(data?.blocked || 0)), el('div.k', {}, 'Blocked')),
      el('div.stat' + (data?.late ? '.bad' : ''), {}, el('div.n', {}, fmtNum(data?.late || 0)), el('div.k', {}, 'Late'))),

    rows.length
      ? el('div.tbl-wrap', {}, el('table', {},
          el('thead', {}, el('tr', {},
            el('th', {}, 'W/O'), el('th', {}, 'Project'), el('th', {}, 'Floor'),
            el('th', {}, 'Status'), el('th.hide-sm', {}, 'Cut by'), el('th', {}, 'On this machine'))),
          el('tbody', {}, ...rows.slice(0, 100).map(({ order, risk, target, done, ops }) => el('tr', {
            style: { cursor: 'pointer' },
            onclick: () => openOrder(order, rerender),
          },
            el('td', {}, el('span.mono.strong', {}, order.wo)),
            el('td', {}, order.project || '—'),
            el('td', {}, order.floor || '—'),
            el('td', {}, chip(risk.label, risk.tone),
              (() => { const w = reasonFor(order, risk); return w ? el('div.small.muted', {}, w) : null; })()),
            el('td.hide-sm.nowrap', {}, fmtDate(order.cuttingDate)),
            el('td', {},
              el('div.row', { style: { gap: '8px', flexWrap: 'nowrap' } },
                bar(target ? (done / target) * 100 : 0, done >= target),
                el('span.mono.small.nowrap', {}, `${fmtNum(done)}/${fmtNum(target)}`)),
              el('div.small.muted', {}, ops.map((o) => o.label).join(', '))))))))
      : el('div.empty', {}, 'Nothing outstanding on this machine.'));

  modal(`${m?.label || key}${m?.note ? ' — ' + m.note : ''}`, body, { wide: true });
}

/* ---------- cards ---------- */

function machineCard(m, data, routed, rerender) {
  const remaining = data?.remaining || 0;
  const pct = data?.pct || 0;
  const orders = data?.orders || [];
  const statusOnly = data?.statusOnly || 0;
  const isRouted = routed.has(m.key);

  const head = el('header', {}, m.label,
    el('span.spacer'),
    m.ops != null ? chip(`${m.ops} ops`, 'mute') : chip('ops ?', 'warn'));

  // A machine with nothing routed to it is unconfigured, not idle. Saying so
  // avoids a wall of meaningless zeros that reads as a broken dashboard.
  if (!isRouted) {
    return el('div.panel', {},
      head,
      el('div.body', {},
        m.note ? el('div.small.muted', { style: { marginTop: '-6px', marginBottom: '8px' } }, m.note) : null,
        el('div.small.muted', {}, 'No operations routed here yet.'),
        el('button.sm', {
          style: { marginTop: '8px' },
          onclick: (e) => { e.stopPropagation(); editRouting(rerender); },
        }, 'Assign work')));
  }

  return el('div.panel', {
    style: { cursor: 'pointer' },
    onclick: () => openMachine(m.key, data, rerender),
  },
    head,
    el('div.body', {},
      m.note ? el('div.small.muted', { style: { marginTop: '-6px', marginBottom: '8px' } }, m.note) : null,

      remaining || !statusOnly
        ? el('div', {},
            el('div.row', { style: { alignItems: 'baseline', gap: '8px' } },
              el('span', { style: { fontSize: '24px', fontWeight: '700', letterSpacing: '-.02em' } },
                fmtNum(remaining)),
              el('span.small.muted', {}, 'pieces left'),
              el('span.spacer'),
              el('span.small.muted', {}, `${orders.length} order${orders.length === 1 ? '' : 's'}`)),
            el('div', { style: { margin: '8px 0 6px' } }, bar(pct, pct >= 100)),
            el('div.row.small.muted', {}, `${pct}% complete`,
              el('span.spacer'),
              data?.blocked ? chip(`${data.blocked} blocked`, 'bad') : null,
              data?.late ? chip(`${data.late} late`, 'bad') : null))
        : el('div', {},
            // Prep and similar are tracked by status, not by piece count.
            el('div.row', { style: { alignItems: 'baseline', gap: '8px' } },
              el('span', { style: { fontSize: '24px', fontWeight: '700', letterSpacing: '-.02em' } },
                fmtNum(statusOnly)),
              el('span.small.muted', {}, 'orders outstanding')),
            el('div.small.muted', { style: { marginTop: '4px' } }, 'Tracked by status, not piece count')),

      !remaining && !statusOnly
        ? el('div.small.muted', { style: { marginTop: '8px' } }, 'All caught up.')
        : null,

      orders.length ? el('ul.list', { style: { marginTop: '8px', fontSize: '12.5px' } },
        ...orders.slice(0, 3).map(({ order, target, done }) => el('li', {
          style: { padding: '5px 0', borderBottom: 'none' },
        },
          el('div.row', { style: { gap: '6px' } },
            el('span.mono.strong', {}, order.wo),
            el('span.muted', { style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              `${order.project || ''} ${order.floor || ''}`),
            target
              ? el('span.mono.small', {}, fmtNum(Math.max(0, target - done)))
              : el('span.small.muted', {}, 'prep'))))) : null,
    ));
}

/* ---------- view ---------- */

export function renderDashboard(rerender, go) {
  if (!state.orders.length) {
    return el('div.panel', {},
      el('div.empty', {},
        el('h3', {}, 'No schedule loaded yet'),
        el('p', {}, 'Import the Daily Schedule workbook to get started.'),
        el('button.primary', { onclick: () => go('setup') }, 'Go to Setup')));
  }

  const s = summary();
  const data = byMachine();
  const unrouted = unroutedOps();
  const routed = routedMachines();
  const shift = SHIFTS[shiftAt()];
  const date = today();
  const [from, to] = shiftWindow(date, shiftAt());
  const logged = workInWindow(from, to);
  const piecesThisShift = logged.reduce((a, w) => a + (w.done || 0), 0);

  const header = el('div.panel', {},
    el('div.body', {},
      el('div.row', {},
        el('div', {},
          el('div.small.muted', {}, fmtDate(date, { withDay: true })),
          el('div', { style: { fontSize: '18px', fontWeight: '700' } },
            `${shift.label} shift`)),
        el('span.spacer'),
        shift.full ? chip('Full operations', 'ok') : chip(`${shift.crew} operators tonight`, 'warn'),
        el('button.sm', { onclick: (e) => { e.stopPropagation(); go('shift'); } }, 'Post shift update'))));

  const stats = el('div.panel', {},
    el('div.body.flush', {},
      el('div.stats', {},
        el('div.stat', {}, el('div.n', {}, fmtNum(s.total)), el('div.k', {}, 'Active orders')),
        el('div.stat' + (s.blocked ? '.bad' : ''), {}, el('div.n', {}, fmtNum(s.blocked)), el('div.k', {}, 'Blocked')),
        el('div.stat' + (s.late ? '.bad' : ''), {}, el('div.n', {}, fmtNum(s.late)), el('div.k', {}, 'Past cut date')),
        el('div.stat' + (s.due ? '.warn' : ''), {}, el('div.n', {}, fmtNum(s.due)), el('div.k', {}, 'Due this week')),
        el('div.stat', {}, el('div.n', {}, fmtNum(s.pieces - s.piecesDone)), el('div.k', {}, 'Pieces left')),
        el('div.stat.ok', {}, el('div.n', {}, fmtNum(piecesThisShift)), el('div.k', {}, 'Cut this shift')))));

  const warn = unrouted.length ? el('div.panel', {},
    el('div.body', {},
      el('div.banner.warn', {},
        el('div', {},
          el('strong', {}, `${unrouted.length} operation${unrouted.length === 1 ? '' : 's'} not assigned to a machine — `),
          `${fmtNum(unrouted.reduce((a, u) => a + u.target, 0))} pieces are missing from the cards below. `,
          unrouted.map((u) => u.op.label).join(', '),
          el('div', { style: { marginTop: '8px' } },
            el('button.sm', { onclick: () => editRouting(rerender) }, 'Assign them')))))) : null;

  const groups = machinesByGroup();
  const sections = [];
  for (const [group, list] of groups) {
    sections.push(el('div', { style: { marginTop: '18px' } },
      el('div.row', { style: { marginBottom: '10px' } },
        el('h2', { style: { margin: 0, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-2)' } },
          group),
        el('span.small.muted', {},
          fmtNum(list.reduce((a, m) => a + (data.get(m.key)?.remaining || 0), 0)) + ' pieces left')),
      el('div.grid.three', {}, ...list.map((m) => machineCard(m, data.get(m.key), routed, rerender)))));
  }

  const footer = el('div.panel', { style: { marginTop: '18px' } },
    el('div.body', {},
      el('div.row.small.muted', {},
        `Operations are matched to machines by a routing table.`,
        el('span.spacer'),
        el('button.sm.ghost', { onclick: () => editRouting(rerender) }, 'Edit machine routing'))));

  return el('div', {}, header, stats, warn, ...sections, footer);
}
