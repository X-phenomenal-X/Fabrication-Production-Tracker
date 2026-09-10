import { focusShiftUpdate } from './shiftupdate.js';
import { el, chip, icon, modal, toast, fmtDate, fmtNum } from '../ui.js';
import { directoryPeople, me } from '../store.js';
import { today, machineConfig } from '../model.js';
import { MACHINES } from '../machines.js';
import { commandSnapshot, createOperation, completeOperation, operationKind } from '../command-center.js';

const GROUP_PAGE = { Rolling: 'rolling', FOM: 'fom', CNC: 'cnc', Punch: 'punch' };
const filters = { group: '', attention: false, kind: 'all', resolved: false, allMachines: false };
const button = (label, fn, cls = '') => el('button' + (cls ? '.' + cls : ''), { type: 'button', onclick: fn }, label);
const empty = text => el('p.command-empty', {}, icon('check', { size: 18 }), text);
const field = (label, input) => el('label.command-field', {}, el('span', {}, label), input);
const panel = (title, detail, body, action) => el('section.command-panel', {},
  el('header.command-panel-head', {}, el('div', {}, el('h2', {}, title), el('p', {}, detail)), action), body);

export function openOperationDialog(kind, rerender, machine = '', item = null) {
  const title = item ? 'Edit report' : kind === 'downtime' ? 'Report downtime' : kind === 'quality' ? 'Report a quality issue' : 'Add supervisor action';
  const text = el('textarea', { rows: 3, required: true, maxLength: 2000, 'aria-label': 'Report details', placeholder: 'What happened, and what needs to happen next?' });
  const station = el('select', { 'aria-label': 'Affected machine', required: kind === 'downtime' },
    el('option', { value: '' }, kind === 'downtime' ? 'Choose a machine' : 'Department / no machine'),
    ...MACHINES.filter(m => !m.queue).map(machineConfig).filter(m => !m.hidden || m.key === machine)
      .map(m => el('option', { value: m.key, selected: m.key === machine }, m.label)));
  const owner = el('select', { 'aria-label': 'Action owner' }, el('option', { value: '' }, 'Unassigned'),
    ...directoryPeople().map(p => el('option', { value: p, selected: p === me() }, p)));
  const priority = el('select', { 'aria-label': 'Priority' }, el('option', { value: 'normal' }, 'Normal'), el('option', { value: 'high' }, 'High — needs attention'));
  const date = el('input', { type: 'date', value: today(), required: true, max: today(), 'aria-label': 'Report date' });
  const dueDate = el('input', { type: 'date', 'aria-label': 'Due date' });
  const wo = el('input', { 'aria-label': 'Work order', maxLength: 80, placeholder: 'Optional' });
  const amount = el('input', { type: 'number', min: 0, step: 1, 'aria-label': kind === 'quality' ? 'Affected pieces' : 'Lost minutes', placeholder: 'Unknown / not measured' });
  if (item) {
    text.value = item.text.replace(/^\[(Quality|Downtime)\] /, '');
    station.value = item.operation?.machine || '';
    if (item.assignee && !Array.from(owner.options).some(o => o.value === item.assignee)) owner.append(el('option', { value: item.assignee }, item.assignee));
    owner.value = item.assignee || '';
    priority.value = item.operation?.priority || 'normal';
    dueDate.value = item.operation?.dueDate || '';
    date.value = item.date; wo.value = item.operation?.wo || '';
    amount.value = (kind === 'quality' ? item.operation?.quantity : item.operation?.minutes) ?? '';
  }
  const error = el('p.command-error', { role: 'alert' });
  let dialog;
  const form = el('form.command-form', { onsubmit: event => {
    event.preventDefault();
    try {
      createOperation({ id: item?.id, kind, text: text.value, machine: station.value, assignee: owner.value || null, priority: priority.value,
        date: date.value, dueDate: dueDate.value, wo: wo.value, minutes: amount.value, quantity: amount.value });
      dialog.close(); rerender(); toast('Saved. This report also appears in Today.');
    } catch (reason) { error.textContent = reason.message; }
  } },
  field('Details', text), el('div.command-form-grid', {}, field('Machine', station), field('Owner', owner), field('Priority', priority), field('Report date', date), kind === 'action' ? field('Due date · optional', dueDate) : null,
    field('Work order · optional', wo), kind !== 'action' ? field(kind === 'quality' ? 'Affected pieces · optional' : 'Lost minutes · optional', amount) : null),
  el('p.small.muted', {}, kind === 'downtime' ? 'Enter measured lost time. Closing a report does not clear a workbook down flag.'
    : kind === 'quality' ? 'Record the issue and follow-up here. A report does not reject or change scheduled quantities.' : 'Open actions carry forward until completed.'),
  error, el('button.primary', { type: 'submit' }, 'Save report'));
  dialog = modal(title, form);
}

