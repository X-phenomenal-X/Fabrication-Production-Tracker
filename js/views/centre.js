/* A work-centre page: Rolling, FOM, CNC or Multi Punch.

   One view, parameterised by centre — all four pages are this code with
   different data. Machines within a centre appear as sub-tabs, so an operator
   at FOM 2 sees only FOM 2's queue instead of scrolling past everything else.

   The queue is bucketed by cutting date, urgent first, because "what do I run
   now" is the question this page exists to answer. */

import {
  el, chip, icon, fmtDate, fmtNum, fmtWhen, toast, toastAction, modal, flash,
} from '../ui.js';
import {
  setTaskStatus, setTaskStatusMany, restoreTaskStatus, setTaskNote,
  setMachineConfig, setTaskFields, clearTaskEdits, historyFor,
  setTaskMachineMany,
  EDITABLE_FIELDS, state,
} from '../store.js';
import {
  groupedQueue, machineSummary, openCountFor, runningNow, taskStatusKey, hasTasks,
  shiftUpdateFor, taskNoteFor, machineConfig, resolveBackOrder, resolveRush,
  isAssigned, taskByKey,
  TRACK_STATUS_ORDER, TRACK_STATUS,
} from '../model.js';
import { backOrderDialog } from './backorders.js';
import { rushDialog } from './rush.js';
import {
  machinesByGroup, assignableIn, hasQueue, canMoveIn, MACHINE_BY_KEY,
} from '../machines.js';

/* Per-centre view state, kept while the app is open. */
const viewState = new Map();

function stateFor(group) {
  if (!viewState.has(group)) {
    viewState.set(group, {
      machine: null, q: '', showDone: false, filter: 'ALL',
      open: {}, expanded: {}, selected: new Set(), nowExpanded: {},
    });
  }
  return viewState.get(group);
}

const STATUS_ICON = { NOT_STARTED: 'dot', IN_PROGRESS: 'play', DONE: 'check' };

/* ---------- one line ---------- */

/* An explicit three-way control rather than a click-to-cycle chip. Cycling
   means a mis-tap silently advances a line, and going Done -> Not started
   takes three taps; with gloves on, neither is acceptable. */
function statusControl(row, vs, rerender) {
  const key = taskStatusKey(row.task);
  const cur = row.status.key;

  return el('div.seg', { role: 'group', 'aria-label': 'Status' },
    ...TRACK_STATUS_ORDER.map((k) => {
      const s = TRACK_STATUS[k];
      return el('button.seg-btn' + (k === cur ? '.on ' + s.tone : ''), {
        title: s.label,
        'aria-pressed': String(k === cur),
        onclick: (e) => {
          if (k === cur) return;
          const before = [{ key, prev: state.taskStatus[key]?.status ?? null }];
          setTaskStatus(key, k);
          flash(e.target.closest('.line'));
          toastAction(`${row.task.wo} → ${s.label}`, 'Undo', () => {
            restoreTaskStatus(before);
            rerender();
          });
          rerender();
        },
      }, icon(STATUS_ICON[k], { size: 14 }), el('span.seg-label', {}, s.label));
    }));
}

function noteEditor(row, rerender) {
  const key = taskStatusKey(row.task);
  const existing = taskNoteFor(key);
  const input = el('textarea', {
    value: existing?.text || '',
    placeholder: 'What is holding this up, what was short, anything the next shift needs…',
    style: { minHeight: '110px' },
  });

  modal(`Note — W/O ${row.task.wo}${row.task.die ? ' · ' + row.task.die : ''}`,
    el('div', {},
      el('p.small.muted', { style: { marginTop: 0 } },
        `${row.task.project || ''} ${row.task.floor || ''}`.trim() || 'No project on this line.'),
      input,
      existing ? el('div.small.muted', { style: { marginTop: '8px' } },
        `Last set by ${existing.by} · ${fmtWhen(existing.at)}`) : null),
    {
      actions: [
        existing ? {
          label: 'Clear', class: 'danger', onClick: (dlg) => {
            setTaskNote(key, '');
            dlg.close(); toast('Note cleared'); rerender();
          },
        } : null,
        {
          label: 'Save note', class: 'primary', onClick: (dlg) => {
            setTaskNote(key, input.value);
            dlg.close(); toast('Note saved'); rerender();
          },
        },
      ].filter(Boolean),
    });
}

