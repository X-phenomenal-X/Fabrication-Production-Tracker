/* Back orders: every line short of material, across all four centres, grouped
   by who is chasing it.

   Whoever chases material does not care which machine a shortage sits on, so
   this cuts across the centre pages. The dialog lives here too and is imported
   by the centre view, so there is exactly one place a shortage is recorded. */

import { el, chip, icon, fmtDate, fmtNum, fmtWhen, toast, modal } from '../ui.js';
import { setBackOrder, clearBackOrder, me, directoryPeople } from '../store.js';
import {
  allBackOrders, resolveBackOrder, backOrderFor, taskStatusKey, hasTasks,
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

export function backOrderDialog(task, rerender) {
  const key = taskStatusKey(task);
  const cur = backOrderFor(key) || {};
  const resolved = resolveBackOrder(task);
  const max = task.qty ?? null;

  const flag = el('input', { type: 'checkbox', checked: resolved.on });
  const qty = el('input', {
    type: 'number', min: '0', inputmode: 'numeric',
    max: max == null ? undefined : String(max),
    value: cur.qty ?? '', placeholder: '0',
  });

  // Names already in the app, plus an escape hatch for a buyer or supplier
  // contact who is not a tracker user.
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
    el('option', { value: '', selected: !cur.assignee }, 'Unassigned'),
    ...[...people, ...known].map((p) => el('option', {
      value: p, selected: cur.assignee === p,
    }, p)),
    el('option', { value: TYPE_A_NAME }, '— type a name —'));

  const note = el('textarea', {
    value: cur.note || '',
    placeholder: 'What is short, who was chased, expected date…',
    style: { minHeight: '90px' },
  });

  const body = el('div', {},
    el('div.bo-dialoghead', {},
      el('span.mono.strong', {}, `W/O ${task.wo}`),
      task.die ? el('span.die', {}, task.die) : null,
      el('span.small.muted', {},
        `${task.project || ''}${task.floor ? ' · ' + task.floor : ''}`.trim())),

    el('label.row.bo-flagrow', {},
      flag,
      el('span', {},
        el('strong', {}, 'Short of material'),
        // The flag has three states and only two of them are obvious. Said in
        // full here, because "unticking a box the workbook ticked" is the one
        // that gets misread — it records a resolution, it does not erase one.
        el('div.small.bo-tristate', {},
          resolved.fromSheet
            ? 'The workbook reports this line short. Leave it ticked while it '
              + 'still is; untick it once the material has landed, and the '
              + 'tracker will keep showing it as resolved even though the '
              + 'sheet still says B/O.'
            : 'The workbook does not report this line short. Ticking it flags a '
              + 'shortage found on the floor, and it stays flagged through the '
              + 'next import.'))),

    el('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '12px', marginTop: '14px' } },
      el('label.field', {},
        el('span', {}, 'Pieces short', max != null ? el('em.of-total', {}, `of ${fmtNum(max)} on the line`) : null),
        qty),
      el('label.field', {},
        el('span', {}, 'Assigned to'),
        who, nameInput)),

    // Two different units, and mixing them up changes what gets ordered — so
    // they are shown side by side and labelled, never merged into one number.
    resolved.sheetShort ? el('div.bo-sheetnote', {},
      icon('alert', { size: 14 }),
      el('span', {},
        el('strong', {}, 'The workbook counts bars, this form counts pieces.'),
        el('div', {}, `Sheet says: ${resolved.sheetShort}`))) : null,

    el('label.field', { style: { marginTop: '12px' } }, el('span', {}, 'Back order note'), note),

    cur.at ? el('div.small.muted', { style: { marginTop: '10px' } },
      `Last updated by ${cur.by} · ${fmtWhen(cur.at)}`) : null);

  modal(`Back order — ${task.wo}`, body, {
    actions: [
      cur.at ? {
        label: 'Clear', class: 'danger', onClick: (dlg) => {
          clearBackOrder(key);
          dlg.close(); toast('Back order cleared'); rerender();
        },
      } : null,
      {
        label: 'Save', class: 'primary', onClick: (dlg) => {
          const assignee = who.value === TYPE_A_NAME ? nameInput.value : who.value;
          let pieces = qty.value === '' ? null : Number(qty.value);
          if (pieces != null && max != null) pieces = Math.min(pieces, max);
          setBackOrder(key, {
            // Record the flag explicitly, so unticking a sheet-reported
            // shortage is stored as "resolved" rather than read as "unset".
            flagged: flag.checked,
            qty: pieces,
            assignee,
            note: note.value,
          });
          dlg.close(); toast('Back order saved'); rerender();
        },
      },
    ].filter(Boolean),
  });
}