function chooseIssue(rerender, machine) {
  modal('What needs attention?', el('p', {}, 'Choose the report type for this machine.'), { actions:
    [['downtime', 'Downtime'], ['quality', 'Quality issue'], ['action', 'Other / action']].map(([kind, label]) => ({
      label, onClick: dialog => { dialog.close(); openOperationDialog(kind, rerender, machine); },
    })) });
}

function reportRow(item, rerender) {
  const op = item.operation || {};
  const kind = operationKind(item);
  return el('article.command-report', { 'data-report-id': item.id },
    el('div.command-report-copy', {},
      el('div.command-report-tags', {}, chip(kind === 'action' ? 'Action' : kind === 'quality' ? 'Quality' : 'Downtime', kind === 'quality' ? 'warn' : kind === 'downtime' ? 'bad' : 'mute'),
        op.priority === 'high' ? chip('High priority', 'bad') : null,
        !item.done && op.dueDate && op.dueDate < today() ? chip('Overdue', 'bad') : null,
        item.done ? chip('Resolved', 'ok') : item.date < today() ? chip('Carried over', 'warn') : null),
      el('strong', {}, item.text),
      el('p', {}, `${item.assignee || 'Unassigned'} · ${fmtDate(item.date)}`,
        op.dueDate ? ` · Due ${fmtDate(op.dueDate)}` : '',
        op.wo ? ` · W/O ${op.wo}` : '',
        op.machine ? ` · ${machineConfig(MACHINES.find(m => m.key === op.machine) || { label: op.machine }).label}` : ''),
      kind === 'downtime' ? el('small', {}, op.minutes == null ? 'Lost time not measured' : `${op.minutes} min reported`) : null,
      kind === 'quality' ? el('small', {}, op.quantity == null ? 'Affected quantity not recorded' : `${op.quantity} affected pcs`) : null),
    el('div.command-report-actions', {}, button('Edit', () => openOperationDialog(kind, rerender, op.machine, item), 'ghost'),
    !item.done ? button('Resolve', () => {
      modal('Resolve this report?', el('p', {}, item.text), { actions: [{ label: 'Resolve report', class: 'primary', onClick: dlg => {
        completeOperation(item.id); dlg.close(); rerender(); toast('Report resolved');
      } }] });
    }, 'ghost') : null));
}