function taskLine(row, vs, rerender, group) {
  const t = row.task;
  const key = taskStatusKey(t);
  const note = taskNoteFor(key);
  const bo = resolveBackOrder(t);
  const rush = row.rush || resolveRush(t);
  // boStat already surfaces inside the back-order band when flagged.
  const sheetNote = t.comments || (bo.on ? null : t.boStat);
  const selected = vs.selected.has(key);
  const canMove = canMoveIn(group);

  const node = el('div.line' + (selected ? '.sel' : '') + (rush.on ? '.rush' : ''), {},
    el('label.line-pick', {},
      el('input', {
        type: 'checkbox', checked: selected, 'aria-label': `Select ${t.wo}`,
        onchange: (e) => {
          if (e.target.checked) vs.selected.add(key); else vs.selected.delete(key);
          rerender();
        },
      })),

    el('div.line-main', {},
      el('div.line-id', {},
        el('span.mono.strong', {}, t.wo),
        t.die ? el('span.die' + (t.edited?.die ? '.edited' : ''), {}, t.die) : null,
        rush.on ? el('span.badge-rush' + (rush.late || rush.soon ? '.hot' : ''), {
          title: rush.needBy
            ? `Rush — needed by ${fmtDate(rush.needBy)}${rush.late ? ' (past)' : ''}`
            : 'Rush',
        }, icon('bolt', { size: 11 }),
          rush.needBy ? `RUSH ${fmtDate(rush.needBy)}` : 'RUSH') : null,
        bo.on ? el('span.badge-bo', {
          title: bo.qty != null ? `${bo.qty} pieces short` : 'Back order — short of material',
        }, icon('alert', { size: 11 }),
          bo.qty != null ? `B/O ${fmtNum(bo.qty)}` : 'B/O') : null,
        t.editedAt ? el('span.badge-edited', {
          title: `Edited by ${t.editedBy} · ${fmtWhen(t.editedAt)}`,
        }, 'edited') : null,
        // Without this a job that someone moved just appears on a machine the
        // workbook never put it on, and the machine it left cannot tell where
        // it went.
        isAssigned(t) ? el('span.badge-moved', {
          title: `Moved here by hand — the workbook has this on `
            + `${machineConfig(MACHINE_BY_KEY[t.machine] || { key: t.machine, label: t.machine }).label}`,
        }, icon('arrow', { size: 10 }),
          machineConfig(MACHINE_BY_KEY[t.machine] || { key: t.machine, label: t.machine }).label) : null),
      el('div.line-where', {},
        el('span', {}, t.project || '—'),
        t.floor ? el('span.muted', {}, ' · ' + t.floor) : null),
      sheetNote ? el('div.small.muted.line-note', {}, sheetNote) : null,
      rush.on && (rush.assignee || rush.reason) ? el('div.line-rushband', {},
        icon('bolt', { size: 12 }),
        el('span', {},
          rush.assignee ? el('strong', {}, rush.assignee) : null,
          rush.reason ? el('span', {}, `${rush.assignee ? ' — ' : ''}${rush.reason}`) : null)) : null,
      bo.on && (bo.assignee || bo.note || bo.qty != null || bo.sheetShort) ? el('div.line-boband', {},
        icon('alert', { size: 12 }),
        el('span', {},
          bo.qty != null ? el('strong', {}, `${fmtNum(bo.qty)} short`) : null,
          bo.assignee ? el('span', {}, `${bo.qty != null ? ' · ' : ''}${bo.assignee}`) : null,
          (bo.note || bo.sheetShort)
            ? el('span.muted', {}, `${bo.qty != null || bo.assignee ? ' — ' : ''}${bo.note || bo.sheetShort}`)
            : null)) : null,
      note ? el('div.line-usernote', {},
        icon('note', { size: 12 }),
        el('span', {}, note.text),
        el('span.muted', {}, ` — ${note.by}, ${fmtWhen(note.at)}`)) : null),

    el('div.line-qty', {},
      el('span.mono', {}, fmtNum(t.qty)),
      el('span.small.muted', {}, 'pcs')),

    el('div.line-date.hide-sm', {}, fmtDate(t.cuttingDate)),

    el('div.line-tools', {},
      canMove ? el('button.line-iconbtn' + (isAssigned(t) ? '.moved' : ''), {
        title: hasQueue(group) ? 'Put this line on a machine' : 'Move this line to another machine',
        onclick: () => moveDialog([key], group, rerender),
      }, icon('arrow', { size: 15 })) : null,
      el('button.line-iconbtn' + (rush.on ? '.rush' : ''), {
        title: rush.on ? 'Edit the rush' : 'Mark as rush',
        onclick: () => rushDialog(t, rerender),
      }, icon('bolt', { size: 15 })),
      el('button.line-iconbtn' + (note ? '.has' : ''), {
        title: note ? 'Edit note' : 'Add a note',
        onclick: () => noteEditor(row, rerender),
      }, icon('note', { size: 15 })),
      el('button.line-iconbtn' + (bo.on ? '.bo' : ''), {
        title: bo.on ? 'Edit back order' : 'Flag as back order',
        onclick: () => backOrderDialog(t, rerender),
      }, icon('alert', { size: 15 })),
      el('button.line-iconbtn', {
        title: 'Edit this line and see its history',
        onclick: () => editLine(row, rerender),
      }, icon('pencil', { size: 15 }))),

    el('div.line-status', {}, statusControl(row, vs, rerender)));

  return node;
}

