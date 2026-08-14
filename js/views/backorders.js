/* Back orders: every line short of material, across all four centres, grouped
   by who is chasing it.

   Whoever chases material does not care which machine a shortage sits on, so
   this cuts across the centre pages. The dialog lives here too and is imported
   by the centre view, so there is exactly one place a shortage is recorded. */

import { el, chip, icon, fmtDate, fmtNum, fmtWhen, toast, modal } from '../ui.js';
import { state, setBackOrder, clearBackOrder, me } from '../store.js';
import {
  allBackOrders, resolveBackOrder, backOrderFor, taskStatusKey, hasTasks,
} from '../model.js';
import { MACHINE_BY_KEY } from '../machines.js';

const TYPE_A_NAME = '__type__';

/* ---------- the dialog, shared with the centre pages ---------- */

export function backOrderDialog(task, rerender) {
  const key = taskStatusKey(task);
  const cur = backOrderFor(key) || {};
  const resolved = resolveBackOrder(task);
  const max = task.qty ?? null;

  const flag = el('input', { type: 'checkbox', checked: resolved.on, style: { width: 'auto' } });
  const qty = el('input', {
    type: 'number', min: '0', inputmode: 'numeric',
    max: max == null ? undefined : String(max),
    value: cur.qty ?? '', placeholder: '0',
  });

  // Names already in the app, plus an escape hatch for a buyer or supplier
  // contact who is not a tracker user.
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
        el('strong', {}, 'Flag as back order'),
        resolved.fromSheet
          ? el('div.small.muted', {}, 'The workbook already reports this line as B/O. Unticking records that it is resolved.')
          : null)),

    el('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '12px', marginTop: '14px' } },
      el('label.field', {},
        el('span', {}, 'Pieces short', max != null ? el('em.of-total', {}, `of ${fmtNum(max)}`) : null),
        qty),
      el('label.field', {},
        el('span', {}, 'Assigned to'),
        who, nameInput)),

    resolved.sheetShort ? el('div.bo-sheetnote', {},
      icon('alert', { size: 12 }),
      el('span', {}, el('strong', {}, 'Workbook says: '), resolved.sheetShort,
        el('span.muted', {}, ' — the sheet counts bars, the field above counts pieces'))) : null,

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
      el('div', {},
        el('h1.centre-title', {}, 'Back orders'),
        el('div.small.muted', {}, 'Lines short of material, across every centre')),
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
    return el('section.dgroup', {},
      el('div.dgroup-head', {},
        el('span.bo-who' + (g.assignee ? '' : '.none'), {},
          icon(g.assignee ? 'check' : 'alert', { size: 13 }),
          g.assignee || 'Unassigned'),
        el('span.dgroup-count', {}, String(g.rows.length)),
        el('span.spacer'),
        short ? el('span.small.muted', {}, `${fmtNum(short)} pcs short`) : null),

      el('div.dgroup-body', {}, ...g.rows.map(({ task, bo }) => el('div.line.bo-line', {
        style: { cursor: 'pointer' },
        onclick: () => backOrderDialog(task, rerender),
      },
        el('div.line-main', {},
          el('div.line-id', {},
            el('span.mono.strong', {}, task.wo),
            task.die ? el('span.die', {}, task.die) : null,
            chip(MACHINE_BY_KEY[task.machine]?.label || task.machine, 'mute')),
          el('div.line-where', {},
            el('span', {}, task.project || '—'),
            task.floor ? el('span.muted', {}, ' · ' + task.floor) : null),
          bo.note || bo.sheetShort
            ? el('div.line-bonote', {}, icon('alert', { size: 12 }),
                el('span', {}, bo.note || bo.sheetShort)) : null),

        el('div.line-qty', {},
          bo.qty != null
            ? el('span.mono.bo-short', {}, fmtNum(bo.qty))
            : el('span.small.muted', {}, '—'),
          el('span.small.muted', {}, bo.qty != null ? 'short' : '')),

        el('div.line-date.hide-sm', {}, fmtDate(task.cuttingDate))))));
  });

  return el('div.centre', {}, head, ...sections);
}
