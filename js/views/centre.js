/* A work-centre page: Rolling, FOM, CNC or Multi Punch.

   One view, parameterised by centre — all four pages are this code with
   different data. Machines within a centre appear as sub-tabs, so an operator
   at FOM 2 sees only FOM 2's queue instead of scrolling past everything else.

   The queue is bucketed by cutting date, urgent first, because "what do I run
   now" is the question this page exists to answer. */

import {
  el, chip, icon, fmtDate, fmtNum, fmtWhen, toast, toastAction, modal, flash,
  printDocument,
} from '../ui.js';
import {
  setTaskStatus, setTaskStatusMany, restoreTaskStatus, setTaskNote,
  setMachineConfig, resetMachineConfig, setTaskFields, clearTaskEdits, historyFor,
  setTaskMachineMany, setTaskMachine,
  EDITABLE_FIELDS, state,
} from '../store.js';
import {
  groupedQueue, machineSummary, openCountFor, runningNow, taskStatusKey, hasTasks,
  shiftUpdateFor, taskNoteFor, machineConfig, resolveBackOrder, resolveRush,
  isAssigned, taskByKey, staleImports, shiftUpdateAge, manualIdFor,
  suggestedMachine, suggestionsIn, isStaged,
  assignedMachine, effectiveTaskStatus, TRACK_STATUS_ORDER, TRACK_STATUS, dateGroupOf,
  daysLate, isParked, parkedFor,
} from '../model.js';
import { backOrderDialog } from './backorders.js';
import { jobDialog } from './job.js';
import { parkDialog, bulkParkDialog, bulkUnpark } from './park.js';
import { manualJobDialog } from './manual.js';
import { dieDialog } from './die-launcher.js';
import { rushDialog } from './rush.js';
import { routeDialog } from './routing.js';
import { haveDrawings, loadDrawings, thumbFor } from './die-thumb.js';
import {
  machinesByGroup, assignableIn, hasQueue, canMoveIn, MACHINE_BY_KEY,
} from '../machines.js';

/* Per-centre view state, kept while the app is open. */
const viewState = new Map();

function stateFor(group) {
  if (!viewState.has(group)) {
    viewState.set(group, {
      machine: null, q: '', showDone: false, filter: 'ALL',
      open: {}, expanded: {}, selected: new Set(), nowExpanded: {}, active: undefined,
      motion: null, motionTimer: null,
    });
  }
  return viewState.get(group);
}

/* A cover-page work order opens exactly where it can be acted on: the right
   centre, the right machine, filtered to the stable work order and already
   selected in the inspector. This is transient view state, not another
   overlay on the imported line. */
export function focusCentreTask(task) {
  const machineKey = assignedMachine(task);
  const machine = MACHINE_BY_KEY[machineKey];
  if (!machine?.group) return null;
  const vs = stateFor(machine.group);
  vs.machine = machineKey;
  vs.q = String(task.wo || '');
  vs.filter = 'ALL';
  /* Finished lines are hidden by default, which is right for working a queue
     and wrong for being sent to one specific line: following a link to a line
     that turns out to be done should show it, not an empty page with a search
     term in the box and no explanation. */
  vs.showDone = effectiveTaskStatus(task).key === 'DONE';
  vs.selected.clear();
  vs.active = taskStatusKey(task);
  /* Open the date group the line sits in and lift its row cap. "No date" and
     "Later" are folded shut by default and every group stops at 25 rows, both
     of which are right when you are working a queue and wrong when you have
     been sent to one specific line — the page would render the group header
     and nothing else, with the work order sitting in the search box. */
  const groupKey = dateGroupOf(task);
  vs.open[groupKey] = true;
  vs.expanded[groupKey] = true;
  return { Rolling: 'rolling', FOM: 'fom', CNC: 'cnc', Punch: 'punch' }[machine.group] || null;
}

const STATUS_ICON = { NOT_STARTED: 'dot', IN_PROGRESS: 'play', DONE: 'check' };

/* ---------- one line ---------- */

/* An explicit three-way control rather than a click-to-cycle chip. Cycling
   means a mis-tap silently advances a line, and going Done -> Not started
   takes three taps; with gloves on, neither is acceptable. */