/* ---------- put a line on a machine ---------- */

/* The CNC & FMC sheet is one flat list with no machine column, so its lines
   land in a shared queue and someone says which machine takes them. The line's
   key never changes, so moving it keeps its status, note, history and
   shortage — see setTaskMachine. */
function moveDialog(keys, group, rerender) {
  const targets = assignableIn(group).map(machineConfig);
  const first = taskByKey(keys[0]);
  const single = keys.length === 1 && first;

  // Where each line came from, per key — a mixed selection can span several
  // machines, so "put it back" cannot be one name.
  const originOf = (k) => taskByKey(k)?.machine || null;
  const imported = first?.machine || null;
  const origins = new Set(keys.map(originOf).filter(Boolean));
  const cur = single ? (state.taskAssign?.[keys[0]]?.machine || imported) : null;
  const moved = keys.some((k) => state.taskAssign?.[k]?.machine);

  const label = (k) => targets.find((m) => m.key === k)?.label
    || machineConfig(MACHINE_BY_KEY[k] || { key: k, label: k }).label;
  const queue = hasQueue(group);

  const title = single
    ? `Move W/O ${first.wo}${first.die ? ' · ' + first.die : ''}`
    : `Move ${keys.length} lines`;

  const go = (dlg, machine) => {
    setTaskMachineMany(keys, machine, machine ? imported : originOf);
    dlg.close();
    toast(machine ? `Moved to ${label(machine)}`
      : queue ? 'Back in the queue' : 'Put back where the sheet has it');
    rerender();
  };

  // The CNC & FMC sheet genuinely does not say which machine runs a line; the
  // FOM and Rolling sheets do, and moving one is an override of that.
  const blurb = queue
    ? 'The workbook does not say which machine these run on — that is decided here.'
    : origins.size === 1 && imported
      ? `The workbook has ${single ? 'this' : 'these'} on ${label(imported)}. Moving `
        + `${single ? 'it' : 'them'} here overrides that until you put ${single ? 'it' : 'them'} back.`
      : 'These came off more than one machine. Moving them overrides what the workbook says.';

  const body = el('div', {},
    el('p.small.muted', { style: { marginTop: 0 } },
      blurb + ' The line keeps its status, note, history, rush and back order, '
      + 'and the move survives re-importing the workbook.'),
    el('div.movegrid', {}, ...targets.map((m) => el('button.movebtn' + (m.key === cur ? '.on' : ''), {
      onclick: (e) => go(e.target.closest('dialog'), m.key),
    },
      el('strong', {}, m.label),
      m.note ? el('span.small.muted', {}, m.note) : null,
      m.key === cur ? el('span.small.muted', {}, 'currently here') : null))),

    moved ? el('div', { style: { marginTop: '12px' } },
      el('button.ghost', {
        onclick: (e) => go(e.target.closest('dialog'), null),
      }, icon('undo', { size: 13 }),
        queue ? ' Send back to the unassigned queue'
          : origins.size === 1 && imported
            ? ` Put back on ${label(imported)}, where the sheet has it`
            : ' Put each one back where the sheet has it')) : null);

  modal(title, body, {});
}

