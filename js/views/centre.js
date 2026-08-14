/* A work-centre page: Rolling, FOM, CNC or Multi Punch.

   One view, parameterised by centre — all four pages are this code with
   different data. Machines within a centre appear as sub-tabs, so an operator
   at FOM 2 sees only FOM 2's queue instead of scrolling past everything else.

   The queue is bucketed by cutting date, urgent first, because "what do I run
   now" is the question this page exists to answer. */

import { el, chip, fmtDate, fmtNum, fmtWhen } from '../ui.js';
import { setTaskStatus } from '../store.js';
import {
  groupedQueue, machineSummary, openCountFor, taskStatusKey, nextTrackStatus, hasTasks,
  shiftUpdateFor,
} from '../model.js';
import { machinesByGroup } from '../machines.js';

/* Per-centre view state, kept while the app is open: which machine tab is
   selected, the search term, and which date groups the user has toggled. */
const viewState = new Map();

function stateFor(group) {
  if (!viewState.has(group)) {
    viewState.set(group, { machine: null, q: '', showDone: false, open: {}, expanded: {} });
  }
  return viewState.get(group);
}

function statusButton(row, rerender) {
  const s = row.status;
  return el('button.status.' + s.tone, {
    title: s.overridden ? `${s.by} · ${fmtWhen(s.at)}` : 'Click to advance',
    onclick: () => {
      setTaskStatus(taskStatusKey(row.task), nextTrackStatus(s.key));
      rerender();
    },
  }, s.label);
}

function taskRow(row, rerender) {
  const t = row.task;
  const note = t.comments || t.boStat;

  return el('div.line', {},
    el('div.line-main', {},
      el('div.line-id', {},
        el('span.mono.strong', {}, t.wo),
        t.die ? el('span.die', {}, t.die) : null),
      el('div.line-where', {},
        el('span', {}, t.project || '—'),
        t.floor ? el('span.muted', {}, ' · ' + t.floor) : null),
      note ? el('div.small.muted.line-note', {}, note) : null),

    el('div.line-qty', {},
      el('span.mono', {}, fmtNum(t.qty)),
      el('span.small.muted', {}, ' pcs')),

    el('div.line-date.hide-sm', {}, fmtDate(t.cuttingDate)),

    el('div.line-status', {},
      t.backOrder ? chip('B/O', 'bad', 'Back order — short of material') : null,
      statusButton(row, rerender)));
}

function dateGroup(group, vs, rerender) {
  const isOpen = vs.open[group.key] ?? group.open;
  const expanded = vs.expanded[group.key];
  const cap = group.cap && !expanded ? group.cap : Infinity;
  const shown = group.rows.slice(0, cap);
  const hidden = group.rows.length - shown.length;

  return el('section.dgroup', {},
    el('button.dgroup-head', {
      'aria-expanded': String(isOpen),
      onclick: () => { vs.open[group.key] = !isOpen; rerender(); },
    },
      el('span.dgroup-caret', {}, isOpen ? '▾' : '▸'),
      el('span.dgroup-label.' + group.tone, {}, group.label),
      el('span.dgroup-count', {}, String(group.rows.length))),

    isOpen ? el('div.dgroup-body', {},
      ...shown.map((r) => taskRow(r, rerender)),
      hidden > 0 ? el('button.sm.showmore', {
        onclick: () => { vs.expanded[group.key] = true; rerender(); },
      }, `Show ${hidden} more`) : null) : null);
}

/* The latest word on this machine from the CNC workbook's Shift Update sheet.
   Shown above the queue because it is more current than the per-line Status
   columns, and it is where a "machine is down" note lives. */
