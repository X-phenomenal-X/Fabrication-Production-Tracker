/* Tracker — the whole app, for now. One screen: Rolling, FOMs, CNC, Multi
   Punch, each showing its open lines from the department's own Rolling and
   CNC schedules, with a single click-through status per line.

   Deliberately not a "dashboard" of derived numbers — every row here is a
   real line from the actual schedule sheets (WO, project, floor, die, qty),
   and the only interaction is moving that line through the same three states
   the shop already thinks in: Not started, In Progress, Done. */

import { el, chip, fmtDate, fmtNum, fmtWhen } from '../ui.js';
import { state, setTaskStatus, me } from '../store.js';
import {
  tasksForMachine, taskStatusKey, nextTrackStatus, hasTasks,
} from '../model.js';
import { MACHINES, machinesByGroup } from '../machines.js';

const TRACKED_GROUPS = ['Rolling', 'FOM', 'CNC', 'Punch'];
const PAGE_SIZE = 25;

const state_ = { q: '', showDone: false, expanded: new Set() };

function statusChip(row, rerender) {
  const s = row.status;
  return el('button.chip.' + s.tone, {
    style: { cursor: 'pointer', border: 'none' },
    title: s.overridden ? `${s.by} · ${fmtWhen(s.at)}` : 'Click to advance',
    onclick: (e) => {
      e.stopPropagation();
      setTaskStatus(taskStatusKey(row.task), nextTrackStatus(s.key));
      rerender();
    },
  }, s.label, s.blocked ? ' ⚠' : '');
}

function matches(row, q) {
  if (!q) return true;
  const hay = [row.task.wo, row.task.project, row.task.floor, row.task.die]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q.toLowerCase());
}

function machineTable(machine, rerender) {
  const all = tasksForMachine(machine.key);
  const filtered = all
    .filter((r) => state_.showDone || r.status.key !== 'DONE')
    .filter((r) => matches(r, state_.q));

  const doneCount = all.filter((r) => r.status.key === 'DONE').length;
  const expanded = state_.expanded.has(machine.key);
  const rows = expanded ? filtered : filtered.slice(0, PAGE_SIZE);
  const hiddenCount = filtered.length - rows.length;

  const body = rows.length
    ? el('div.tbl-wrap', {}, el('table', {},
        el('thead', {}, el('tr', {},
          el('th', {}, 'W/O'), el('th', {}, 'Project'), el('th', {}, 'Floor'),
          el('th', {}, 'Die'), el('th.num', {}, 'Qty'), el('th.hide-sm', {}, 'Cut date'),
          el('th', {}, 'Status'))),
        el('tbody', {}, ...rows.map((row) => {
          const t = row.task;
          const note = t.comments || t.boStat || (t.bo ? `B/O ${t.bo}` : null);
          return el('tr', {},
            el('td', {}, el('span.mono.strong', {}, t.wo)),
            el('td', {}, t.project || '—'),
            el('td', {}, t.floor || '—'),
            el('td', {}, t.die || '—'),
            el('td.num', {}, fmtNum(t.qty)),
            el('td.hide-sm.nowrap', {}, fmtDate(t.cuttingDate)),
            el('td', {},
              statusChip(row, rerender),
              note ? el('div.small.muted', { style: { marginTop: '3px' } }, note) : null));
        }))))
    : el('div.empty', {},
        all.length ? 'Nothing matches.' : 'No lines scheduled here.');

  return el('div.panel', {},
    el('header', {}, machine.label,
      machine.note ? el('span.small.muted.hide-sm', {}, machine.note) : null,
      el('span.spacer'),
      el('span.small.muted', {}, `${filtered.length} open`),
      doneCount && !state_.showDone
        ? el('span.small.muted', {}, `· ${doneCount} done, hidden`) : null),
    el('div.body.flush', {}, body),
    hiddenCount > 0 ? el('div.body', {},
      el('button.sm', {
        onclick: () => { state_.expanded.add(machine.key); rerender(); },
      }, `Show ${hiddenCount} more`)) : null,
    expanded && filtered.length > PAGE_SIZE ? el('div.body', {},
      el('button.sm.ghost', {
        onclick: () => { state_.expanded.delete(machine.key); rerender(); },
      }, 'Show fewer')) : null);
}

function groupSection(group, machines, rerender) {
  return el('div', { style: { marginTop: '18px' } },
    el('h2', { style: { margin: '0 0 10px', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--ink-2)' } },
      group),
    el('div.grid.two', {}, ...machines.map((m) => machineTable(m, rerender))));
}

export function renderTracker(rerender, go) {
  if (!hasTasks()) {
    return el('div.panel', {},
      el('div.empty', {},
        el('h3', {}, 'No schedule loaded yet'),
        el('p', {}, 'Import the Rolling and CNC workbooks to get started.'),
        el('button.primary', { onclick: () => go('setup') }, 'Go to Setup')));
  }

  const groups = machinesByGroup();

  const head = el('div.panel', {},
    el('div.body', {},
      el('div.row', {},
        el('input', {
          type: 'search', placeholder: 'Search W/O, project, die…', value: state_.q,
          style: { maxWidth: '280px' },
          oninput: (e) => {
            state_.q = e.target.value;
            clearTimeout(head._t);
            head._t = setTimeout(rerender, 150);
          },
        }),
        el('span.spacer'),
        el('label.row.small', { style: { gap: '6px' } },
          el('input', {
            type: 'checkbox', checked: state_.showDone, style: { width: 'auto' },
            onchange: (e) => { state_.showDone = e.target.checked; rerender(); },
          }),
          'Show done'))));

  const sections = TRACKED_GROUPS
    .filter((g) => groups.has(g))
    .map((g) => groupSection(g, groups.get(g), rerender));

  return el('div', {}, head, ...sections);
}