export function renderCommandCenter(rerender, go) {
  const data = commandSnapshot();
  const openHandover = () => { focusShiftUpdate(data.context.date, data.context.key); go('shift'); };
  const machines = data.machines.filter(m => (!filters.group || m.group === filters.group) && (!filters.attention || ['bad', 'warn'].includes(m.tone)));
  machines.sort((a, b) => ['bad', 'warn', 'work', 'mute'].indexOf(a.tone) - ['bad', 'warn', 'work', 'mute'].indexOf(b.tone));
  const displayedMachines = filters.allMachines ? machines : machines.slice(0, 4);
  const selectGroup = el('select', { 'aria-label': 'Filter machine group', onchange: e => { filters.group = e.target.value; rerender(); } },
    el('option', { value: '', selected: !filters.group }, 'All work centres'),
    ...['Rolling', 'FOM', 'CNC', 'Punch'].map(g => el('option', { value: g, selected: filters.group === g }, g === 'CNC' ? 'CNC & FMC' : g)));
  const machinePanel = panel('Machine status', 'Based on tracked work and reports. Confirm conditions on the floor.',
    el('div', {}, el('div.command-filters', {}, selectGroup,
      el('label.command-toggle', {}, el('input', { type: 'checkbox', checked: filters.attention, onchange: e => { filters.attention = e.target.checked; rerender(); } }), 'Needs attention')),
      machines.length ? el('div.command-machines', {}, ...displayedMachines.map(m => el('article.command-machine.' + m.tone, {},
        el('div.command-machine-top', {}, el('strong', {}, m.label), chip(m.status, m.tone)),
        el('p', {}, m.running.length ? `${m.running.length} active line${m.running.length === 1 ? '' : 's'} · W/O ${m.running[0].task.wo}` : 'No line marked in progress'),
        el('small', {}, m.incidents.length ? `${m.incidents.length} open downtime report${m.incidents.length === 1 ? '' : 's'}`
          : m.update ? `Shift update ${fmtDate(m.update.date)}${m.update.staleDown ? ` · down flag from ${fmtDate(m.update.staleDown)}` : ''}` : 'No shift update recorded'),
        el('div.command-machine-actions', {}, button('Open queue', () => go(GROUP_PAGE[m.group]), 'ghost'),
          button('Report issue', () => chooseIssue(rerender, m.key), 'ghost'))))) : empty('No machines match these filters.'),
      machines.length > 4 ? button(filters.allMachines ? 'Show priority machines' : `View all ${machines.length} machines`, () => { filters.allMachines = !filters.allMachines; rerender(); }, 'command-more') : null));
  const losses = panel('Downtime', 'Reported losses today; unknown time stays unmeasured.',
    el('div.command-summary-body', {}, el('div.command-big', {}, fmtNum(data.minutes), el('small', {}, ' min reported')),
      el('p', {}, `${data.down.length} open report${data.down.length === 1 ? '' : 's'} · ${data.unknownMinutes} today without measured time`),
      data.down.length ? el('p.command-emphasis', {}, data.down[0].text) : empty('No open downtime reports.'),
      button('Report downtime', () => openOperationDialog('downtime', rerender), 'ghost')));
  const quality = panel('Quality watch', 'Open issues requiring inspection, containment or follow-up.',
    el('div.command-summary-body', {}, el('div.command-big', {}, fmtNum(data.quality.length), el('small', {}, ' open issues')),
      data.quality.length ? el('p.command-emphasis', {}, data.quality[0].text) : empty('No open quality reports.'),
      el('p.small.muted', {}, 'Issue counts are not a defect rate.'), button('Report quality issue', () => openOperationDialog('quality', rerender), 'ghost')));
  const visibleReports = (filters.resolved ? [...data.open, ...data.reports.filter(t => t.done)] : data.open).filter(t => filters.kind === 'all' || operationKind(t) === filters.kind);
  const actions = panel('Supervisor actions', 'Owners, priorities and outstanding follow-ups in one place.',
    el('div', {}, el('div.command-filters', {},
      el('select', { 'aria-label': 'Filter reports', onchange: e => { filters.kind = e.target.value; rerender(); } },
        ...[['all', 'All reports'], ['action', 'Actions'], ['downtime', 'Downtime'], ['quality', 'Quality']].map(([v, label]) => el('option', { value: v, selected: filters.kind === v }, label))),
      el('label.command-toggle', {}, el('input', { type: 'checkbox', checked: filters.resolved, onchange: e => { filters.resolved = e.target.checked; rerender(); } }), 'Show resolved')),
      visibleReports.length ? el('div.command-reports', {}, ...visibleReports.map(t => reportRow(t, rerender))) : empty('No reports in this view.')),
    button('Add action', () => openOperationDialog('action', rerender), 'primary'));
  const handover = panel('Shift handover', `${data.context.shift.label} · ${fmtDate(data.context.date)}${data.context.live ? '' : ' · ended'}`,
    el('div.command-summary-body', {}, el('div.command-big', {}, `${data.documented}/${data.machines.length}`, el('small', {}, ' machines documented')),
      el('progress.command-progress', { max: Math.max(1, data.machines.length), value: data.documented, 'aria-label': 'Machines with saved handover notes' }),
      el('p', {}, `${data.completed.length} line${data.completed.length === 1 ? '' : 's'} marked done during this shift`),
      el('p', {}, `${data.open.length} open actions · ${data.board.backOrders.length} shortage lines to review`),
      el('p.small.muted', {}, data.log?.notes || 'Review completed work, next jobs and unresolved issues with the incoming crew.'),
      button('Prepare handover', openHandover, 'primary')));
  return el('div.command-center', {},
    el('div.command-toolbar', {}, el('div', {}, el('span.command-eyebrow', {}, 'Floor control'), el('h2', {}, 'Keep the next decision clear.')),
      el('div.command-toolbar-actions', {}, button('Add action', () => openOperationDialog('action', rerender)), button('Write handover', openHandover, 'primary'))),
    machinePanel,
    el('div.command-insights', {}, losses, quality, handover), actions);
}