/* ---------- edit a line ---------- */

const HISTORY_LABEL = { status: 'Status', note: 'Note', field: 'Edited', undo: 'Undone' };

function historyList(key) {
  const rows = historyFor(key);
  if (!rows.length) {
    return el('div.small.muted', {},
      'No changes recorded yet. Everything done here is logged with who and when.');
  }
  const shown = (v) => {
    if (v == null || v === '') return '—';
    return TRACK_STATUS[v]?.label || String(v);
  };
  return el('ul.hist', {}, ...rows.slice(0, 60).map((h) => el('li', {},
    el('div.hist-row', {},
      el('span.hist-kind', {}, HISTORY_LABEL[h.kind] || h.kind),
      h.field ? el('span.hist-field', {}, h.field) : null,
      el('span.hist-change', {},
        el('span.muted', {}, shown(h.from)), ' → ', el('strong', {}, shown(h.to))),
      el('span.spacer'),
      el('span.hist-who', {}, `${h.by} · ${fmtWhen(h.at)}`)))));
}

function editLine(row, rerender) {
  const t = row.task;
  const key = taskStatusKey(t);
  const sheet = t.origin || t;

  const inputs = {};
  const fields = EDITABLE_FIELDS.map((f) => {
    const val = t[f.key] ?? '';
    const input = el('input', {
      type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text',
      value: val === null ? '' : String(val),
      ...(f.type === 'number' ? { min: '0', inputmode: 'decimal' } : {}),
    });
    inputs[f.key] = input;
    const differs = t.edited?.[f.key];
    return el('label.field.editfield', {},
      el('span', {}, f.label,
        differs ? el('em.edited-tag', { title: `Workbook says: ${sheet[f.key] ?? '—'}` },
          `edited · sheet: ${sheet[f.key] ?? '—'}`) : null),
      input);
  });

  const body = el('div', {},
    el('div.edithead', {},
      el('span.mono.strong', {}, `W/O ${t.wo}`),
      el('span.small.muted', {}, 'The work order cannot be changed — it identifies the line.')),
    el('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '12px' } },
      ...fields),
    t.editedAt ? el('div.small.muted', { style: { marginTop: '10px' } },
      `Last edited by ${t.editedBy} · ${fmtWhen(t.editedAt)}`) : null,
    el('h4.hist-title', {}, 'History'),
    historyList(key));

  modal(`Edit line — ${t.wo}${sheet.die ? ' · ' + sheet.die : ''}`, body, {
    wide: true,
    actions: [
      t.edited && Object.keys(t.edited).length ? {
        label: 'Revert to workbook', onClick: (dlg) => {
          clearTaskEdits(key, sheet);
          dlg.close(); toast('Reverted to what the workbook says'); rerender();
        },
      } : null,
      {
        label: 'Save changes', class: 'primary', onClick: (dlg) => {
          const patch = {};
          for (const f of EDITABLE_FIELDS) {
            const raw = inputs[f.key].value.trim();
            patch[f.key] = raw === '' ? null : (f.type === 'number' ? Number(raw) : raw);
          }
          setTaskFields(key, patch, sheet);
          dlg.close(); toast('Saved'); rerender();
        },
      },
    ].filter(Boolean),
  });
}

/* ---------- date groups ---------- */

function dateGroup(group, vs, rerender, centre) {
  const isOpen = vs.open[group.key] ?? group.open;
  const expanded = vs.expanded[group.key];
  const cap = group.cap && !expanded ? group.cap : Infinity;
  const shown = group.rows.slice(0, cap);
  const hidden = group.rows.length - shown.length;
  const allKeys = group.rows.map((r) => taskStatusKey(r.task));
  const allPicked = allKeys.length && allKeys.every((k) => vs.selected.has(k));

  return el('section.dgroup', {},
    el('div.dgroup-head', {},
      el('button.dgroup-toggle', {
        'aria-expanded': String(isOpen),
        onclick: () => { vs.open[group.key] = !isOpen; rerender(); },
      },
        el('span.dgroup-caret' + (isOpen ? '.open' : ''), {}, icon('chevron', { size: 13 })),
        el('span.dgroup-label.' + group.tone, {}, group.label),
        el('span.dgroup-count', {}, String(group.rows.length))),
      el('span.spacer'),
      isOpen ? el('button.dgroup-pick', {
        onclick: () => {
          if (allPicked) allKeys.forEach((k) => vs.selected.delete(k));
          else allKeys.forEach((k) => vs.selected.add(k));
          rerender();
        },
      }, allPicked ? 'Clear' : 'Select all') : null),

    isOpen ? el('div.dgroup-body', {},
      ...shown.map((r) => taskLine(r, vs, rerender, centre)),
      hidden > 0 ? el('button.sm.showmore', {
        onclick: () => { vs.expanded[group.key] = true; rerender(); },
      }, `Show ${hidden} more`) : null) : null);
}

