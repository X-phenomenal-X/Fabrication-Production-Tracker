/* Staging: prepping material for rolling.

   The step before the schedule's first machine, and the one the department
   judges itself on — staging is done well when the next shift walks in to a
   job that is already there. Nothing tracked it before this page; it lived in
   a hidden sheet and in people's heads.

   It is an overlay on the rolling lines rather than a queue of its own, so a
   line is the same line whether you are staging it or rolling it: the same
   work order, the same status, the same notes and shortages. */

import {
  el, chip, icon, fmtDate, fmtNum, fmtWhen, toast,
} from '../ui.js';
import { setStaging, clearStaging, me } from '../store.js';
import {
  stagingQueue, hasTasks, machineConfig, taskStatusKey, today, addDays,
} from '../model.js';
import { MACHINE_BY_KEY } from '../machines.js';
import { dieDialog } from './dies.js';
import { SHIFTS, SHIFT_ORDER, shiftAt } from '../shifts.js';

const vs = { q: '', showStaged: true };

function machineLabel(key) {
  const m = MACHINE_BY_KEY[key];
  return m ? machineConfig(m).label : key;
}

/* "Stage for" is a shift, not a date — the whole point is that a named crew
   walks in to it. Stored as `date|shift` so it sorts, shown the way it is
   said on the floor. */
function stageForLabel(v) {
  if (!v) return null;
  const [date, shift] = String(v).split('|');
  return `${SHIFTS[shift]?.label || shift} · ${fmtDate(date, { withDay: true })}`;
}

/** The next few shifts, starting with the one after the current one — you
    stage for what is coming, not for the shift you are standing in. */
function upcomingShifts(n = 4) {
  const out = [];
  let date = today();
  let i = SHIFT_ORDER.indexOf(shiftAt());
  for (let k = 0; k < n; k++) {
    i += 1;
    if (i >= SHIFT_ORDER.length) { i = 0; date = addDays(date, 1); }
    out.push({ value: `${date}|${SHIFT_ORDER[i]}`, label: `${SHIFTS[SHIFT_ORDER[i]].label} ${fmtDate(date)}` });
  }
  return out;
}

function stageRow(row, rerender) {
  const { task, key, staging, machine, rush } = row;
  const staged = !!staging?.staged;

  return el('div.line.stage-line' + (staged ? '.is-staged' : '') + (rush.on ? '.rush' : ''), {},
    el('div.line-main', {},
      el('div.line-id', {},
        el('span.mono.strong', {}, task.wo),
        task.die ? el('button.die.dielink', {
          title: `What is ${task.die} made of?`,
          onclick: () => dieDialog(task.die),
        }, task.die) : null,
        chip(machineLabel(machine), 'mute'),
        rush.on ? el('span.badge-rush' + (rush.late || rush.soon ? '.hot' : ''), {},
          icon('bolt', { size: 11 }), 'RUSH') : null),
      el('div.line-where', {},
        el('span', {}, task.project || '—'),
        task.floor ? el('span.muted', {}, ' · ' + task.floor) : null),
      staged ? el('div.stage-band', {},
        icon('check', { size: 13 }),
        el('span', {},
          staging.stageFor
            ? el('strong', {}, 'For ' + stageForLabel(staging.stageFor))
            : el('strong', {}, 'Staged'),
          el('span.muted', {}, ` — ${staging.by}, ${fmtWhen(staging.at)}`))) : null),

    el('div.line-qty', {},
      el('span.mono', {}, fmtNum(task.qty)),
      el('span.small.muted', {}, 'pcs')),

    el('div.line-date.hide-sm', {}, fmtDate(task.cuttingDate)),

    // Staging for a named shift is the useful record; staging with no shift
    // named is still better than nothing, so it is one tap either way.
    el('div.stage-actions', {},
      staged
        ? el('button', {
            title: 'Put it back on the list',
            onclick: () => { clearStaging(key); toast('Back on the staging list'); rerender(); },
          }, icon('undo', { size: 14 }), 'Not staged')
        : el('div.stage-pick', {},
            el('select', {
              'aria-label': `Stage ${task.wo} for which shift`,
              onchange: (e) => {
                if (!e.target.value) return;
                setStaging(key, { staged: true, stageFor: e.target.value });
                toast(`${task.wo} staged for ${stageForLabel(e.target.value)}`);
                rerender();
              },
            },
              el('option', { value: '' }, 'Stage for…'),
              ...upcomingShifts().map((s) => el('option', { value: s.value }, s.label))),
            el('button.primary', {
              title: 'Staged, without saying which shift for',
              onclick: () => {
                setStaging(key, { staged: true, stageFor: null });
                toast(`${task.wo} staged`);
                rerender();
              },
            }, icon('check', { size: 14 }), 'Staged'))));
}