function statusControl(row, vs, rerender) {
  const key = taskStatusKey(row.task);
  const cur = row.status.key;

  return el('div.seg' + (row.status.implied ? '.implied' : ''), {
    role: 'group',
    /* Said in the accessible name too, not only in the badge beside it —
       otherwise a screen reader hears "Done, pressed" with no hint that
       nobody actually pressed it. */
    'aria-label': row.status.implied
      ? `Status — ${row.status.label}, worked out from a later station`
      : 'Status',
  },
    ...TRACK_STATUS_ORDER.map((k) => {
      const s = TRACK_STATUS[k];
      const confirming = vs.motion?.type === 'status'
        && vs.motion.key === key && vs.motion.status === k;
      return el('button.seg-btn' + (k === cur ? '.on ' + s.tone : '')
        + (confirming ? '.status-confirm' : ''), {
        title: s.label,
        'aria-pressed': String(k === cur),
        onclick: (e) => {
          if (k === cur) return;
          const before = [{ key, prev: state.taskStatus[key]?.status ?? null }];
          markMotion(vs, { type: 'status', key, status: k });
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
  const active = vs.active === key;
  const opening = vs.motion?.type === 'select' && vs.motion.key === key;
  const statusChanged = vs.motion?.type === 'status' && vs.motion.key === key;
  const canMove = canMoveIn(group);
  const suggestion = canMove ? suggestedMachine(t) : null;

  // The rail down the left edge is picked in CSS by priority; the row only has
  // to say which states apply.
  const node = el('div.line'
    + (selected ? '.sel' : '')
    + (active ? '.active' : '')
    + (opening ? '.line-opening' : '')
    + (statusChanged ? '.status-changed' : '')
    + (rush.on ? '.rush' : '')
    + (bo.on ? '.is-bo' : '')
    + (t.editedAt ? '.is-edited' : ''), {
      onclick: (e) => {
        if (e.target.closest('button, input, label, select, textarea, a')) return;
        vs.active = key;
        markMotion(vs, { type: 'select', key });
        rerender();
      },
    },
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
        // The die is a rolled sub-assembly, not one extrusion. Tapping it says
        // what it is made of — which is what staging has to pull.
        t.die ? el('button.die.dielink' + (t.edited?.die ? '.edited' : ''), {
          title: `What is ${t.die} made of?`,
          onclick: (e) => { e.stopPropagation(); dieDialog(t.die); },
        }, t.die) : null,
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
        /* Only ever seen through the Parked filter, since a parked line is out
           of every other view — but seen there it has to say what it is, or
           the filter looks like an ordinary queue. */
        isParked(t) ? el('span.badge-parked', {
          title: parkedFor(taskStatusKey(t))?.reason || 'Parked — not going to run',
        }, icon('square', { size: 11 }), 'PARKED') : null,
        t.editedAt ? el('span.badge-edited', {
          title: `Edited by ${t.editedBy} · ${fmtWhen(t.editedAt)}`,
        }, 'edited') : null,
        // Not in either workbook. Worth saying on the row, because it changes
        // what a re-import will and will not bring up to date.
        t.manual ? el('span.badge-manual', {
          title: `Added by hand by ${t.by} · ${fmtWhen(t.at)} — not in the workbook`,
        }, icon('pencil', { size: 10 }), 'added here') : null,
        // Prepped and waiting. The roller wants to know this before starting,
        // and the stager wants to see that it registered.
        isStaged(t) ? el('span.badge-staged', {
          title: 'Staged and ready for rolling',
        }, icon('check', { size: 10 }), 'staged') : null,
        /* Nobody pressed Done on this line — a later station finished it and
           this row is stale. Said outright rather than shown as a plain Done,
           because "Done" with no name against it should mean somebody looked
           at the material, and here nobody did. */
        row.status.implied ? el('span.badge-implied', {
          title: `Not marked here — ${row.status.impliedWhy}, at `
            + `${machineConfig(MACHINE_BY_KEY[row.status.impliedFrom]
              || { label: row.status.impliedFrom }).label}. `
            + 'Set it by hand to overrule this.',
        }, icon('arrow', { size: 10 }),
          `from ${machineConfig(MACHINE_BY_KEY[row.status.impliedFrom]
            || { label: row.status.impliedFrom }).label}`) : null,
        // What this component usually gets put on. Offered, never applied on
        // its own: routing a line to the wrong machine is a real cost, and the
        // person reading the row is the one who knows whether this time is
        // different.
        // A rule and a habit are not the same claim, so they do not wear the
        // same badge: the SOP says where this goes, the counts say where it
        // has been going. Both are still offered rather than applied.
        suggestion ? el('button.badge-route' + (suggestion.sop ? '.sop' : ''), {
          title: suggestion.sop
            ? `${suggestion.rule} Click to put this one on `
              + `${machineConfig(MACHINE_BY_KEY[suggestion.machine]).label}.`
            : `${suggestion.die} has been put on `
              + `${machineConfig(MACHINE_BY_KEY[suggestion.machine]).label} `
              + `${suggestion.seen} of ${suggestion.total} times. Click to put this one there.`,
          onclick: (e) => {
            e.stopPropagation();
            setTaskMachine(key, suggestion.machine, t.machine);
            toast(`${t.wo} → ${machineConfig(MACHINE_BY_KEY[suggestion.machine]).label}`);
            rerender();
          },
        }, icon('arrow', { size: 10 }),
          suggestion.sop
            ? `SOP: ${machineConfig(MACHINE_BY_KEY[suggestion.machine]).label}`
            : `usually ${machineConfig(MACHINE_BY_KEY[suggestion.machine]).label}`) : null,
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

    /* The date, and how far past it. A band tells you which pile a line is in;
       it cannot tell 15 days apart from 270, and on this schedule both are in
       the same pile. The number is what decides whether a line gets chased or
       written off. */
    el('div.line-date.hide-sm', {}, fmtDate(t.cuttingDate),
      (() => {
        const late = daysLate(t);
        return late > 0
          ? el('span.line-late' + (late > 60 ? '.cold' : ''), {
            title: `${late} days past its cutting date`,
          }, `+${late}d`)
          : null;
      })()),

    el('button.line-open', {
      'aria-label': `Open details for ${t.wo}`,
      title: 'Open line details',
      onclick: () => {
        vs.active = key;
        markMotion(vs, { type: 'select', key });
        rerender();
      },
    }, icon('chevron', { size: 15 })),

    el('div.line-tools', {},
      canMove ? el('button.line-iconbtn' + (isAssigned(t) ? '.moved' : ''), {
        title: hasQueue(group) ? 'Put this line on a machine' : 'Move this line to another machine',
        onclick: () => moveDialog([key], group, rerender),
      }, icon('arrow', { size: 15 })) : null,
      // Where it goes after here, and what paperwork has to go with it.
      el('button.line-iconbtn', {
        title: 'Where this goes next, and the paperwork it needs',
        onclick: () => routeDialog(t),
      }, icon('list', { size: 15 })),
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
      el('button.line-iconbtn' + (t.manual ? '.manual' : ''), {
        title: t.manual
          ? 'Edit this job — it was added by hand'
          : 'Edit this line and see its history',
        // A manual job has no workbook row behind it, so it is edited at the
        // source rather than through an overlay on a sheet that has no entry.
        onclick: () => (t.manual
          ? manualJobDialog({ machine: t.machine, task: t, rerender })
          : editLine(row, rerender)),
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

  const learned = single ? suggestedMachine(first) : null;

  const body = el('div', {},
    el('p.small.muted', { style: { marginTop: 0 } },
      blurb + ' The line keeps its status, note, history, rush and back order, '
      + 'and the move survives re-importing the workbook.'),
    learned ? el('div.routehint', {},
      icon('arrow', { size: 14 }),
      el('span', {}, el('strong', {}, learned.die), ' has been put on ',
        el('strong', {}, label(learned.machine)),
        ` ${learned.seen} of ${learned.total} time${learned.total === 1 ? '' : 's'} before.`)) : null,
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

/* A render rebuilds the current view, so motion markers must expire instead
   of replaying when a cloud update or later filter change redraws the page. */
function markMotion(vs, motion) {
  const token = `${Date.now()}-${Math.random()}`;
  vs.motion = { ...motion, token };
  clearTimeout(vs.motionTimer);
  vs.motionTimer = setTimeout(() => {
    if (vs.motion?.token === token) vs.motion = null;
  }, 360);
}

function historyDialog(task) {
  const key = taskStatusKey(task);
  modal(`History — W/O ${task.wo}${task.die ? ' · ' + task.die : ''}`,
    el('div', {},
      el('p.small.muted', { style: { marginTop: 0 } },
        `${task.project || 'No project'}${task.floor ? ' · ' + task.floor : ''}`),
      historyList(key)),
    { wide: true });
}

/* Option 2's right rail is a working inspector, not a duplicate detail card.
   It keeps the selected line, its exceptions and the three status choices in
   one stable place while the queue continues to scroll independently. */
function lineInspector(row, vs, rerender, group) {
  if (!row) return null;
  const t = row.task;
  const key = taskStatusKey(t);
  const note = taskNoteFor(key);
  const bo = resolveBackOrder(t);
  const rush = row.rush || resolveRush(t);
  const canMove = canMoveIn(group);
  const park = parkedFor(key);
  const parked = !!park?.on;
  const updates = [row.status?.at, note?.at, bo.at, rush.at, park?.at, t.editedAt].filter(Boolean).sort();
  const last = updates.at(-1);
  const opening = vs.motion?.type === 'select' && vs.motion.key === key;

  const detail = (label, value, cls = '') => value != null && value !== ''
    ? el('div.inspector-detail' + (cls ? '.' + cls : ''), {},
        el('dt', {}, label), el('dd', {}, value))
    : null;

  const action = (label, iconName, onclick, cls = '') => el('button.inspector-action' + (cls ? '.' + cls : ''), {
    onclick,
  }, icon(iconName, { size: 16 }), el('span', {}, label));

  const closeInspector = (e) => {
    const finish = () => { vs.active = null; rerender(); };
    const panel = e.currentTarget.closest('.line-inspector');
    if (!panel?.animate || (typeof matchMedia === 'function'
        && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      finish();
      return;
    }
    panel.animate(
      [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(12px)' }],
      { duration: 140, easing: 'cubic-bezier(.4,0,1,1)' },
    ).finished.then(finish, finish);
  };

  return el('aside.line-inspector' + (opening ? '.opening' : ''), {
    'aria-label': `Selected line ${t.wo}`,
  },
    el('div.inspector-head', {},
      el('div', {},
        el('span.inspector-eyebrow', {}, 'Selected line'),
        el('h2', {}, `W/O ${t.wo}`)),
      el('button.iconbtn', {
        'aria-label': 'Close line details',
        title: 'Close line details',
        onclick: closeInspector,
      }, icon('x', { size: 17 }))),

    el('div.inspector-status', {}, statusControl(row, vs, rerender)),

    el('dl.inspector-details', {},
      detail('Project', t.project || '—'),
      detail('Floor / area', t.floor || '—'),
      detail('Die', t.die
        ? el('button.die.dielink', { onclick: () => dieDialog(t.die) }, t.die)
        : '—'),
      detail('Quantity', `${fmtNum(t.qty)} pcs`),
      detail('Needed', fmtDate(t.cuttingDate), t.cuttingDate && t.cuttingDate < new Date().toISOString().slice(0, 10) ? 'bad' : ''),
      detail('Machine', machineConfig(MACHINE_BY_KEY[assignedMachine(t)]
        || { key: assignedMachine(t), label: assignedMachine(t) }).label),
      rush.on ? detail('Priority', rush.needBy ? `Rush · ${fmtDate(rush.needBy)}` : 'Rush', 'warn') : null,
      bo.on ? detail('Material', bo.qty != null ? `${fmtNum(bo.qty)} pcs short` : 'Back order', 'bad') : null,
      last ? detail('Last update', `${fmtWhen(last)}${row.status?.by ? ` · ${row.status.by}` : ''}`) : null),

    rush.on || bo.on || note
      ? el('section.inspector-context', {},
          el('h3', {}, 'Related context'),
          rush.on ? el('div.inspector-context-row.warn', {},
            icon('bolt', { size: 14 }),
            el('div', {}, el('strong', {}, rush.assignee || 'Rush'),
              rush.reason ? el('span', {}, rush.reason) : null)) : null,
          bo.on ? el('div.inspector-context-row.bad', {},
            icon('alert', { size: 14 }),
            el('div', {}, el('strong', {}, bo.assignee || 'Back order'),
              el('span', {}, bo.note || bo.sheetShort || 'Short of material'))) : null,
          note ? el('div.inspector-context-row', {},
            icon('note', { size: 14 }),
            el('div', {}, el('strong', {}, `${note.by} · ${fmtWhen(note.at)}`),
              el('span', {}, note.text))) : null)
      : el('section.inspector-context.empty-context', {},
          el('h3', {}, 'Related context'),
          el('p', {}, 'No rush, shortage or note on this line.')),

    el('div.inspector-actions', {},
      action(t.manual ? 'Edit job' : 'Edit', 'pencil', () => (t.manual
        ? manualJobDialog({ machine: t.machine, task: t, rerender })
        : editLine(row, rerender))),
      action(note ? 'Edit note' : 'Note', 'note', () => noteEditor(row, rerender), note ? 'on' : ''),
      canMove ? action(hasQueue(group) ? 'Assign' : 'Move', 'arrow', () => moveDialog([key], group, rerender)) : null,
      /* Where the rest of this work order has got to. Next to Route on
         purpose: Route is where it should go, Job is where it is. */
      action('Job', 'job', () => jobDialog(t)),
      action('Route', 'list', () => routeDialog(t)),
      action('Rush', 'bolt', () => rushDialog(t, rerender), rush.on ? 'warn' : ''),
      action('Back order', 'alert', () => backOrderDialog(t, rerender), bo.on ? 'bad' : ''),
      action(parked ? 'Parked' : 'Park', 'square', () => parkDialog(t, rerender), parked ? 'on' : ''),
      action('History', 'clock', () => historyDialog(t))),
  );
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
        onclick: () => {
          vs.open[group.key] = !isOpen;
          if (!isOpen) markMotion(vs, { type: 'group', key: group.key });
          rerender();
        },
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

    isOpen ? el('div.dgroup-body'
      + (vs.motion?.type === 'group' && vs.motion.key === group.key ? '.revealing' : ''), {},
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

  /* The section through the bar this machine is cutting. Free once the library
     is in memory; before that it is a button, because fetching 3.8 MB is the
     operator's call and not something a page visit does to them. */
  const dwg = t.die ? thumbFor(t.die) : null;
  const profile = !t.die ? null
    : dwg ? el('div.nowrun-thumb', {},
        el('img', { src: dwg.src, alt: `Section through ${t.die}`, loading: 'lazy' }))
    : haveDrawings() ? null
    : el('button.nowrun-profile', {
        title: 'Show the section through this die. Downloads the drawing '
          + 'library once, then every line shows its profile.',
        onclick: () => loadDrawings(rerender),
      }, icon('search', { size: 12 }), 'Profile');

  return el('div.nowrun-line', {},
    profile,
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
      /* Who set it running, where the app saw it happen. Not an "assigned
         operator" — no such field exists on any sheet — but the person whose
         update this is, which is the true version of the same question. A
         line that arrived already marked IP on the workbook has neither. */
      since ? el('span.small.muted.nowrun-since', {},
        icon('clock', { size: 13 }),
        `running ${since}`,
        row.status.by ? el('span.nowrun-by', {}, ' · ' + row.status.by) : null) : null),
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
const NOWRUN_CAP = 1;

function nowRunningPanel(machine, rerender, vs) {
  const rows = runningNow(machine.key);

  // An idle machine gets a real answer rather than a blank: it is one of the
  // three questions this page exists to answer, and "nothing" is a valid one.
  if (!rows.length) {
    return el('div.nowrun', {},
      el('div.nowrun-empty', {},
        icon('dot', { size: 18 }),
        el('span', {}, 'Nothing running on ' + machine.label,
          el('span.muted', {}, ' — set a line to In Progress and it shows up here'))));
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

  const written = su.source === 'written';
  // Only the workbook half is imported data, and only it goes stale when the
  // parser changes. An update someone typed here is never out of date in that
  // sense, so the re-import warning must not appear over it.
  const staleSu = !written && staleImports().includes('cnc');
  const age = shiftUpdateAge(su.date);

  return el('div.su' + (su.down ? '.down' : '') + (written ? '.written' : ''), {},
    el('div.su-head', {},
      // Where it came from, not just how old it is: "what the workbook said
      // when it was last saved" and "what the afternoon shift wrote" are
      // different claims, and the panel used to make them look identical.
      el('span.su-title', {},
        icon(written ? 'pencil' : 'note', { size: 12 }),
        written ? 'Shift update — written here' : 'Shift update — from the workbook'),
      su.date ? chip(`${su.shift || ''} ${fmtDate(su.date)}`.trim(), 'mute') : null,
      // Age, not just the date: a reader should not have to work out what
      // "Aug 13" means relative to today before trusting what is under it.
      age ? chip(age.label, age.tone) : null,
      staleSu ? chip('re-import to refresh', 'warn') : null,
      su.down ? el('span.badge-down', {}, icon('alert', { size: 12 }), 'Machine down') : null,
      el('span.spacer'),
      written && su.by ? el('span.small.muted', {}, `by ${su.by}`) : null,
      su.ops != null ? el('span.small.muted', {}, `${su.ops} operator${su.ops === 1 ? '' : 's'}`) : null),
    // A written update cannot record a machine as down — only the workbook
    // does — so a newer one must not look like it cleared the flag.
    su.staleDown ? el('div.su-staledown', {},
      icon('alert', { size: 13 }),
      el('span', {}, `The workbook had this machine down on ${fmtDate(su.staleDown)}. `
        + 'The update above is newer and does not say either way.')) : null,
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
            resetMachineConfig(machine.key);
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
    /* Reviewing a stale pile is the case this exists for: select the group,
       give one reason, done. On the Parked filter the same button is the way
       back out, because a one-way door is one nobody uses. */
    el('button.bulk-btn', {
      onclick: () => {
        const done = () => { vs.selected.clear(); rerender(); };
        if (vs.filter === 'PARKED') bulkUnpark(keys, done);
        else bulkParkDialog(keys, done);
      },
    }, icon('square', { size: 14 }), vs.filter === 'PARKED' ? 'Put back' : 'Park'),
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
  // Last, and named for what it holds rather than for a state a line is in:
  // this is the review list, not another way to work the queue.
  { key: 'PARKED', label: 'Parked' },
];

/** A paper schedule is generated from the queue model, not from the collapsed
    screen rows, so every line in the current machine/filter view is included. */
function printMachineSchedule(machine, groups, sum, vs) {
  const filter = FILTERS.find((item) => item.key === vs.filter)?.label || vs.filter;
  const visible = groups.reduce((count, group) => count + group.rows.length, 0);
  const context = [
    vs.showDone ? 'Including completed lines' : 'Open lines only',
    vs.filter !== 'ALL' ? `Filter: ${filter}` : null,
    vs.q ? `Search: “${vs.q}”` : null,
  ].filter(Boolean).join(' · ');

  const rowsFor = (group) => group.rows.map((row) => {
    const task = row.task;
    const bo = resolveBackOrder(task);
    const rush = row.rush || resolveRush(task);
    const note = taskNoteFor(taskStatusKey(task));
    const flags = [
      rush.on ? `RUSH${rush.needBy ? ` ${fmtDate(rush.needBy)}` : ''}` : null,
      bo.on ? `B/O${bo.qty != null ? ` ${fmtNum(bo.qty)} short` : ''}` : null,
      isStaged(task) ? 'Staged' : null,
      isAssigned(task) ? `Moved from ${machineConfig(MACHINE_BY_KEY[task.machine]
        || { label: task.machine }).label}` : null,
      task.manual ? 'Added here' : null,
    ].filter(Boolean);
    const notes = [task.comments, bo.note || bo.sheetShort, note?.text].filter(Boolean);

    return el('tr', {},
      el('td.mono.print-wo', {}, task.wo || '—'),
      el('td', {},
        el('strong', {}, task.project || '—'),
        task.floor ? el('small', {}, task.floor) : null),
      el('td.mono', {}, task.die || '—'),
      el('td.mono.num', {}, fmtNum(task.qty)),
      el('td', {}, fmtDate(task.cuttingDate)),
      el(`td.print-status.${row.status.key.toLowerCase()}`, {},
        row.status.label,
        row.status.implied ? el('small', {}, 'inferred') : null),
      el('td.print-flags', {},
        flags.length ? el('strong', {}, flags.join(' · ')) : null,
        notes.length ? el('small', {}, notes.join(' — ')) : null));
  });

  const body = el('div.print-machine-schedule', {},
    el('div.print-stat-grid', {},
      ...[
        [visible, 'lines printed'],
        [sum.inProgress, 'running'],
        [sum.overdue, 'overdue'],
        [sum.rush, 'rush'],
        [sum.backOrder, 'back orders'],
      ].map(([value, label]) => el('div', {}, el('b', {}, fmtNum(value)), el('span', {}, label)))),
    groups.length
      ? groups.map((group) => el('section.print-table-group', {},
          el('h2', {}, group.label, el('span', {}, `${group.rows.length} line${group.rows.length === 1 ? '' : 's'}`)),
          el('table.print-table', {},
            el('thead', {}, el('tr', {},
              ...['Work order', 'Project / floor', 'Die', 'Qty', 'Cut date', 'Status', 'Flags / notes']
                .map((label) => el('th', {}, label)))),
            el('tbody', {}, ...rowsFor(group)))))
      : el('div.print-empty', {}, 'No lines match this machine view.'));

  printDocument({
    title: `${machine.label} schedule`,
    subtitle: machine.note || 'Machine production queue',
    meta: [context, `${fmtNum(sum.done)} of ${fmtNum(sum.total)} complete`],
    body,
    landscape: true,
  });
}

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
          onclick: () => {
            vs.machine = m.key; vs.selected.clear(); vs.active = undefined;
            markMotion(vs, { type: 'machine', key: m.key });
            rerender();
          },
        },
          m.label,
          el('span.subtab-count', {}, String(openCountFor(m.key))))))
      : null;

    const stat = (n, label, tone, iconName) => el('div.cstat' + (tone && n ? '.' + tone : ''), {},
      el('span.cstat-icon', { 'aria-hidden': 'true' }, icon(iconName, { size: 18 })),
      el('span.cstat-copy', {}, el('b', {}, fmtNum(n)), el('i', {}, label)));

    const filters = el('div.centre-filters', {},
      el('div.searchwrap', {},
        icon('search', { size: 15, cls: 'searchicon' }),
        el('input', {
          type: 'search', placeholder: 'Search W/O, project, die, note…', value: vs.q,
          oninput: (e) => {
            vs.q = e.target.value;
            clearTimeout(filters._t);
            filters._t = setTimeout(rerender, 150);
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
        `Show done${sum.done ? ` (${fmtNum(sum.done)})` : ''}`));

    const head = el('div.centre-head', {},
      el('div.row.centre-title-row.printable-title-row', {},
        el('div.centre-ident', {},
          el('span.centre-rail', { 'aria-hidden': 'true' }),
          el('div', {},
            el('div.row', { style: { gap: '2px' } },
              el('h1.centre-title', {}, machine.label),
              el('button.iconbtn', {
                title: 'Set up this machine',
                onclick: () => machineSettings(machine, rerender),
              }, icon('gear', { size: 16 })),
              // Work the schedules do not have yet — a remake, a service
              // order, anything phoned in — goes on the machine it will run on.
              el('button.iconbtn', {
                title: `Add a job to ${machine.label}`,
                onclick: () => manualJobDialog({ machine: machine.key, rerender }),
              }, icon('plus', { size: 17 }))),
            el('div.centre-sub', {},
              machine.note || '',
              machine.ops != null ? `${machine.note ? ' · ' : ''}${machine.ops} operator${machine.ops === 1 ? '' : 's'}` : ''))),
        el('span.spacer'),
        el('button.print-action', {
          type: 'button', title: `Print ${machine.label} schedule`,
          onclick: () => printMachineSchedule(machine, groups, sum, vs),
        }, icon('print', { size: 16 }), el('span', {}, 'Print schedule'))),

      tabs,
      // Keep the machine choice ahead of its numbers. The operator first says
      // which machine they are looking at, then reads its four answers.
      el('div.centre-stats', {},
        stat(sum.inProgress, 'running', 'work', 'play'),
        stat(sum.open, 'open', '', 'list'),
        stat(sum.overdue, 'overdue', 'bad', 'clock'),
        sum.parked ? stat(sum.parked, 'parked', 'mute', 'square') : null,
        stat(sum.rush + sum.backOrder, 'B/O & rush', 'bad', 'alert')),
      el('div.progress-cap', {}, `${donePct}% complete · ${fmtNum(sum.done)} of ${fmtNum(sum.total)} lines done`));

    /* Routing 80 unassigned lines one at a time is the job this page was
       making somebody do every import. Where the component is recognised, it
       can be done in one action — still a deliberate one, and still reversible
       line by line afterwards. */
    const suggestions = canMoveIn(group) ? suggestionsIn(group) : [];
    const routeBanner = suggestions.length ? el('div.routebar', {},
      icon('arrow', { size: 16 }),
      el('div', {},
        el('strong', {}, `${fmtNum(suggestions.length)} line${suggestions.length === 1 ? '' : 's'} `
          + 'can be routed from what these components usually run on'),
        el('div.small.muted', {},
          Object.entries(suggestions.reduce((a, s) => {
            const label = machineConfig(MACHINE_BY_KEY[s.machine]).label;
            a[label] = (a[label] || 0) + 1;
            return a;
          }, {})).map(([label, n]) => `${n} → ${label}`).join(' · '))),
      el('span.spacer'),
      el('button.primary', {
        onclick: () => {
          const before = suggestions.length;
          for (const s of suggestions) {
            setTaskMachine(taskStatusKey(s.task), s.machine, s.task.machine);
          }
          toast(`Routed ${before} line${before === 1 ? '' : 's'}`);
          rerender();
        },
      }, icon('check', { size: 15 }), 'Route them')) : null;

    const body = groups.length
      ? el('div', {}, ...groups.map((g) => dateGroup(g, vs, rerender, group)))
      : el('div.panel', {}, el('div.empty', {},
          el('div.empty-icon', {}, icon('check', { size: 28 })),
          el('h3', {}, vs.q || vs.filter !== 'ALL' ? 'Nothing matches' : 'All clear'),
          el('div', {}, vs.q || vs.filter !== 'ALL'
            ? 'Try clearing the search or the filter.'
            : 'Nothing outstanding on this machine.')));

    const firstRow = groups.flatMap((g) => g.rows)[0] || null;
    if (vs.active === undefined && firstRow
        && typeof matchMedia === 'function' && matchMedia('(min-width: 1180px)').matches) {
      vs.active = taskStatusKey(firstRow.task);
    }
    const activeTask = vs.active ? taskByKey(vs.active) : null;
    const activeRow = activeTask ? {
      task: activeTask,
      status: effectiveTaskStatus(activeTask),
      rush: resolveRush(activeTask),
    } : null;

    return el('div.centre', {},
      el('div.centre-workspace' + (activeRow ? '.with-inspector' : ''), {},
        el('div.centre-primary' + (vs.motion?.type === 'machine' ? '.machine-switch' : ''), {},
          head,
          routeBanner,
          nowRunningPanel(machine, rerender, vs),
          filters,
          body,
          shiftUpdatePanel(machine.key),
          bulkBar(vs, rerender, group)),
        lineInspector(activeRow, vs, rerender, group)));
  };
}
