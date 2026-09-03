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
import { setRush, clearRush, me, directoryPeople } from '../store.js';
import {
  allRush, resolveRush, rushFor, taskStatusKey, hasTasks, today, addDays,
  machineConfig,
} from '../model.js';
import { MACHINE_BY_KEY } from '../machines.js';
import { haptic } from '../motion.js';

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

  const flag = el('input', { type: 'checkbox', checked: resolved.on });
  const needBy = el('input', { type: 'date', value: cur.needBy || '' });

  // Cutting date is what the sheet plans against; the rush date is when it is
  // actually needed, which is the thing that is usually earlier.
  const quick = (label, iso) => el('button.linkbtn', {
    type: 'button',
    onclick: () => { needBy.value = iso; flag.checked = true; },
  }, label);

  const people = directoryPeople();
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
          if (flag.checked && !resolved.on) haptic('rush');
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

/* The desk page stays a complete schedule for scanning and print. On a phone,
   urgency is the navigation: each date bucket starts bounded, then expands in
   small batches when the operator asks. */
const rushMobileState = { open: {} };
const RUSH_PAGE = 4;

function rushRowName({ task, rush, machine }) {
  const need = rush.needBy ? `needed by ${fmtDate(rush.needBy)}` : 'no need-by date';
  const owner = rush.assignee ? `assigned to ${rush.assignee}` : 'nobody has been told';
  return `Work order ${task.wo}, ${task.project || 'no project'}, ${need}, ${fmtNum(task.qty)} pieces, ${machineLabel(machine)}, ${owner} — edit rush details`;
}

function desktopRushRow(row, ref, rerender) {
  const { task, rush, machine } = row;
  const late = rush.late || rush.needBy === ref;
  return el('button.line.rush-line' + (late ? '.is-late' : '.rush'), {
    type: 'button',
    'aria-label': rushRowName(row),
    onclick: () => rushDialog(task, rerender),
  },
    // Need-by leads the row here, not the work order: on this page the
    // question is what runs first, and the date is the answer.
    el('span.rush-when' + (late ? '.late' : ''), {},
      el('span.rush-need', {}, rush.needBy ? fmtDate(rush.needBy) : 'No date'),
      el('span.rush-needcap', {}, rush.needBy ? 'needed by' : 'not set')),

    el('span.line-main', {},
      el('span.line-id', {},
        el('span.mono.strong', {}, task.wo),
        task.die ? el('span.die', {}, task.die) : null,
        chip(machineLabel(machine), 'mute')),
      el('span.line-where', {},
        el('span', {}, task.project || '—'),
        task.floor ? el('span.muted', {}, ' · ' + task.floor) : null),
      // Who was told is half of what a rush *is*. A rush nobody owns is the
      // one most likely to be missed, so it says so outright.
      el('span.line-rushband' + (rush.assignee ? '' : '.nobody'), {},
        icon(rush.assignee ? 'bolt' : 'alert', { size: 13 }),
        el('span', {},
          el('strong', {}, rush.assignee || 'Nobody told'),
          rush.reason ? el('span', {}, ' — ' + rush.reason) : null))),

    el('span.line-qty', {},
      el('span.mono', {}, fmtNum(task.qty)),
      el('span.small.muted', {}, 'pcs')));
}

function mobileRushRow(row, ref, rerender) {
  const { task, rush, machine } = row;
  const late = rush.late || rush.needBy === ref;
  return el('button.rush-m-row.rush-line' + (late ? '.is-late' : '.rush'), {
    type: 'button',
    'aria-label': rushRowName(row),
    onclick: () => rushDialog(task, rerender),
  },
    el('span.rush-m-main', {},
      el('span.rush-m-id', {},
        el('span.mono.strong', {}, task.wo),
        task.die ? el('span.die', {}, task.die) : null,
        chip(machineLabel(machine), 'mute')),
      el('span.rush-m-where', {},
        el('span', {}, task.project || '—'),
        task.floor ? el('span.muted', {}, ' · ' + task.floor) : null),
      el('span.rush-m-facts', {},
        el('span.rush-m-when' + (late ? '.bad' : ''), {},
          rush.needBy ? `${fmtDate(rush.needBy)} needed by` : 'No need-by date'),
        el('span.rush-m-qty', {}, `${fmtNum(task.qty)} pcs`)),
      el('span.rush-m-owner' + (rush.assignee ? '' : '.nobody'), {},
        icon(rush.assignee ? 'bolt' : 'alert', { size: 13 }),
        el('strong', {}, rush.assignee || 'Nobody told'),
        rush.reason ? el('span.rush-m-reason', {}, ' — ' + rush.reason) : null)),
    icon('chevron', { size: 16, cls: 'rush-m-go' }));
}

function mobileRushGroup(bucket, rows, ref, rerender) {
  const shown = rushMobileState.open[bucket.key] || RUSH_PAGE;
  const left = Math.max(0, rows.length - shown);
  return el('section.rush-m-group', { 'data-bucket': bucket.key },
    el('div.rush-m-grouphead', {},
      el('span.rush-m-groupdot.' + bucket.tone, { 'aria-hidden': 'true' }),
      el('span.rush-m-grouplabel', {}, bucket.label),
      el('span.rush-m-groupcount.' + bucket.tone, {}, String(rows.length))),
    ...rows.slice(0, shown).map((row) => mobileRushRow(row, ref, rerender)),
    left > 0 ? el('button.rush-m-more', {
      type: 'button',
      onclick: () => {
        rushMobileState.open[bucket.key] = shown + RUSH_PAGE;
        rerender();
      },
    }, `Show ${Math.min(left, RUSH_PAGE)} more of ${rows.length}`) : null);
}

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
      el('div.centre-ident', {},
        el('span.centre-rail', { 'aria-hidden': 'true' }),
        el('div', {},
          el('h1.centre-title', {}, 'Rush'),
          el('div.centre-sub', {}, 'Lines that jump the queue, across every centre'))),
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

  const activeBuckets = BUCKETS.filter((b) => byBucket.get(b.key).length);
  const sections = activeBuckets.map((b) => el('section.dgroup', {},
      el('div.dgroup-head', {},
        el('span.dgroup-label.' + b.tone, {}, b.label),
        el('span.dgroup-count', {}, String(byBucket.get(b.key).length))),
      el('div.dgroup-body', {},
        ...byBucket.get(b.key).map((row) => desktopRushRow(row, ref, rerender)))));

  return el('div.centre', {}, head,
    el('div.rush-m', {},
      ...activeBuckets.map((b) => mobileRushGroup(b, byBucket.get(b.key), ref, rerender))),
    el('div.rush-wide', {}, ...sections));
}