/* ---------- running now ---------- */

/* What is this machine actually doing right now — the first thing anyone
   switching to a machine's tab wants to know, so it sits at the very top of
   the page rather than wherever it happens to fall in the date-grouped
   queue below. */
function nowRunningLine(row, rerender) {
  const t = row.task;
  const key = taskStatusKey(t);
  const since = row.status.at ? fmtWhen(row.status.at) : null;

  return el('div.nowrun-line', {},
    el('div.nowrun-main', {},
      el('div.line-id', {},
        el('span.mono.strong', {}, t.wo),
        t.die ? el('span.die', {}, t.die) : null,
        row.rush.on ? chip('rush', 'warn') : null),
      el('div.line-where', {},
        el('span', {}, t.project || '—'),
        t.floor ? el('span.muted', {}, ' · ' + t.floor) : null)),
    el('div.nowrun-meta', {},
      el('span.mono', {}, fmtNum(t.qty)),
      el('span.small.muted', {}, 'pcs'),
      since ? el('span.small.muted.nowrun-since', {}, `since ${since}`) : null),
    el('button.nowrun-done', {
      title: 'Mark this line done',
      onclick: (e) => {
        const before = [{ key, prev: state.taskStatus[key]?.status ?? null }];
        setTaskStatus(key, 'DONE');
        flash(e.target.closest('.nowrun-line'));
        toastAction(`${t.wo} → Done`, 'Undo', () => {
          restoreTaskStatus(before);
          rerender();
        });
        rerender();
      },
    }, icon('check', { size: 13 }), 'Done'));
}

/* A machine's whole open book can sit "In Progress" for days on the busier
   centres — Rolling (Auto) alone runs 60+ at once — so this caps to a
   glanceable handful (already rush-first, soonest-date-first) with a Show
   more, the same pattern the date groups below use for the same reason. */
const NOWRUN_CAP = 6;

function nowRunningPanel(machine, rerender, vs) {
  const rows = runningNow(machine.key);

  if (!rows.length) {
    return el('div.nowrun', {},
      el('div.nowrun-empty', {},
        icon('dot', { size: 12 }),
        el('span', {}, 'Nothing running on ' + machine.label + ' right now')));
  }

  const expanded = vs.nowExpanded[machine.key];
  const shown = expanded ? rows : rows.slice(0, NOWRUN_CAP);
  const hidden = rows.length - shown.length;

  return el('div.nowrun.active', {},
    el('div.nowrun-head', {},
      icon('play', { size: 12 }),
      el('span', {}, `Running now on ${machine.label}`),
      el('span.nowrun-count', {}, String(rows.length))),
    el('div.nowrun-body', {},
      ...shown.map((r) => nowRunningLine(r, rerender)),
      hidden > 0 ? el('button.sm.showmore', {
        onclick: () => { vs.nowExpanded[machine.key] = true; rerender(); },
      }, `Show ${hidden} more`) : null));
}

/* ---------- shift update ---------- */

