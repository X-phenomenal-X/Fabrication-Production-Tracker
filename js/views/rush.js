/* Rush: the lines that jump the queue, and the page that lists them.

   Nothing in either workbook says "this one first" — a rush is always somebody
   deciding, usually because a shipping gate moved or site called. So it is
   recorded as what it is: a flag, the date it is actually needed by, who is
   being told, and the reason.

   The dialog lives here and is imported by the centre pages, so a rush is
   recorded in exactly one place. */

import {
  el, chip, icon, fmtDate, fmtNum, fmtWhen, toast, modal,
} from '../ui.js';
import { state, setRush, clearRush, me } from '../store.js';
import {
  allRush, resolveRush, rushFor, taskStatusKey, hasTasks, today, addDays,
  machineConfig,
} from '../model.js';
import { MACHINE_BY_KEY } from '../machines.js';

/** A machine's name as the department has it — a renamed machine must not go
    back to its built-in label just because this page is not the centre page. */
function machineLabel(key) {
  const m = MACHINE_BY_KEY[key];
  return m ? machineConfig(m).label : key;
}

const TYPE_A_NAME = '__type__';

/* ---------- the dialog, shared with the centre pages ---------- */

export function rushDialog(task, rerender) {
  const key = taskStatusKey(task);
  const cur = rushFor(key) || {};
  const resolved = resolveRush(task);

  const flag = el('input', { type: 'checkbox', checked: resolved.on, style: { width: 'auto' } });
  const needBy = el('input', { type: 'date', value: cur.needBy || '' });

  // Cutting date is what the sheet plans against; the rush date is when it is
  // actually needed, which is the thing that is usually earlier.
  const quick = (label, iso) => el('button.linkbtn', {
    type: 'button',
    onclick: () => { needBy.value = iso; flag.checked = true; },
  }, label);

  const people = state.people || [];
  const known = cur.assignee && !people.includes(cur.assignee) ? [cur.assignee] : [];
  const nameInput = el('input', {
    value: cur.assignee || '', placeholder: 'Name',
    style: { display: 'none', marginTop: '8px' },
  });
  const who = el('select', {
    onchange: (e) => {
      const typing = e.target.value === TYPE_A_NAME;
      nameInput.style.display = typing ? '' : 'none';
      if (typing) nameInput.focus();
    },
  },
    el('option', { value: '', selected: !cur.assignee }, 'Nobody in particular'),
    ...[...people, ...known].map((p) => el('option', {
      value: p, selected: cur.assignee === p,
    }, p)),
    el('option', { value: TYPE_A_NAME }, '— type a name —'));

  const reason = el('textarea', {
    value: cur.reason || '',
    placeholder: 'Shipping gate Friday, site is waiting, remake for a broken piece…',
    style: { minHeight: '84px' },
  });

  const body = el('div', {},
    el('div.bo-dialoghead', {},
      el('span.mono.strong', {}, `W/O ${task.wo}`),
      task.die ? el('span.die', {}, task.die) : null,
      el('span.small.muted', {},
        `${task.project || ''}${task.floor ? ' · ' + task.floor : ''}`.trim())),

    el('label.row.rush-flagrow', {},
      flag,
      el('span', {},
        el('strong', {}, 'Mark as rush'),
        el('div.small.muted', {}, 'Rush lines sort to the top of the machine\'s queue.'))),

    el('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '12px', marginTop: '14px' } },
      el('label.field', {},
        el('span', {}, 'Needed by',
          task.cuttingDate
            ? el('em.of-total', {}, `cutting date ${fmtDate(task.cuttingDate)}`)
            : null),
        needBy,
        el('div.rush-quick', {},
          quick('Today', today()),
          quick('Tomorrow', addDays(today(), 1)),
          quick('End of week', addDays(today(), 5)))),
      el('label.field', {},
        el('span', {}, 'Tell'),
        who, nameInput)),

    el('label.field', { style: { marginTop: '12px' } },
      el('span', {}, 'Why it is a rush'), reason),

    cur.at ? el('div.small.muted', { style: { marginTop: '10px' } },
      `Last updated by ${cur.by} · ${fmtWhen(cur.at)}`) : null);

  modal(`Rush — ${task.wo}`, body, {
    actions: [
      cur.at ? {
        label: 'Clear', class: 'danger', onClick: (dlg) => {
          clearRush(key);
          dlg.close(); toast('Rush cleared'); rerender();
        },
      } : null,
      {
        label: 'Save', class: 'primary', onClick: (dlg) => {
          const assignee = who.value === TYPE_A_NAME ? nameInput.value : who.value;
          setRush(key, {
            on: flag.checked,
            needBy: needBy.value || null,
            assignee,
            reason: reason.value,
          });
          dlg.close();
          toast(flag.checked ? 'Marked as rush' : 'Rush cleared');
          rerender();
        },
      },
    ].filter(Boolean),
  });
}

/* ---------- the page ---------- */

/* Bucketed by how close the needed-by date is, not by machine — a rush list
   sorted by machine buries the one that is already late. */
