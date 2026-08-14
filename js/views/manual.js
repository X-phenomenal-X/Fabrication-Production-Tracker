/* Adding a job the workbook does not have.

   The schedules are the source of truth, but the floor runs work that is not
   on them yet — a remake for a broken piece, a service order phoned in, a job
   the office has not put in the book. Before this, those either went untracked
   or someone edited an unrelated line to stand in for them.

   A manual job is task-shaped and keyed exactly like an imported one, so every
   overlay already in the app — status, note, rush, back order, assignment,
   history — works on it with no special casing. It lives in its own map so a
   re-import cannot wipe it, and it steps aside on its own once the workbook
   catches up and imports the same work order and die. */

import { el, icon, fmtDate, fmtNum, fmtWhen, toast, modal, confirmDialog } from '../ui.js';
import {
  addManualTask, updateManualTask, deleteManualTask, MANUAL_FIELDS, state,
} from '../store.js';
import { machineConfig, manualIdFor, today } from '../model.js';
import { MACHINES, MACHINE_BY_KEY, assignableIn } from '../machines.js';

const FIELDS = [
  { key: 'wo', label: 'Work order', type: 'text', required: true,
    placeholder: '31942', hint: 'What the job is called on the floor' },
  { key: 'die', label: 'Die', type: 'text', placeholder: 'S80.104' },
  { key: 'project', label: 'Project', type: 'text', placeholder: 'Harbour Point' },
  { key: 'floor', label: 'Floor / Tag', type: 'text', placeholder: '12A' },
  { key: 'qty', label: 'Quantity', type: 'number', placeholder: '0' },
  { key: 'cuttingDate', label: 'Cutting date', type: 'date' },
];

/** Add a job, or edit one already added by hand.
    `task` is the existing manual job when editing, otherwise null. */
export function manualJobDialog({ machine, task = null, rerender }) {
  const editing = !!task;
  const id = editing ? manualIdFor(task) : null;

  const inputs = {};
  const field = (f) => {
    const val = editing ? (task[f.key] ?? '') : (f.key === 'cuttingDate' ? today() : '');
    const input = el('input', {
      type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text',
      value: val === null ? '' : String(val),
      placeholder: f.placeholder || '',
      ...(f.type === 'number' ? { min: '0', inputmode: 'decimal' } : {}),
    });
    inputs[f.key] = input;
    return el('label.field', {},
      el('span', {}, f.label, f.required ? el('em.of-total', {}, 'required') : null),
      input,
      f.hint ? el('div.small.muted', { style: { marginTop: '4px' } }, f.hint) : null);
  };

  // Which machine it runs on. The shared CNC queue is offered too when adding
  // there, since "not decided yet" is a real answer for a CNC job.
  const group = MACHINE_BY_KEY[machine]?.group;
  const choices = group
    ? MACHINES.filter((m) => m.group === group)
    : MACHINES;
  const machineSel = el('select', {},
    ...choices.map((m) => el('option', {
      value: m.key, selected: m.key === machine,
    }, machineConfig(m).label)));

  const comments = el('textarea', {
    value: editing ? (task.comments || '') : '',
    placeholder: 'Why it is being run, who asked for it, anything the next shift needs',
    style: { minHeight: '76px' },
  });

  const body = el('div', {},
    el('p.small.muted', { style: { marginTop: 0 } },
      editing
        ? 'This job was added by hand, so it is not in either workbook. '
          + 'Everything recorded against it behaves exactly like a scheduled line.'
        : 'For work the schedules do not have yet — a remake, a service order, '
          + 'anything phoned in. It survives re-importing the workbooks, and steps '
          + 'aside on its own if the same work order and die later arrive in one.'),

    el('label.field', { style: { marginBottom: '12px' } },
      el('span', {}, 'Machine'), machineSel),

    el('div.grid', {
      style: { gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '12px' },
    }, ...FIELDS.map(field)),

    el('label.field', { style: { marginTop: '12px' } },
      el('span', {}, 'Notes'), comments),

    editing && task.at ? el('div.small.muted', { style: { marginTop: '10px' } },
      `Added by ${task.by} · ${fmtWhen(task.at)}`) : null);

  const read = () => {
    const out = { machine: machineSel.value, comments: comments.value };
    for (const f of FIELDS) {
      const raw = inputs[f.key].value.trim();
      out[f.key] = raw === '' ? null : (f.type === 'number' ? Number(raw) : raw);
    }
    return out;
  };

  const dlg = modal(editing ? `Edit job — ${task.wo}` : 'Add a job', body, {
    actions: [
      editing ? {
        label: 'Delete', class: 'danger', onClick: async (d) => {
          const ok = await confirmDialog('Delete this job?',
            `W/O ${task.wo} was added by hand. Deleting it also drops the status, `
            + 'notes and history recorded against it.',
            { confirmLabel: 'Delete', danger: true });
          if (!ok) return;
          deleteManualTask(id);
          d.close(); toast('Job deleted'); rerender();
        },
      } : null,
      {
        label: editing ? 'Save' : 'Add job', class: 'primary', onClick: (d) => {
          const fields = read();
          if (!fields.wo) {
            toast('A work order is needed — it is how the line is identified');
            inputs.wo.focus();
            return;
          }
          if (editing) {
            updateManualTask(id, fields);
            toast('Saved');
          } else {
            addManualTask(fields);
            toast(`Added W/O ${fields.wo} to ${machineConfig(MACHINE_BY_KEY[fields.machine]).label}`);
          }
          d.close();
          rerender();
        },
      },
    ].filter(Boolean),
  });

  inputs.wo.focus();
  return dlg;
}
