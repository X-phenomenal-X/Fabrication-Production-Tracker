/* Staging: prepping material for rolling.

   The step before the schedule's first machine, and the one the department
   judges itself on — staging is done well when the next shift walks in to a
   job that is already there. Nothing tracked it before this page; it lived in
   a hidden sheet and in people's heads.

   It is an overlay on the rolling lines rather than a queue of its own, so a
   line is the same line whether you are staging it or rolling it: the same
   work order, the same status, the same notes and shortages. */

import {
  el, chip, icon, fmtDate, fmtNum, fmtWhen, toast, modal,
} from '../ui.js';
import { setStaging, clearStaging, me } from '../store.js';
import {
  stagingQueue, hasTasks, machineConfig, taskStatusKey, today, addDays,
} from '../model.js';
import { MACHINE_BY_KEY } from '../machines.js';
import { dieDialog } from './die-launcher.js';
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
  const [nextShift] = upcomingShifts(1);

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
            // Most staging is for the very next crew. Make that the large,
            // glove-friendly action and keep the picker for the exceptions.
            el('button.primary', {
              title: `Stage for ${nextShift.label}`,
              onclick: () => {
                setStaging(key, { staged: true, stageFor: nextShift.value });
                toast(`${task.wo} staged for ${stageForLabel(nextShift.value)}`);
                rerender();
              },
            }, icon('check', { size: 14 }), `Stage · ${SHIFTS[nextShift.value.split('|')[1]].label}`),
            el('select', {
              'aria-label': `Stage ${task.wo} for which shift`,
              onchange: (e) => {
                if (!e.target.value) return;
                setStaging(key, { staged: true, stageFor: e.target.value });
                toast(`${task.wo} staged for ${stageForLabel(e.target.value)}`);
                rerender();
              },
            },
              el('option', { value: '' }, 'Other shift…'),
              ...upcomingShifts().slice(1).map((s) => el('option', { value: s.value }, s.label))))));
}

/* ---------- staging on a phone ----------

   Ninety-seven lines, eighty-four of them overdue, in one flat list of
   184-pixel rows: eighteen thousand pixels of identical-looking work with
   nothing saying which end to start at. The counts were already in the header
   and the queue was already sorted rush-first then by date — the page simply
   never showed either.

   So the phone buckets by how late the line is, caps what is on screen, and
   spends the row's height on the line rather than on its buttons. Nothing is
   removed: every bucket opens in full, and staging for a shift other than the
   next one moves from a select on all ninety-seven rows to one picker built
   when somebody asks for it. */

const sm = { open: {} };

const BUCKETS = [
  ['overdue', 'Overdue', 'bad'],
  ['today', 'Due today', 'warn'],
  ['later', 'Still to come', 'mute'],
];

/* How many rows of a bucket are on screen before the page asks. Twelve is
   about three phone screens — enough to work through without the list ending
   in a way that suggests there is nothing else. */
const PAGE = 12;

function bucketOf(row, ref) {
  const d = row.task.cuttingDate;
  if (!d) return 'later';
  if (d < ref) return 'overdue';
  if (d === ref) return 'today';
  return 'later';
}

/** The cutting date said the way it matters. `.line-date` is hidden below the
    small breakpoint, so on a phone the one field that says how late a line is
    was invisible while the header counted eighty-four of them. */