function shiftUpdatePanel(machineKey) {
  const su = shiftUpdateFor(machineKey);
  if (!su) return null;
  if (!(su.done.length || su.next.length || su.notes.length || su.down)) return null;

  const list = (label, items) => items.length
    ? el('div.su-col', {},
        el('div.su-label', {}, label),
        el('ul.su-list', {}, ...items.map((t) => el('li', {}, t))))
    : null;

  return el('div.su' + (su.down ? '.down' : ''), {},
    el('div.su-head', {},
      el('span.su-title', {}, 'Latest shift update'),
      su.date ? chip(`${su.shift || ''} ${fmtDate(su.date)}`.trim(), 'mute') : null,
      su.down ? el('span.badge-down', {}, icon('alert', { size: 12 }), 'Machine down') : null,
      el('span.spacer'),
      su.ops != null ? el('span.small.muted', {}, `${su.ops} operator${su.ops === 1 ? '' : 's'}`) : null),
    el('div.su-body', {},
      list('Work done / in progress', su.done),
      list('Next in schedule', su.next),
      list('Notes', su.notes)));
}

/* ---------- machine settings ---------- */

function machineSettings(machine, rerender) {
  const cfg = state.machineConfig?.[machine.key] || {};
  const label = el('input', { value: cfg.label || '', placeholder: machine.label });
  const note = el('input', {
    value: cfg.note !== undefined ? (cfg.note || '') : (machine.note || ''),
    placeholder: 'What this machine runs',
  });
  const ops = el('input', {
    type: 'number', min: '0', inputmode: 'numeric',
    value: cfg.ops ?? '', placeholder: machine.ops == null ? '' : String(machine.ops),
  });

  modal(`Set up ${machine.label}`,
    el('div', {},
      el('p.small.muted', { style: { marginTop: 0 } },
        'Rename this machine, change what it runs, or set the usual crew. ' +
        'These are the department\'s own settings and are shared with everyone on the same file.'),
      el('label.field', { style: { marginBottom: '12px' } }, el('span', {}, 'Display name'), label),
      el('label.field', { style: { marginBottom: '12px' } }, el('span', {}, 'What it runs'), note),
      el('label.field', {}, el('span', {}, 'Usual operators'), ops)),
    {
      actions: [
        {
          label: 'Reset', onClick: (dlg) => {
            delete state.machineConfig[machine.key];
            setMachineConfig(machine.key, {});
            delete state.machineConfig[machine.key];
            dlg.close(); toast('Reset to defaults'); rerender();
          },
        },
        {
          label: 'Save', class: 'primary', onClick: (dlg) => {
            setMachineConfig(machine.key, {
              label: label.value.trim() || null,
              note: note.value.trim(),
              ops: ops.value === '' ? null : Number(ops.value),
            });
            dlg.close(); toast('Saved'); rerender();
          },
        },
      ],
    });
}

/* ---------- bulk bar ---------- */

function bulkBar(vs, rerender, group) {
  const keys = Array.from(vs.selected);
  if (!keys.length) return null;

  const apply = (statusKey) => {
    const before = setTaskStatusMany(keys, statusKey);
    const n = keys.length;
    vs.selected.clear();
    toastAction(`${n} line${n === 1 ? '' : 's'} → ${TRACK_STATUS[statusKey].label}`, 'Undo', () => {
      restoreTaskStatus(before);
      rerender();
    });
    rerender();
  };

  const canMove = canMoveIn(group);

  return el('div.bulkbar', { role: 'status' },
    el('span.bulk-count', {}, `${keys.length} selected`),
    el('span.spacer'),
    ...TRACK_STATUS_ORDER.map((k) => el('button.bulk-btn', {
      onclick: () => apply(k),
    }, icon(STATUS_ICON[k], { size: 14 }), TRACK_STATUS[k].label)),
    canMove ? el('button.bulk-btn', {
      onclick: () => moveDialog(keys, group, () => { vs.selected.clear(); rerender(); }),
    }, icon('arrow', { size: 14 }), 'Move to') : null,
    el('button.bulk-x', {
      title: 'Clear selection',
      onclick: () => { vs.selected.clear(); rerender(); },
    }, icon('x', { size: 15 })));
}

/* ---------- page ---------- */

const FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'NOT_STARTED', label: 'Not started' },
  { key: 'IN_PROGRESS', label: 'Running' },
  { key: 'RUSH', label: 'Rush' },
  { key: 'BO', label: 'Back order' },
];