/* ---------- the page ---------- */

let mineOnly = false;

/* ---------- back orders on a phone ----------

   Seventy-eight lines across seven chase lists, twelve screens deep, and two
   things wrong with reading it on a phone rather than at a desk.

   The list nobody owns sorts last. On a monitor that reads as the odd one out
   put at the end; on a phone it puts the fifty-five lines this page calls the
   urgent ones eight screens below the fold. Here it leads.

   And every row was a div with an onclick — no keyboard, no accessible name,
   invisible to the tap-target check because it is not a control. On the phone
   a row that opens a dialog is a button that says what it opens.

   The desk page stays a complete scan-and-print list. Both surfaces use real,
   named controls and CSS shows exactly one. */

const bm = { open: {} };

const BO_PAGE = 8;

function mobileBoRow(row, rerender) {
  const { task, bo, machine } = row;
  const short = bo.qty != null ? `${fmtNum(bo.qty)} pcs short` : 'not counted';

  return el('button.bo-m-row', {
    type: 'button',
    // The row opens the shortage dialog, so it says so rather than leaving a
    // screen reader to infer it from four stacked spans.
    'aria-label': `${task.wo}, ${task.project || 'no project'}, ${short} — edit this back order`,
    onclick: () => backOrderDialog(task, rerender),
  },
    el('span.bo-m-main', {},
      el('span.bo-m-id', {},
        el('span.mono.strong', {}, task.wo),
        task.die ? el('span.die', {}, task.die) : null,
        chip(machineLabel(machine), 'mute')),
      el('span.bo-m-where', {},
        el('span', {}, task.project || '—'),
        task.floor ? el('span.muted', {}, ' · ' + task.floor) : null),
      el('span.bo-m-facts', {},
        el('span.bo-m-short' + (bo.qty != null ? '' : '.none'), {}, short),
        // `.line-date` is hidden below the small breakpoint, so on a phone the
        // date this list is sorted by was the one thing it never showed.
        el('span.bo-m-when', {}, fmtDate(task.cuttingDate))),
      bo.note ? el('span.bo-m-note', {},
        icon('note', { size: 13 }), el('span', {}, bo.note)) : null,
      bo.sheetShort ? el('span.bo-m-note.from-sheet', {},
        icon('alert', { size: 13 }),
        el('span', {}, el('span.muted', {}, 'workbook: '), bo.sheetShort)) : null),
    icon('chevron', { size: 16, cls: 'bo-m-go' }));
}

function mobileBoGroup(group, rerender) {
  const id = group.assignee || '__none__';
  const shown = bm.open[id] || BO_PAGE;
  const left = group.rows.length - shown;
  const short = group.rows.reduce((a, r) => a + (r.bo.qty || 0), 0);

  return el('section.bo-m-group', {},
    el('div.bo-m-grouphead' + (group.assignee ? '' : '.none'), {},
      el('span.bo-avatar', { 'aria-hidden': 'true' },
        group.assignee ? group.assignee.slice(0, 1).toUpperCase() : '?'),
      el('span.bo-m-who', {}, group.assignee || 'Nobody is chasing these'),
      el('span.bo-m-count', {}, String(group.rows.length)),
      el('span.spacer'),
      short ? el('span.bo-m-shortsum', {}, `${fmtNum(short)} pcs`) : null),

    ...group.rows.slice(0, shown).map((r) => mobileBoRow(r, rerender)),

    left > 0 ? el('button.bo-m-more', {
      type: 'button',
      onclick: () => { bm.open[id] = shown + BO_PAGE; rerender(); },
    }, `Show ${Math.min(left, BO_PAGE)} more of ${group.rows.length}`) : null);
}

/** The phone page: the unowned list first, then each person's, each bounded. */
function mobileBackOrders(groups, rerender) {
  const ordered = [
    ...groups.filter((g) => !g.assignee),
    ...groups.filter((g) => g.assignee),
  ];
  return el('div.bo-m', {}, ...ordered.map((g) => mobileBoGroup(g, rerender)));
}