function shiftUpdatePanel(machineKey) {
  const su = shiftUpdateFor(machineKey);
  if (!su) return null;
  const has = su.done.length || su.next.length || su.notes.length || su.down;
  if (!has) return null;

  const list = (label, items) => items.length
    ? el('div.su-col', {},
        el('div.su-label', {}, label),
        el('ul.su-list', {}, ...items.map((t) => el('li', {}, t))))
    : null;

  return el('div.su', {},
    el('div.su-head', {},
      el('span.su-title', {}, 'Latest shift update'),
      su.date ? chip(`${su.shift || ''} ${fmtDate(su.date)}`.trim(), 'mute') : null,
      su.down ? chip('MACHINE DOWN', 'bad') : null,
      su.ops != null ? el('span.small.muted', {}, `${su.ops} operator${su.ops === 1 ? '' : 's'}`) : null),
    el('div.su-body', {},
      list('Work done / in progress', su.done),
      list('Next in schedule', su.next),
      list('Notes', su.notes)));
}

/** Build a page renderer for one centre group. */
export function makeCentreView(group) {
  return function renderCentre(rerender, go) {
    if (!hasTasks()) {
      return el('div.panel', {},
        el('div.empty', {},
          el('h3', {}, 'No schedule loaded yet'),
          el('p', {}, 'Import the Rolling and CNC workbooks to get started.'),
          el('button.primary', { onclick: () => go('setup') }, 'Go to Setup')));
    }

    const machines = machinesByGroup().get(group) || [];
    const vs = stateFor(group);
    if (!vs.machine || !machines.some((m) => m.key === vs.machine)) {
      vs.machine = machines[0]?.key || null;
    }
    const machine = machines.find((m) => m.key === vs.machine);
    if (!machine) return el('div.panel', {}, el('div.empty', {}, 'No machines in this centre.'));

    const sum = machineSummary(machine.key);
    const groups = groupedQueue(machine.key, { showDone: vs.showDone, q: vs.q });

    // Sub-tabs only when the centre actually has more than one machine.
    const tabs = machines.length > 1
      ? el('div.subtabs', {}, ...machines.map((m) => el('button', {
          'aria-current': String(m.key === vs.machine),
          onclick: () => { vs.machine = m.key; rerender(); },
        },
          m.label,
          el('span.subtab-count', {}, String(openCountFor(m.key))))))
      : null;

    const head = el('div.centre-head', {},
      el('div.row', {},
        el('div', {},
          el('h1.centre-title', {}, machine.label),
          machine.note ? el('div.small.muted', {}, machine.note) : null),
        el('span.spacer'),
        el('div.centre-stats', {},
          el('div.cstat', {}, el('b', {}, fmtNum(sum.open)), el('i', {}, 'open')),
          el('div.cstat' + (sum.inProgress ? '.work' : ''), {}, el('b', {}, fmtNum(sum.inProgress)), el('i', {}, 'running')),
          el('div.cstat' + (sum.overdue ? '.bad' : ''), {}, el('b', {}, fmtNum(sum.overdue)), el('i', {}, 'overdue')),
          el('div.cstat' + (sum.backOrder ? '.bad' : ''), {}, el('b', {}, fmtNum(sum.backOrder)), el('i', {}, 'B/O')))),

      tabs,

      el('div.row.centre-filters', {},
        el('input', {
          type: 'search', placeholder: 'Search W/O, project, die…', value: vs.q,
          oninput: (e) => {
            vs.q = e.target.value;
            clearTimeout(head._t);
            head._t = setTimeout(rerender, 150);
          },
        }),
        el('span.spacer'),
        el('label.row.small', { style: { gap: '6px' } },
          el('input', {
            type: 'checkbox', checked: vs.showDone, style: { width: 'auto' },
            onchange: (e) => { vs.showDone = e.target.checked; rerender(); },
          }),
          `Show done${sum.done ? ` (${sum.done})` : ''}`)));

    const su = shiftUpdatePanel(machine.key);

    const body = groups.length
      ? el('div', {}, ...groups.map((g) => dateGroup(g, vs, rerender)))
      : el('div.panel', {}, el('div.empty', {},
          vs.q ? 'Nothing matches that search.' : 'Nothing outstanding on this machine.'));

    return el('div.centre', {}, head, su, body);
  };
}
