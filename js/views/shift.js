/* Shift update — laid out the way the department already writes it:
   one row per machine, with #Ops, work done / in progress, next in schedule
   and notes. Replaces the "Shift Update" sheet, not the idea behind it. */

import { el, chip, fmtDate, fmtNum, fmtWhen, toast, confirmDialog, modal } from '../ui.js';
import { state, saveShiftLog, deleteShiftLog, save, me } from '../store.js';
import { workInWindow, shiftWindow, today } from '../model.js';
import { SHIFTS, SHIFT_ORDER, shiftAt } from '../schema.js';
import { SHIFT_ROWS, MACHINE_BY_KEY, MACHINES } from '../machines.js';

const draft = {
  date: today(),
  shift: shiftAt(),
  rows: {},      // machineKey -> { ops, done, next, notes }
  notes: '',
};

function rowFor(key) {
  if (!draft.rows[key]) draft.rows[key] = { ops: '', done: '', next: '', notes: '' };
  return draft.rows[key];
}

/** Machines the department actually staffs, so the form is not 21 empty rows. */
function visibleRows() {
  const shown = state.settings.shiftRows;
  if (Array.isArray(shown) && shown.length) {
    return SHIFT_ROWS.filter((m) => shown.includes(m.key));
  }
  // Default: the standing rows plus every machine normally crewed.
  return SHIFT_ROWS.filter((m) => m.ops === undefined || m.ops > 0);
}

function pickRows(rerender) {
  const chosen = new Set(visibleRows().map((m) => m.key));
  const body = el('div', {}, ...SHIFT_ROWS.map((m) => el('label.oprow', { style: { cursor: 'pointer' } },
    el('input', {
      type: 'checkbox', checked: chosen.has(m.key), style: { width: 'auto' },
      onchange: (e) => { e.target.checked ? chosen.add(m.key) : chosen.delete(m.key); },
    }),
    el('span', { style: { flex: '1' } }, m.label),
    m.note ? el('span.small.muted', {}, m.note) : null,
    m.ops ? chip(`${m.ops} ops`, 'mute') : null)));

  modal('Which rows appear on the update', body, {
    actions: [{
      label: 'Save', class: 'primary', onClick: (dlg) => {
        state.settings.shiftRows = Array.from(chosen);
        save();
        dlg.close();
        rerender();
      }
    }],
  });
}

function composer(rerender) {
  const [from, to] = shiftWindow(draft.date, draft.shift);
  const work = workInWindow(from, to);
  const pieces = work.reduce((a, w) => a + (w.done || 0), 0);
  const shift = SHIFTS[draft.shift];
  const rows = visibleRows();

  const bind = (key, field, node, placeholder) => {
    const r = rowFor(key);
    node.value = r[field] || '';
    if (placeholder) node.placeholder = placeholder;
    node.addEventListener('input', () => { r[field] = node.value; });
    return node;
  };

  const grid = el('div.tbl-wrap', {}, el('table', {},
    el('thead', {}, el('tr', {},
      el('th', { style: { minWidth: '130px' } }, 'Machine'),
      el('th', { style: { width: '70px' } }, '#Ops'),
      el('th', {}, 'Work done / in progress'),
      el('th', {}, 'Next in schedule'),
      el('th', {}, 'Notes'))),
    el('tbody', {}, ...rows.map((m) => {
      const isMachine = m.ops !== undefined;
      return el('tr', {},
        el('td', {},
          el('div.strong', {}, m.label),
          m.note ? el('div.small.muted', {}, m.note) : null),
        el('td', {}, isMachine
          ? bind(m.key, 'ops', el('input', {
              type: 'number', min: '0', inputmode: 'numeric',
              style: { padding: '5px 7px', textAlign: 'right' },
            }), String(m.ops))
          : el('span.muted', {}, '—')),
        el('td', {}, bind(m.key, 'done', el('textarea', {
          style: { minHeight: '54px', fontSize: '13px' },
        }), '1-\n2-\n3-')),
        el('td', {}, bind(m.key, 'next', el('textarea', {
          style: { minHeight: '54px', fontSize: '13px' },
        }), '1-\n2-\n3-')),
        el('td', {}, bind(m.key, 'notes', el('textarea', {
          style: { minHeight: '54px', fontSize: '13px' },
        }), '')));
    }))));

  return el('div.panel', {},
    el('header', {}, 'Cutting shift update',
      el('span.spacer'),
      el('button.sm.ghost', { onclick: () => pickRows(rerender) }, 'Choose rows')),
    el('div.body', {},
      el('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', marginBottom: '12px' } },
        el('label.field', {}, el('span', {}, 'Date'),
          el('input', {
            type: 'date', value: draft.date,
            onchange: (e) => { draft.date = e.target.value; rerender(); },
          })),
        el('label.field', {}, el('span', {}, 'Shift'),
          el('select', {
            onchange: (e) => { draft.shift = e.target.value; rerender(); },
          }, ...SHIFT_ORDER.map((k) => el('option', {
            value: k, selected: draft.shift === k,
          }, SHIFTS[k].label)))),
      ),

      el('div.banner.info', { style: { marginBottom: '12px' } },
        el('div', {},
          el('strong', {}, `${fmtNum(pieces)} pieces logged on the board `),
          `during this shift window across ${work.length} entr${work.length === 1 ? 'y' : 'ies'}`,
          work.length ? ` — ${Array.from(new Set(work.map((w) => w.by))).join(', ')}` : '.')),

      !shift.full ? el('div.banner.warn', { style: { marginBottom: '12px' } },
        el('div', {}, `Midnight runs ${shift.crew} people — fill in only the machines actually staffed tonight.`)) : null),

    grid,

    el('div.body', {},
      el('label.field', { style: { marginBottom: '12px' } },
        el('span', {}, 'General notes for the next shift'),
        el('textarea', {
          value: draft.notes,
          placeholder: 'Anything not tied to one machine — breakdowns, material, people.',
          oninput: (e) => { draft.notes = e.target.value; },
        })),
      el('div.row', {},
        el('span.small.muted', {}, `Posting as ${me()}`),
        el('span.spacer'),
        el('button.primary', {
          onclick: () => {
            const filled = Object.fromEntries(Object.entries(draft.rows)
              .filter(([, r]) => (r.done || r.next || r.notes || r.ops)));
            if (!Object.keys(filled).length && !draft.notes.trim()) {
              toast('Fill in at least one machine before posting.');
              return;
            }
            saveShiftLog({
              date: draft.date, shift: draft.shift,
              rows: filled, notes: draft.notes.trim(),
              pieces, entries: work.length,
            });
            draft.rows = {};
            draft.notes = '';
            toast('Shift update posted');
            rerender();
          },
        }, 'Post update'))));
}