export function renderStaging(rerender, go) {
  if (!hasTasks()) {
    return el('div.panel', {},
      el('div.empty', {},
        el('div.empty-icon', {}, icon('upload', { size: 28 })),
        el('h3', {}, 'No schedule loaded yet'),
        el('p', {}, 'Staging works off the Rolling schedule. Import it to get started.'),
        el('button.primary', { onclick: () => go('setup') }, 'Go to Setup')));
  }

  const { todo, staged } = stagingQueue({ q: vs.q });
  const ref = today();
  const overdue = todo.filter((r) => r.task.cuttingDate && r.task.cuttingDate < ref).length;
  const dueToday = todo.filter((r) => r.task.cuttingDate === ref).length;

  const head = el('div.centre-head', {},
    el('div.row.centre-title-row', {},
      el('div.centre-ident', {},
        el('span.centre-rail', { 'aria-hidden': 'true' }),
        el('div', {},
          el('h1.centre-title', {}, 'Staging'),
          el('div.centre-sub', {},
            'Prepping for rolling — Auto and Manual',
            el('span.dot-sep', {}, '·'),
            'lines already running or finished are past staging'))),
      el('span.spacer'),
      el('div.centre-stats', {},
        el('div.cstat' + (todo.length ? '.warn' : ''), {},
          el('b', {}, fmtNum(todo.length)), el('i', {}, 'to stage')),
        el('div.cstat', {}, el('b', {}, fmtNum(staged.length)), el('i', {}, 'staged')),
        el('div.cstat' + (dueToday ? '.warn' : ''), {},
          el('b', {}, fmtNum(dueToday)), el('i', {}, 'due today')),
        el('div.cstat' + (overdue ? '.bad' : ''), {},
          el('b', {}, fmtNum(overdue)), el('i', {}, 'overdue')))),

    el('div.centre-filters', {},
      el('div.searchwrap', {},
        icon('search', { size: 15, cls: 'searchicon' }),
        el('input', {
          type: 'search', placeholder: 'Search W/O, project, die…', value: vs.q,
          oninput: (e) => {
            vs.q = e.target.value;
            clearTimeout(head._t);
            head._t = setTimeout(rerender, 150);
          },
        })),
      el('span.spacer'),
      el('label.row.small.donetoggle', {},
        el('input', {
          type: 'checkbox', checked: vs.showStaged,
          onchange: (e) => { vs.showStaged = e.target.checked; rerender(); },
        }),
        `Show staged${staged.length ? ` (${fmtNum(staged.length)})` : ''}`)));

  const section = (label, rows, tone) => (rows.length
    ? el('section.dgroup', {},
        el('div.dgroup-head', {},
          el('span.dgroup-label.' + tone, {}, label),
          el('span.dgroup-count', {}, String(rows.length))),
        el('div.dgroup-body', {}, ...rows.map((r) => stageRow(r, rerender))))
    : null);

  const body = todo.length || (vs.showStaged && staged.length)
    ? el('div', {},
        section('Needs staging', todo, 'warn'),
        vs.showStaged ? section('Staged and ready', staged, 'mute') : null)
    : el('div.panel', {}, el('div.empty', {},
        el('div.empty-icon', {}, icon('check', { size: 28 })),
        el('h3', {}, vs.q ? 'Nothing matches' : 'Nothing waiting to be staged'),
        el('div', {}, vs.q
          ? 'Try clearing the search.'
          : 'Every rolling line that has not started yet has been prepped. '
            + 'Anything already running or finished is past this point.')));

  return el('div.centre', {}, head, body);
}