const BUCKETS = [
  { key: 'LATE', label: 'Past its date', tone: 'bad' },
  { key: 'TODAY', label: 'Today', tone: 'bad' },
  { key: 'SOON', label: 'Next two days', tone: 'warn' },
  { key: 'LATER', label: 'Later', tone: 'mute' },
  { key: 'NODATE', label: 'No date given', tone: 'mute' },
];

function bucketOf(rush, ref) {
  if (!rush.needBy) return 'NODATE';
  if (rush.needBy < ref) return 'LATE';
  if (rush.needBy === ref) return 'TODAY';
  return rush.needBy <= addDays(ref, 2) ? 'SOON' : 'LATER';
}

let mineOnly = false;

export function renderRush(rerender, go) {
  if (!hasTasks()) {
    return el('div.panel', {},
      el('div.empty', {},
        el('div.empty-icon', {}, icon('upload', { size: 28 })),
        el('h3', {}, 'No schedule loaded yet'),
        el('p', {}, 'Import the Rolling and CNC workbooks to get started.'),
        el('button.primary', { onclick: () => go('setup') }, 'Go to Setup')));
  }

  const ref = today();
  const all = allRush(ref);
  const rows = mineOnly ? all.filter((r) => r.rush.assignee === me()) : all;

  const late = all.filter((r) => bucketOf(r.rush, ref) === 'LATE').length;
  const todayN = all.filter((r) => bucketOf(r.rush, ref) === 'TODAY').length;
  const pieces = rows.reduce((a, r) => a + (r.task.qty || 0), 0);

  const head = el('div.centre-head', {},
    el('div.row.centre-title-row', {},
      el('div', {},
        el('h1.centre-title', {}, 'Rush'),
        el('div.centre-sub', {}, 'Lines that jump the queue, across every centre')),
      el('span.spacer'),
      el('div.centre-stats', {},
        el('div.cstat' + (all.length ? '.warn' : ''), {},
          el('b', {}, fmtNum(all.length)), el('i', {}, 'lines')),
        el('div.cstat' + (late ? '.bad' : ''), {},
          el('b', {}, fmtNum(late)), el('i', {}, 'past date')),
        el('div.cstat' + (todayN ? '.bad' : ''), {},
          el('b', {}, fmtNum(todayN)), el('i', {}, 'today')),
        el('div.cstat', {}, el('b', {}, fmtNum(pieces)), el('i', {}, 'pcs')))),
    el('div.centre-filters', {},
      el('label.row.small.donetoggle', {},
        el('input', {
          type: 'checkbox', checked: mineOnly,
          onchange: (e) => { mineOnly = e.target.checked; rerender(); },
        }),
        `Only mine (${me()})`)));

  if (!rows.length) {
    return el('div.centre', {}, head,
      el('div.panel', {}, el('div.empty', {},
        el('div.empty-icon', {}, icon('check', { size: 28 })),
        el('h3', {}, mineOnly ? 'Nothing rushed to you' : 'Nothing is rushed'),
        el('div', {}, mineOnly
          ? 'Nobody has put a rush line on you.'
          : 'Open any line and use the rush button to put it at the top of its queue.'))));
  }

  const byBucket = new Map(BUCKETS.map((b) => [b.key, []]));
  for (const r of rows) byBucket.get(bucketOf(r.rush, ref)).push(r);

  const sections = BUCKETS
    .filter((b) => byBucket.get(b.key).length)
    .map((b) => el('section.dgroup', {},
      el('div.dgroup-head', {},
        el('span.dgroup-label.' + b.tone, {}, b.label),
        el('span.dgroup-count', {}, String(byBucket.get(b.key).length))),

      el('div.dgroup-body', {}, ...byBucket.get(b.key).map(({ task, rush, machine }) =>
        el('div.line.rush-line', {
          style: { cursor: 'pointer' },
          onclick: () => rushDialog(task, rerender),
        },
          el('div.line-main', {},
            el('div.line-id', {},
              el('span.mono.strong', {}, task.wo),
              task.die ? el('span.die', {}, task.die) : null,
              chip(machineLabel(machine), 'mute')),
            el('div.line-where', {},
              el('span', {}, task.project || '—'),
              task.floor ? el('span.muted', {}, ' · ' + task.floor) : null),
            rush.reason || rush.assignee ? el('div.line-rushband', {},
              icon('bolt', { size: 12 }),
              el('span', {},
                rush.assignee ? el('strong', {}, rush.assignee) : null,
                rush.reason
                  ? el('span', {}, `${rush.assignee ? ' — ' : ''}${rush.reason}`)
                  : null)) : null),

          el('div.line-qty', {},
            el('span.mono', {}, fmtNum(task.qty)),
            el('span.small.muted', {}, 'pcs')),

          el('div.line-date', {},
            el('div.rush-need' + (rush.late || rush.needBy === ref ? '.late' : ''), {},
              rush.needBy ? fmtDate(rush.needBy) : '—'),
            el('div.small.muted', {}, 'needed')))))));

  return el('div.centre', {}, head, ...sections);
}