export function renderBackOrders(rerender, go) {
  if (!hasTasks()) {
    return el('div.panel', {},
      el('div.empty', {},
        el('div.empty-icon', {}, icon('upload', { size: 28 })),
        el('h3', {}, 'No schedule loaded yet'),
        el('p', {}, 'Import the Rolling and CNC workbooks to get started.'),
        el('button.primary', { onclick: () => go('setup') }, 'Go to Setup')));
  }

  let groups = allBackOrders();
  if (mineOnly) groups = groups.filter((g) => g.assignee === me());

  const total = groups.reduce((a, g) => a + g.rows.length, 0);
  const pieces = groups.reduce((a, g) =>
    a + g.rows.reduce((b, r) => b + (r.bo.qty || 0), 0), 0);
  const unassigned = allBackOrders().find((g) => !g.assignee)?.rows.length || 0;

  const head = el('div.centre-head', {},
    el('div.row.centre-title-row', {},
      el('div.centre-ident', {},
        el('span.centre-rail', { 'aria-hidden': 'true' }),
        el('div', {},
          el('h1.centre-title', {}, 'Back orders'),
          el('div.centre-sub', {}, 'Lines short of material, across every centre'))),
      el('span.spacer'),
      el('div.centre-stats', {},
        el('div.cstat' + (total ? '.bad' : ''), {}, el('b', {}, fmtNum(total)), el('i', {}, 'lines')),
        el('div.cstat', {}, el('b', {}, fmtNum(pieces)), el('i', {}, 'pcs short')),
        el('div.cstat' + (unassigned ? '.warn' : ''), {}, el('b', {}, fmtNum(unassigned)), el('i', {}, 'unassigned')))),
    el('div.centre-filters', {},
      el('label.row.small.donetoggle', {},
        el('input', {
          type: 'checkbox', checked: mineOnly,
          onchange: (e) => { mineOnly = e.target.checked; rerender(); },
        }),
        `Only mine (${me()})`)));

  if (!groups.length) {
    return el('div.centre', {}, head,
      el('div.panel', {}, el('div.empty', {},
        el('div.empty-icon', {}, icon('check', { size: 28 })),
        el('h3', {}, mineOnly ? 'Nothing assigned to you' : 'No back orders'),
        el('div', {}, mineOnly
          ? 'Nothing is waiting on you right now.'
          : 'Nothing is flagged short of material.'))));
  }

  const sections = groups.map((g) => {
    const short = g.rows.reduce((a, r) => a + (r.bo.qty || 0), 0);
    // The person is the heading, not a label on one — this page is a set of
    // chase lists, one per person, and an unowned list is the urgent one.
    return el('section.dgroup.bo-group', {},
      el('div.bo-grouphead' + (g.assignee ? '' : '.none'), {},
        el('span.bo-avatar', { 'aria-hidden': 'true' },
          g.assignee ? g.assignee.slice(0, 1).toUpperCase() : '?'),
        el('span.bo-who', {}, g.assignee || 'Nobody is chasing these'),
        el('span.dgroup-count', {}, String(g.rows.length)),
        el('span.spacer'),
        short ? el('span.small.muted', {}, `${fmtNum(short)} pcs short`) : null),

      el('div.dgroup-body', {}, ...g.rows.map(({ task, bo, machine }) => {
        const short = bo.qty != null ? `${fmtNum(bo.qty)} pieces short` : 'short quantity not counted';
        return el('button.line.bo-line.is-bo', {
          type: 'button',
          'aria-label': `Work order ${task.wo}, ${task.project || 'no project'}, ${short} — edit this back order`,
          onclick: () => backOrderDialog(task, rerender),
        },
          el('span.line-main', {},
            el('span.line-id', {},
              el('span.mono.strong', {}, task.wo),
              task.die ? el('span.die', {}, task.die) : null,
              chip(machineLabel(machine), 'mute')),
            el('span.line-where', {},
              el('span', {}, task.project || '—'),
              task.floor ? el('span.muted', {}, ' · ' + task.floor) : null),
            bo.note ? el('span.line-bonote', {}, icon('note', { size: 13 }),
              el('span', {}, bo.note)) : null,
            // Bars, kept visibly separate from the pieces count beside it.
            bo.sheetShort ? el('span.line-bonote.from-sheet', {}, icon('alert', { size: 13 }),
              el('span', {}, el('span.muted', {}, 'workbook: '), bo.sheetShort)) : null),

          el('span.line-qty.bo-qty', {},
            bo.qty != null
              ? el('span.mono.bo-short', {}, fmtNum(bo.qty))
              : el('span.mono.muted', {}, '—'),
            el('span.small.muted', {}, bo.qty != null ? 'pcs short' : 'not counted')),

          el('span.line-date.hide-sm', {}, fmtDate(task.cuttingDate)));
      })));
  });

  return el('div.centre', {}, head,
    mobileBackOrders(groups, rerender),
    el('div.bo-wide', {}, ...sections));
}
