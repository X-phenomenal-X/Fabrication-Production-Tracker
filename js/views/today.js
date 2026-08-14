/* Today: what has to happen, in one place.

   Two halves, because "what do I need to do today" has two kinds of answer.

   The top half is the department's own list — jobs no schedule knows about.
   Chase the mill, change a blade, walk a drawing over, ring the shipper. These
   are typed in and ticked off. An unfinished one follows the day forward
   rather than disappearing at midnight, marked with the day it was written,
   because an outstanding job does not stop being outstanding.

   The bottom half is derived from the schedules and stores nothing: what is
   running, what is late, what is due today, what is rushed, what is short.
   Each one is a way in to the page that actually handles it, so this is a
   starting point rather than a fifth place to record the same thing. */

import {
  el, chip, icon, fmtDate, fmtNum, fmtWhen, toast, confirmDialog,
} from '../ui.js';
import { state, addTodo, setTodo, deleteTodo, me } from '../store.js';
import {
  openTodos, todayBoard, shiftWritten, today, hasTasks, machineConfig,
} from '../model.js';
import { MACHINE_BY_KEY } from '../machines.js';
import { SHIFTS, shiftAt } from '../shifts.js';

function machineLabel(key) {
  const m = MACHINE_BY_KEY[key];
  return m ? machineConfig(m).label : key;
}

/* ---------- the list ---------- */

function todoRow(item, ref, rerender) {
  const carried = item.date < ref;
  const age = (iso) => iso ? Date.now() - new Date(iso).getTime() : Infinity;
  const justDone = item.done && age(item.doneAt) < 800;
  const justAdded = !item.done && age(item.at) < 800;

  return el('li.todo' + (item.done ? '.done' : '') + (carried ? '.carried' : '')
    + (justDone ? '.just-done' : '') + (justAdded ? '.just-added' : ''), {},
    el('label.todo-check', {},
      el('input', {
        type: 'checkbox', checked: !!item.done,
        'aria-label': (item.done ? 'Mark not done: ' : 'Mark done: ') + item.text,
        onchange: (e) => { setTodo(item.id, { done: e.target.checked }); rerender(); },
      })),

    el('div.todo-main', {},
      el('div.todo-text', {}, item.text),
      el('div.todo-meta', {},
        // Where a carried job came from matters: three days old is a different
        // conversation from written this morning.
        carried ? chip(`from ${fmtDate(item.date)}`, 'warn') : null,
        item.assignee ? el('span.todo-who', {}, icon('dot', { size: 10 }), item.assignee) : null,
        item.done
          ? el('span.muted', {}, `done by ${item.doneBy} · ${fmtWhen(item.doneAt)}`)
          : el('span.muted', {}, `added by ${item.by} · ${fmtWhen(item.at)}`))),

    el('button.line-iconbtn', {
      title: 'Remove',
      onclick: async () => {
        const ok = await confirmDialog('Remove this?', item.text,
          { confirmLabel: 'Remove', danger: true });
        if (!ok) return;
        deleteTodo(item.id);
        toast('Removed');
        rerender();
      },
    }, icon('x', { size: 15 })));
}

function listPanel(ref, rerender) {
  const { open, done, carried } = openTodos(ref);

  const input = el('input', {
    placeholder: 'Something that needs doing today…',
    'aria-label': 'What needs doing',
    onkeydown: (e) => { if (e.key === 'Enter') add(); },
  });

  const people = state.people || [];
  const who = el('select', { 'aria-label': 'Who it is for', style: { width: 'auto', minWidth: '150px' } },
    el('option', { value: '' }, 'Anyone'),
    ...people.map((p) => el('option', { value: p, selected: p === me() }, p)));

  function add() {
    const text = input.value.trim();
    if (!text) return;
    addTodo(text, { date: ref, assignee: who.value || null });
    input.value = '';
    rerender();
  }

  return el('div.panel', {},
    el('header', {},
      icon('list', { size: 14 }),
      el('h2', {}, 'To do'),
      open.length ? chip(`${open.length} open`, carried ? 'warn' : 'mute') : null,
      carried ? chip(`${carried} carried over`, 'warn') : null,
      el('span.spacer'),
      done.length ? el('span.small.muted', {}, `${done.length} done today`) : null),

    el('div.body', {},
      el('div.todo-add', {},
        input,
        who,
        el('button.primary', { onclick: add }, icon('plus', { size: 15 }), 'Add')),

      open.length || done.length
        ? el('ul.list.todo-list', {},
            ...open.map((t) => todoRow(t, ref, rerender)),
            ...done.map((t) => todoRow(t, ref, rerender)))
        : el('div.empty', {},
            el('div.empty-icon', {}, icon('check', { size: 28 })),
            el('h3', {}, 'Nothing on the list'),
            el('div', {}, 'Anything the schedules do not cover goes here — chasing '
              + 'material, a blade change, a call to make.'))));
}

/* ---------- what the schedules say ---------- */

