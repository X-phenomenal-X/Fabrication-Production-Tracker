/* Verify: does the machine scheduling still agree with the company's Daily
   Schedule? The Rolling and CNC workbooks are the base — this screen is the
   check that the base has not drifted away from what the company expects. */

import { el, chip, fmtDate, fmtNum, fmtWhen } from '../ui.js';
import { state } from '../store.js';
import { liveTasks, hasTasks, orderById } from '../model.js';
import { verifyAgainstDaily } from '../import-machines.js';
import { MACHINE_BY_KEY } from '../machines.js';

let tolerance = 2;
let showAll = false;

export function renderVerify(rerender, go) {
  if (!hasTasks()) {
    return el('div.panel', {},
      el('div.empty', {},
        el('h3', {}, 'No machine schedules loaded'),
        el('p', {}, 'Import the Rolling and CNC workbooks — they are the base for scheduling.'),
        el('button.primary', { onclick: () => go('setup') }, 'Go to Setup')));
  }
  if (!state.orders.length) {
    return el('div.panel', {},
      el('div.empty', {},
        el('h3', {}, 'No Daily Schedule loaded'),
        el('p', {}, 'The machine schedules are loaded, but there is nothing to check them against.'),
        el('button.primary', { onclick: () => go('setup') }, 'Import the Daily Schedule')));
  }

  const v = verifyAgainstDaily(state.tasks, state.orders, { toleranceDays: tolerance });
  const issues = showAll ? v.issues : v.issues.slice(0, 40);

  const head = el('div.panel', {},
    el('div.body.flush', {},
      el('div.stats', {},
        el('div.stat', {}, el('div.n', {}, fmtNum(v.machineWos)), el('div.k', {}, 'W/Os scheduled')),
        el('div.stat.ok', {}, el('div.n', {}, fmtNum(v.matched)), el('div.k', {}, 'Match the schedule')),
        el('div.stat' + (v.issues.length ? '.warn' : ''), {},
          el('div.n', {}, fmtNum(v.issues.length)), el('div.k', {}, 'Out of step')),
        el('div.stat' + (v.notScheduled.length ? '.bad' : ''), {},
          el('div.n', {}, fmtNum(v.notScheduled.length)), el('div.k', {}, 'Not on a machine')))),
    el('div.body', {},
      el('div.row.small.muted', {},
        'Machine schedules are the base. This checks them against the Daily Schedule.',
        el('span.spacer'),
        el('label.row.small', { style: { gap: '6px' } },
          'Allow',
          el('select', {
            style: { width: 'auto' },
            onchange: (e) => { tolerance = Number(e.target.value); rerender(); },
          }, ...[0, 1, 2, 3, 5, 7].map((d) => el('option', {
            value: String(d), selected: tolerance === d,
          }, `${d} day${d === 1 ? '' : 's'}`))),
          'difference'))));

  const issuePanel = el('div.panel', {},
    el('header', {}, `Dates out of step (${v.issues.length})`,
      el('span.spacer'),
      v.issues.length > 40 ? el('button.sm.ghost', {
        onclick: () => { showAll = !showAll; rerender(); },
      }, showAll ? 'Show fewer' : `Show all ${v.issues.length}`) : null),
    v.issues.length
      ? el('div.tbl-wrap', {}, el('table', {},
          el('thead', {}, el('tr', {},
            el('th', {}, 'W/O'), el('th', {}, 'Project'), el('th', {}, 'Machines'),
            el('th.num', {}, 'Days'), el('th', {}, 'What differs'))),
          el('tbody', {}, ...issues.map((i) => el('tr', {},
            el('td', {}, el('span.mono.strong', {}, i.wo)),
            el('td', {}, i.project || '—'),
            el('td', {}, el('div.tag-row', {},
              ...(i.machines || []).map((m) => chip(MACHINE_BY_KEY[m]?.label || m, 'mute')))),
            el('td.num', {}, i.days != null
              ? el('strong', { style: { color: Math.abs(i.days) > 7 ? 'var(--bad)' : 'var(--warn)' } },
                  (i.days > 0 ? '+' : '') + i.days)
              : '—'),
            el('td.small', {}, i.detail))))))
      : el('div.empty', {},
          el('h3', {}, 'Everything lines up'),
          el('div', {}, `No work order differs from the Daily Schedule by more than ${tolerance} day${tolerance === 1 ? '' : 's'}.`)));

  const missingPanel = v.notScheduled.length ? el('div.panel', {},
    el('header', {}, `On the Daily Schedule but not on any machine (${v.notScheduled.length})`),
    el('div.body', {},
      el('div.small.muted', {},
        'These work orders are still open on the company schedule but no machine sheet covers them. ' +
        'Either they belong to another department, or they have been missed.')),
    el('div.tbl-wrap', {}, el('table', {},
      el('thead', {}, el('tr', {},
        el('th', {}, 'W/O'), el('th', {}, 'Project'), el('th', {}, 'Floor'),
        el('th.hide-sm', {}, 'Cut by'), el('th.hide-sm', {}, 'Ship'))),
      el('tbody', {}, ...v.notScheduled.slice(0, 60).map(({ wo, orders }) => {
        const o = orders[0];
        return el('tr', {},
          el('td', {}, el('span.mono.strong', {}, wo)),
          el('td', {}, o.project || '—'),
          el('td', {}, o.floor || '—'),
          el('td.hide-sm.nowrap', {}, fmtDate(o.cuttingDate)),
          el('td.hide-sm.nowrap', {}, fmtDate(o.shipDate)));
      }))))) : null;

  return el('div', {}, head, issuePanel, missingPanel);
}