function dueLabel(date, ref) {
  if (!date) return { text: 'no date', tone: 'mute' };
  if (date === ref) return { text: 'due today', tone: 'warn' };
  if (date > ref) return { text: fmtDate(date), tone: 'mute' };
  const days = Math.round(
    (Date.parse(ref + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 86400000);
  return { text: days === 1 ? '1 day late' : `${days} days late`, tone: 'bad' };
}

/** Staging for a shift other than the very next one. One picker, built when
    it is asked for, instead of a select on every row in the queue. */
function pickShift(row, rerender) {
  const { task, key } = row;
  const body = el('div.stage-m-pick', {},
    ...upcomingShifts().map((s) => el('button.stage-m-pickbtn', {
      type: 'button',
      onclick: (e) => {
        e.currentTarget.closest('dialog')?.close();
        setStaging(key, { staged: true, stageFor: s.value });
        toast(`${task.wo} staged for ${stageForLabel(s.value)}`);
        rerender();
      },
    }, icon('check', { size: 15 }), el('span', {}, s.label))));
  modal(`Stage ${task.wo} for`, body);
}

function mobileRow(row, rerender) {
  const { task, key, staging, machine, rush } = row;
  const staged = !!staging?.staged;
  const [nextShift] = upcomingShifts(1);
  const due = dueLabel(task.cuttingDate, today());

  return el('div.stage-m-row' + (staged ? '.is-staged' : '') + (rush.on ? '.rush' : ''), {},
    el('div.stage-m-id', {},
      el('span.mono.strong', {}, task.wo),
      task.die ? el('button.die.dielink', {
        title: `What is ${task.die} made of?`,
        onclick: () => dieDialog(task.die),
      }, task.die) : null,
      rush.on ? el('span.badge-rush' + (rush.late || rush.soon ? '.hot' : ''), {},
        icon('bolt', { size: 11 }), 'RUSH') : null),

    el('div.stage-m-where', {},
      el('span', {}, task.project || '—'),
      task.floor ? el('span.muted', {}, ' · ' + task.floor) : null),

    el('div.stage-m-facts', {},
      el('span.stage-m-qty', {}, fmtNum(task.qty), el('small', {}, ' pcs')),
      el('span.stage-m-due.' + due.tone, {}, due.text),
      el('span.stage-m-machine', {}, machineLabel(machine))),

    staged
      ? el('div.stage-m-done', {},
          el('span.stage-m-doneband', {},
            icon('check', { size: 14 }),
            el('span', {}, staging.stageFor
              ? `For ${stageForLabel(staging.stageFor)}`
              : 'Staged'),
            el('small', {}, `${staging.by}, ${fmtWhen(staging.at)}`)),
          el('button.stage-m-undo', {
            type: 'button', title: 'Put it back on the list',
            onclick: () => { clearStaging(key); toast('Back on the staging list'); rerender(); },
          }, icon('undo', { size: 15 })))
      : el('div.stage-m-act', {},
          el('button.primary.stage-m-stage', {
            type: 'button',
            onclick: () => {
              setStaging(key, { staged: true, stageFor: nextShift.value });
              toast(`${task.wo} staged for ${stageForLabel(nextShift.value)}`);
              rerender();
            },
          }, icon('check', { size: 15 }),
            el('span', {}, `Stage · ${SHIFTS[nextShift.value.split('|')[1]].label}`)),
          el('button.stage-m-other', {
            type: 'button', 'aria-label': `Stage ${task.wo} for another shift`,
            title: 'Stage for another shift',
            onclick: () => pickShift(row, rerender),
          }, icon('list', { size: 16 }))));
}

function mobileSection(id, label, tone, rows, rerender) {
  if (!rows.length) return null;
  const shown = sm.open[id] || PAGE;
  const left = rows.length - shown;

  return el('section.stage-m-group', {},
    el('div.stage-m-grouphead', {},
      el('span.stage-m-groupdot.' + tone, { 'aria-hidden': 'true' }),
      el('span.stage-m-grouplabel', {}, label),
      el('span.stage-m-groupcount.' + tone, {}, String(rows.length))),
    ...rows.slice(0, shown).map((r) => mobileRow(r, rerender)),
    left > 0 ? el('button.stage-m-more', {
      type: 'button',
      onclick: () => { sm.open[id] = shown + PAGE; rerender(); },
    }, `Show ${Math.min(left, PAGE)} more of ${rows.length}`) : null);
}

/** The phone queue: what is late, what is next, and one tap to stage it. */
function mobileStaging(todo, staged, rerender) {
  const ref = today();
  const by = { overdue: [], today: [], later: [] };
  for (const r of todo) by[bucketOf(r, ref)].push(r);

  return el('div.stage-m', {},
    ...BUCKETS.map(([id, label, tone]) => mobileSection(id, label, tone, by[id], rerender)),
    vs.showStaged
      ? mobileSection('staged', 'Staged and ready', 'ok', staged, rerender)
      : null);
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
    // Both queues are built and CSS shows the one that fits the screen, the
    // same way the shift update carries a phone writer beside its desk form.
    ? el('div', {},
        mobileStaging(todo, staged, rerender),
        el('div.stage-wide', {},
          section('Needs staging', todo, 'warn'),
          vs.showStaged ? section('Staged and ready', staged, 'mute') : null))
    : el('div.panel', {}, el('div.empty', {},
        el('div.empty-icon', {}, icon('check', { size: 28 })),
        el('h3', {}, vs.q ? 'Nothing matches' : 'Nothing waiting to be staged'),
        el('div', {}, vs.q
          ? 'Try clearing the search.'
          : 'Every rolling line that has not started yet has been prepped. '
            + 'Anything already running or finished is past this point.')));

  return el('div.centre', {}, head, body);
}