export function makeCentreView(group) {
  return function renderCentre(rerender, go) {
    if (!hasTasks()) {
      return el('div.panel', {},
        el('div.empty', {},
          el('div.empty-icon', {}, icon('upload', { size: 28 })),
          el('h3', {}, 'No schedule loaded yet'),
          el('p', {}, 'Import the Rolling and CNC workbooks to get started.'),
          el('button.primary', { onclick: () => go('setup') }, 'Go to Setup')));
    }

    const machines = (machinesByGroup().get(group) || []).map(machineConfig);
    const vs = stateFor(group);
    if (!vs.machine || !machines.some((m) => m.key === vs.machine)) {
      vs.machine = machines[0]?.key || null;
    }
    const machine = machines.find((m) => m.key === vs.machine);
    if (!machine) return el('div.panel', {}, el('div.empty', {}, 'No machines in this centre.'));

    const sum = machineSummary(machine.key);
    const groups = groupedQueue(machine.key, {
      showDone: vs.showDone, q: vs.q, filter: vs.filter,
    });
    const donePct = sum.total ? Math.round((sum.done / sum.total) * 100) : 0;

    const tabs = machines.length > 1
      ? el('div.subtabs', {}, ...machines.map((m) => el('button', {
          'aria-current': String(m.key === vs.machine),
          onclick: () => { vs.machine = m.key; vs.selected.clear(); rerender(); },
        },
          m.label,
          el('span.subtab-count', {}, String(openCountFor(m.key))))))
      : null;

    const stat = (n, label, tone) => el('div.cstat' + (tone && n ? '.' + tone : ''), {},
      el('b', {}, fmtNum(n)), el('i', {}, label));

    const head = el('div.centre-head', {},
      el('div.row.centre-title-row', {},
        el('div', {},
          el('div.row', { style: { gap: '8px' } },
            el('h1.centre-title', {}, machine.label),
            el('button.iconbtn', {
              title: 'Set up this machine',
              onclick: () => machineSettings(machine, rerender),
            }, icon('gear', { size: 15 }))),
          el('div.small.muted', {},
            machine.note || '',
            machine.ops != null ? `${machine.note ? ' · ' : ''}${machine.ops} operator${machine.ops === 1 ? '' : 's'}` : '')),
        el('span.spacer'),
        el('div.centre-stats', {},
          stat(sum.open, 'open'),
          stat(sum.inProgress, 'running', 'work'),
          stat(sum.rush, 'rush', 'warn'),
          stat(sum.overdue, 'overdue', 'bad'),
          stat(sum.backOrder, 'B/O', 'bad'))),

      // How much of this machine's book is finished — the one number that
      // says whether the queue is shrinking.
      el('div.progress', { title: `${sum.done} of ${sum.total} lines done` },
        el('i', { style: { width: donePct + '%' } })),
      el('div.progress-cap', {}, `${donePct}% of ${fmtNum(sum.total)} lines done`),

      tabs,

      el('div.centre-filters', {},
        el('div.searchwrap', {},
          icon('search', { size: 15, cls: 'searchicon' }),
          el('input', {
            type: 'search', placeholder: 'Search W/O, project, die, note…', value: vs.q,
            oninput: (e) => {
              vs.q = e.target.value;
              clearTimeout(head._t);
              head._t = setTimeout(rerender, 150);
            },
          })),
        el('div.filterpills', {}, ...FILTERS.map((f) => el('button.pill', {
          'aria-current': String(vs.filter === f.key),
          onclick: () => { vs.filter = f.key; rerender(); },
        }, f.label))),
        el('span.spacer'),
        el('label.row.small.donetoggle', {},
          el('input', {
            type: 'checkbox', checked: vs.showDone,
            onchange: (e) => { vs.showDone = e.target.checked; rerender(); },
          }),
          `Show done${sum.done ? ` (${fmtNum(sum.done)})` : ''}`)));

    const body = groups.length
      ? el('div', {}, ...groups.map((g) => dateGroup(g, vs, rerender, group)))
      : el('div.panel', {}, el('div.empty', {},
          el('div.empty-icon', {}, icon('check', { size: 28 })),
          el('h3', {}, vs.q || vs.filter !== 'ALL' ? 'Nothing matches' : 'All clear'),
          el('div', {}, vs.q || vs.filter !== 'ALL'
            ? 'Try clearing the search or the filter.'
            : 'Nothing outstanding on this machine.')));

    return el('div.centre', {},
      head,
      nowRunningPanel(machine, rerender, vs),
      shiftUpdatePanel(machine.key),
      body,
      bulkBar(vs, rerender, group));
  };
}