function logCard(l, rerender) {
  const rows = Object.entries(l.rows || {});
  return el('li', {},
    el('div.row', {},
      chip(SHIFTS[l.shift]?.label || l.shift, SHIFTS[l.shift]?.full ? 'mute' : 'warn'),
      el('strong', {}, fmtDate(l.date, { withDay: true })),
      el('span.spacer'),
      l.pieces ? el('span.small.muted', {}, `${fmtNum(l.pieces)} pcs logged`) : null,
      el('span.small.muted.nowrap', {}, `${l.by} · ${fmtWhen(l.at)}`),
      el('button.sm.ghost', {
        onclick: async () => {
          if (await confirmDialog('Delete shift update?',
            `This removes the ${SHIFTS[l.shift]?.label || l.shift} update for ${fmtDate(l.date)}.`,
            { confirmLabel: 'Delete', danger: true })) {
            deleteShiftLog(l.id); rerender();
          }
        },
      }, '×')),

    l.notes ? el('p', { style: { margin: '6px 0' } }, l.notes) : null,

    rows.length ? el('div.tbl-wrap', { style: { marginTop: '8px' } }, el('table', {},
      el('thead', {}, el('tr', {},
        el('th', {}, 'Machine'), el('th', {}, 'Ops'),
        el('th', {}, 'Done / in progress'), el('th', {}, 'Next'), el('th', {}, 'Notes'))),
      el('tbody', {}, ...rows.map(([key, r]) => el('tr', {},
        el('td.strong', {}, MACHINE_BY_KEY[key]?.label || key),
        el('td.num', {}, r.ops || '—'),
        el('td', { style: { whiteSpace: 'pre-wrap' } }, r.done || '—'),
        el('td', { style: { whiteSpace: 'pre-wrap' } }, r.next || '—'),
        el('td', { style: { whiteSpace: 'pre-wrap' } }, r.notes || '—')))))) : null,

    // Older updates used free-text fields; keep rendering them.
    l.issues ? el('div.banner.bad', { style: { marginTop: '6px' } },
      el('div', {}, el('strong', {}, 'Issues: '), l.issues)) : null,
    l.carryOver ? el('div.banner.warn', { style: { marginTop: '6px' } },
      el('div', {}, el('strong', {}, 'Carried over: '), l.carryOver)) : null);
}

export function renderShift(rerender) {
  const logs = Object.values(state.shiftLogs)
    .filter((l) => l && !l.deleted)
    .sort((a, b) => (a.date + a.shift < b.date + b.shift ? 1 : -1));

  const history = el('div.panel', {},
    el('header', {}, `Shift history (${logs.length})`),
    logs.length
      ? el('ul.list', {}, ...logs.slice(0, 40).map((l) => logCard(l, rerender)))
      : el('div.empty', {},
          el('h3', {}, 'No shift updates yet'),
          el('div', {}, 'Post the first one above — it becomes the handover the next shift sees.'))
  );

  return el('div', {}, composer(rerender), history);
}