function attentionCard({ label, rows, tone, hint, go, tab, iconName }) {
  const n = rows.length;
  return el('button.att' + (n && tone ? '.' + tone : ''), {
    onclick: () => go(tab),
    title: `Open ${label}`,
  },
    el('span.att-icon', { 'aria-hidden': 'true' }, icon(iconName, { size: 17 })),
    el('span.att-copy', {},
      el('span.att-n', {}, fmtNum(n)),
      el('span.att-k', {}, label),
      el('span.att-hint', {}, n ? hint : 'nothing outstanding')));
}

function pileList(title, rows, tone, cap = 5) {
  if (!rows.length) return null;
  return el('section.dgroup', {},
    el('div.dgroup-head', {},
      el('span.dgroup-label.' + tone, {}, title),
      el('span.dgroup-count', {}, String(rows.length))),
    el('div.dgroup-body', {},
      ...rows.slice(0, cap).map(({ task, machine }) => el('div.line.today-line', {},
        el('div.line-main', {},
          el('div.line-id', {},
            el('span.mono.strong', {}, task.wo),
            task.die ? el('span.die', {}, task.die) : null,
            chip(machineLabel(machine), 'mute')),
          el('div.line-where', {},
            el('span', {}, task.project || '—'),
            task.floor ? el('span.muted', {}, ' · ' + task.floor) : null)),
        el('div.line-qty', {},
          el('span.mono', {}, fmtNum(task.qty)),
          el('span.small.muted', {}, 'pcs')),
        el('div.line-date.hide-sm', {}, fmtDate(task.cuttingDate)))),
      rows.length > cap
        ? el('div.small.muted', { style: { padding: '10px 16px' } },
            `and ${rows.length - cap} more`)
        : null));
}

/* ---------- page ---------- */

export function renderToday(rerender, go) {
  const ref = today();
  const shiftKey = shiftAt();
  const shift = SHIFTS[shiftKey];

  const head = el('div.centre-head', {},
    el('div.row.centre-title-row', {},
      el('div.centre-ident', {},
        el('span.centre-rail', { 'aria-hidden': 'true' }),
        el('div', {},
          el('h1.centre-title', {}, 'Today'),
          el('div.centre-sub', {},
            fmtDate(ref, { withDay: true }),
            el('span.dot-sep', {}, '·'),
            `${shift.label} shift`,
            el('span.dot-sep', {}, '·'),
            me()))),
      el('span.spacer')));

  // The list works with no schedule loaded — chasing material does not depend
  // on a workbook — so only the derived half waits on an import.
  if (!hasTasks()) {
    return el('div.centre', {}, head, listPanel(ref, rerender),
      el('div.panel', { style: { marginTop: '16px' } }, el('div.empty', {},
        el('div.empty-icon', {}, icon('upload', { size: 28 })),
        el('h3', {}, 'No schedule loaded yet'),
        el('p', {}, 'Import the workbooks and this page also shows what is '
          + 'running, late, due and short across every machine.'),
        el('button.primary', { onclick: () => go('setup') }, 'Go to Setup'))));
  }

  const b = todayBoard(ref);
  const written = shiftWritten(ref, shiftKey);

  return el('div.centre', {},
    head,

    listPanel(ref, rerender),

    el('div.panel', { style: { marginTop: '16px' } },
      el('header', {},
        icon('note', { size: 14 }),
        el('h2', {}, 'From the schedules'),
        el('span.small.muted', {}, 'across every machine'),
        el('span.spacer'),
        el('span.small.muted', {}, `${b.finishedToday.length} finished today`)),
      el('div.body', {},
        el('div.attgrid', {},
          attentionCard({ label: 'running now', rows: b.running, tone: 'work',
            hint: 'on the machines', go, tab: 'rolling', iconName: 'play' }),
          attentionCard({ label: 'overdue', rows: b.overdue, tone: 'bad',
            hint: 'past their cutting date', go, tab: 'rolling', iconName: 'clock' }),
          attentionCard({ label: 'due today', rows: b.dueToday, tone: 'warn',
            hint: 'cutting date is today', go, tab: 'rolling', iconName: 'calendar' }),
          attentionCard({ label: 'rush', rows: b.rushNow, tone: 'warn',
            hint: 'needed today or already past', go, tab: 'rush', iconName: 'bolt' }),
          attentionCard({ label: 'back orders', rows: b.backOrders, tone: 'bad',
            hint: 'short of material', go, tab: 'backorders', iconName: 'alert' })),

        // The one job on the day's list with a deadline attached to the shift
        // rather than to a machine.
        el('div.today-shift' + (written ? '.ok' : ''), {},
          icon(written ? 'check' : 'pencil', { size: 15 }),
          el('div', {},
            el('strong', {}, written
              ? `${shift.label} shift update written`
              : `${shift.label} shift update not written yet`),
            el('div.small.muted', {}, written
              ? 'Anything else this shift can be added to it.'
              : 'Write it up before the shift ends so the next one knows where things stand.')),
          el('span.spacer'),
          el('button' + (written ? '' : '.primary'), {
            onclick: () => go('shift'),
          }, written ? 'Open it' : 'Write it')))),

    pileList('Overdue', b.overdue, 'bad'),
    pileList('Due today', b.dueToday, 'warn'),
    pileList('Running now', b.running, 'mute'));
}
