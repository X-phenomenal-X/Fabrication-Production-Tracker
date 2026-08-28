/* Material planning: turn a confirmed floor shortage into rows that are ready
   for the department's shared Material Requests workbook.

   The guarded part is the important part. A scheduled S/SA number is a rolled
   subassembly, not an extrusion that can be ordered. Those rows are expanded
   through the engineering listing and the operator chooses the component that
   is actually short. Piece counts and bar counts remain separate throughout. */

import {
  el, clear, chip, icon, fmtDate, fmtNum, fmtWhen, toast, modal,
  confirmDialog, printDocument,
} from '../ui.js';
import {
  state, me, saveMaterialOrders, setMaterialOrderStatus, deleteMaterialOrder,
} from '../store.js';
import {
  allBackOrders, taskStatusKey, hasTasks, tasksInScope, resolveTask, machineConfig,
} from '../model.js';
import { MACHINE_BY_KEY } from '../machines.js';
import {
  dieForms, lookupDie, resolvedComponentsOf, componentCoverage, listingReferencesOf,
} from '../dies.js';
import { backOrderDialog } from './backorders.js';

const REASONS = [
  'PROD - Production',
  'SH - Pulled Short',
  'RM - Remake',
  'SV - Service',
];

let mode = 'shortages';
let mineOnly = false;
const expandedOwners = new Set();

function today() {
  return new Date().toISOString().slice(0, 10);
}

function machineLabel(key) {
  const machine = MACHINE_BY_KEY[key];
  return machine ? machineConfig(machine).label : key;
}

function clean(value) {
  return String(value ?? '').trim();
}

function dottedDie(value) {
  const part = dieForms(value).part;
  return part ? part.replace(/^(\d{2})-(\d{3})/, '$1.$2') : clean(value);
}

function cleanLength(value) {
  return clean(value).replace(/[′']/g, '').replace(/\s*(?:FT|FEET)$/i, '').trim();
}

function barCountFrom(task, bo) {
  if (Number.isFinite(task?.bo) && task.bo > 0) return task.bo;
  const m = clean(bo?.sheetShort).match(/(\d+(?:\.\d+)?)\s*BARS?/i);
  return m ? Number(m[1]) : '';
}

function noteMentions(note, die) {
  const normal = (value) => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return !!note && normal(note).includes(normal(die));
}

function orderRows() {
  return Object.values(state.materialOrders || {}).sort((a, b) => {
    const status = { READY: 0, DRAFT: 1, ENTERED: 2 };
    const s = (status[a.status] ?? 1) - (status[b.status] ?? 1);
    if (s) return s;
    return (a.requiredBy || a.requestDate || '9999') < (b.requiredBy || b.requestDate || '9999') ? -1 : 1;
  });
}

function projectByWorkOrder() {
  const map = new Map();
  for (const raw of tasksInScope()) {
    const task = resolveTask(raw);
    if (!map.has(task.wo)) map.set(task.wo, task);
  }
  return map;
}

function requestSuggestion(rawDie, note = '', existing = null) {
  if (existing) {
    return {
      assembly: null,
      coverage: null,
      references: [],
      lines: [{
        key: existing.id,
        role: existing.componentRole || 'Extrusion',
        die: existing.die,
        selected: true,
        verified: existing.componentSource !== 'variant',
        source: existing.componentSource || 'saved request',
        sourceSa: existing.componentSourceSa || existing.sourceAssembly || null,
        stockLength: existing.stockLength || '',
        finish: existing.finish || '',
        bars: existing.bars || '',
      }],
    };
  }

  const value = clean(rawDie);
  const asksForAssembly = /^S(?:A)?\s*\d/i.test(value);
  const lookup = lookupDie(value);

  if (asksForAssembly) {
    if (!lookup.assembly) return { invalidAssembly: true, lines: [], references: [] };
    const lines = resolvedComponentsOf(lookup.assembly).map((component, index) => ({
      key: `${component.die}:${component.role}:${index}`,
      role: component.role,
      die: dottedDie(component.die),
      selected: noteMentions(note, component.die),
      verified: component.verified !== false,
      source: component.source,
      sourceSa: component.sourceSa,
      stockLength: '', finish: '', bars: '',
    }));
    return {
      assembly: lookup.assembly,
      coverage: componentCoverage(lookup.assembly),
      references: listingReferencesOf(lookup.assembly),
      lines,
    };
  }

  if (!value) return { invalidProfile: true, lines: [], references: [] };
  const directDie = lookup.forms.part ? dottedDie(lookup.forms.part) : value.toUpperCase();
  return {
    assembly: null,
    coverage: null,
    references: [],
    lines: [{
      key: lookup.forms.part || directDie,
      role: 'Direct extrusion',
      die: directDie,
      selected: true,
      verified: true,
      source: 'direct',
      sourceSa: null,
      stockLength: '', finish: '', bars: '',
    }],
  };
}

function orderReady(row) {
  return !!(
    clean(row.workOrder) && clean(row.project) && clean(row.die)
    && clean(row.stockLength) && clean(row.finish)
    && Number(row.bars) > 0 && clean(row.reason) && clean(row.requestedBy)
  );
}

function missingOrderFields(row) {
  return [
    ['work order', clean(row.workOrder)],
    ['project', clean(row.project)],
    ['extrusion', clean(row.die)],
    ['stock length', clean(row.stockLength)],
    ['finish', clean(row.finish)],
    ['bars', Number(row.bars) > 0],
    ['reason', clean(row.reason)],
    ['requester', clean(row.requestedBy)],
  ].filter(([, present]) => !present).map(([label]) => label);
}

function sourceLabel(line) {
  if (line.source === 'variant') return `Recovered from ${line.sourceSa}`;
  if (line.source === 'listing') return 'Verified in engineering listing';
  if (line.source === 'direct') return 'Direct extrusion';
  return clean(line.source) || 'Saved request';
}

function materialOrderDialog({ task = null, existing = null } = {}, rerender) {
  const linked = task ? taskStatusKey(task) : existing?.sourceTaskKey || null;
  const workOrders = projectByWorkOrder();
  const initialTask = task || (linked
    ? tasksInScope().map(resolveTask).find((row) => taskStatusKey(row) === linked)
    : null);

  const wo = el('input', {
    value: existing?.workOrder || initialTask?.wo || '',
    placeholder: 'Work order', list: 'material-work-orders',
  });
  const project = el('input', {
    value: existing?.project || initialTask?.project || '', placeholder: 'Project',
  });
  const floor = el('input', {
    value: existing?.floor || initialTask?.floor || '', placeholder: 'Floor / area',
  });
  const requiredBy = el('input', {
    type: 'date', value: existing?.requiredBy || initialTask?.cuttingDate || '',
  });
  const die = el('input', {
    value: existing?.die || initialTask?.die || '',
    placeholder: 'S80.104 or 80.195',
  });
  const reason = el('input', {
    value: existing?.reason || 'PROD - Production',
    list: 'material-reasons', placeholder: 'Reason code',
  });
  const note = el('textarea', {
    value: existing?.note || initialTask && (state.backOrder?.[linked]?.note || '') || '',
    placeholder: 'Interior only, replacement, supplier note…',
  });
  const requestedBy = el('input', {
    value: existing?.requestedBy || me(), placeholder: 'Requested by',
  });

  const workOrderList = el('datalist', { id: 'material-work-orders' },
    ...[...workOrders.keys()].sort().map((value) => el('option', { value })));
  const reasonList = el('datalist', { id: 'material-reasons' },
    ...REASONS.map((value) => el('option', { value })));
  const profileArea = el('div.material-profile-area', { 'aria-live': 'polite' });
  let controls = [];
  let suggestion = null;

  const capture = () => new Map(controls.map((control) => [control.line.die, {
    selected: control.select.checked,
    stockLength: control.length.value,
    finish: control.finish.value,
    bars: control.bars.value,
  }]));

  const drawProfiles = () => {
    const previous = capture();
    suggestion = requestSuggestion(die.value, note.value, existing);
    controls = [];
    clear(profileArea);

    if (suggestion.invalidAssembly) {
      profileArea.append(el('div.banner.bad.material-guardrail', {},
        icon('alert', { size: 18 }),
        el('div', {}, el('strong', {}, 'This subassembly is not resolved.'),
          el('span', {}, ' Do not order the S-number. Verify its extrusion components in Engineering Lookup first.'))));
      return;
    }
    if (suggestion.invalidProfile) {
      profileArea.append(el('div.banner.warn.material-guardrail', {},
        icon('alert', { size: 18 }),
        el('div', {}, el('strong', {}, 'Enter an extrusion or subassembly number.'),
          el('span', {}, ' Example: 80.195 or S80.104.'))));
      return;
    }

    if (suggestion.assembly) {
      profileArea.append(el('div.material-assembly-head', {},
        el('div', {},
          el('span.eyebrow', {}, 'Rolled subassembly'),
          el('strong.mono', {}, suggestion.assembly.sa),
          el('span', {}, suggestion.assembly.desc || 'Engineering listing')),
        chip(`${suggestion.lines.length} extrusion components`, 'work')));
      profileArea.append(el('div.banner.info.material-guardrail', {},
        icon('extrusion', { size: 18 }),
        el('div', {}, el('strong', {}, 'Choose only the component that is actually short.'),
          el('span', {}, ' The S/SA number itself will never be copied into the order workbook.'))));
      if (suggestion.coverage?.missingRoles?.length) {
        profileArea.append(el('div.banner.warn.material-guardrail', {},
          icon('alert', { size: 18 }),
          el('div', {}, el('strong', {}, 'Incomplete listing: '),
            `missing ${suggestion.coverage.missingRoles.join(', ')}. Verify the drawing before ordering.`)));
      }
    }

    const rows = el('div.material-component-list', {});
    for (const line of suggestion.lines) {
      const remembered = previous.get(line.die);
      if (remembered) Object.assign(line, remembered);
      else if (!suggestion.assembly) {
        // The schedule's Material column is operational status, not a trusted
        // stock length. Leave length blank until an operator confirms it.
        line.stockLength = existing?.stockLength || '';
        line.finish = existing?.finish || '';
        line.bars = existing?.bars || barCountFrom(initialTask, linked ? {
          sheetShort: initialTask?.boRaw || initialTask?.boStat,
        } : null);
      } else if (line.selected) {
        line.bars = barCountFrom(initialTask, { sheetShort: initialTask?.boRaw || initialTask?.boStat });
      }

      const select = el('input', {
        type: 'checkbox', checked: line.selected,
        'aria-label': `Order ${line.die}`,
      });
      const length = el('input', {
        type: 'text', inputmode: 'decimal', value: line.stockLength || '',
        placeholder: '18', 'aria-label': `Stock length for ${line.die}`,
      });
      const finish = el('input', {
        value: line.finish || '', placeholder: 'K11704',
        'aria-label': `Finish for ${line.die}`,
      });
      const bars = el('input', {
        type: 'number', inputmode: 'numeric', min: '1', step: '1',
        value: line.bars || '', placeholder: '0',
        'aria-label': `Bars to order for ${line.die}`,
      });
      const row = el('div.material-component' + (line.selected ? '.selected' : ''), {},
        el('label.material-component-pick', {},
          suggestion.assembly ? select : el('span.material-direct-icon', {}, icon('check', { size: 16 })),
          el('span', {},
            el('b', {}, line.role),
            el('strong.mono', {}, line.die),
            el('small', {}, sourceLabel(line)))),
        el('label.field', {}, el('span', {}, 'Stock length · ft'), length),
        el('label.field', {}, el('span', {}, 'Finish / colour'), finish),
        el('label.field', {}, el('span', {}, 'Bars to order'), bars));

      const setEnabled = () => {
        line.selected = select.checked;
        row.classList.toggle('selected', select.checked);
        for (const input of [length, finish, bars]) input.disabled = !select.checked;
      };
      select.addEventListener('change', setEnabled);
      setEnabled();
      controls.push({ line, select, length, finish, bars });
      rows.append(row);
    }
    profileArea.append(rows);

    if (suggestion.references?.length) {
      profileArea.append(el('div.small.muted.material-references', {},
        'Listing text also mentions ',
        suggestion.references.map((item) => dottedDie(item.die)).join(', '),
        '. Their roles are not identified, so they were not added as order choices.'));
    }
  };

  wo.addEventListener('change', () => {
    const match = workOrders.get(clean(wo.value));
    if (!match) return;
    if (!clean(project.value)) project.value = match.project || '';
    if (!clean(floor.value)) floor.value = match.floor || '';
  });
  die.addEventListener('change', drawProfiles);

  const body = el('div.material-order-form', {},
    el('div.material-form-intro', {},
      el('div', {},
        el('span.eyebrow', {}, existing ? 'Edit request' : 'Prepare request'),
        el('strong', {}, existing
          ? 'Review the row before it is entered in the shared workbook.'
          : 'The tracker prepares the row; the shared workbook remains the final order record.')),
      existing ? chip(existing.status || 'DRAFT', existing.status === 'READY' ? 'ok' : 'warn') : null),
    el('div.grid.material-job-fields', {},
      el('label.field', {}, el('span', {}, 'Work order'), wo),
      el('label.field', {}, el('span', {}, 'Project'), project),
      el('label.field', {}, el('span', {}, 'Floor / area'), floor),
      el('label.field', {}, el('span', {}, 'Needed by'), requiredBy)),
    workOrderList,
    el('label.field.material-source-die', {},
      el('span', {}, existing ? 'Extrusion' : 'Scheduled die or extrusion'), die,
      el('small', {}, 'S/SA numbers are expanded through the engineering listing.')),
    profileArea,
    el('div.grid.material-request-fields', {},
      el('label.field', {}, el('span', {}, 'Reason'), reason),
      el('label.field', {}, el('span', {}, 'Requested by'), requestedBy)),
    reasonList,
    el('label.field', {}, el('span', {}, 'Order note'), note));

  drawProfiles();

  modal(existing ? `Material request — ${existing.die}` : 'Prepare material request', body, {
    wide: true,
    actions: [{
      label: existing ? 'Save changes' : 'Save request',
      class: 'primary',
      onClick: (dlg) => {
        if (suggestion?.invalidAssembly || suggestion?.invalidProfile) {
          toast('Resolve the extrusion number before saving');
          return;
        }
        const selected = controls.filter((control) => control.select.checked);
        if (!selected.length) {
          toast('Choose at least one extrusion component');
          return;
        }

        const rows = selected.map((control) => {
          const row = {
            id: existing?.id,
            sourceTaskKey: linked,
            sourceAssembly: existing?.sourceAssembly || suggestion.assembly?.sa || null,
            componentRole: existing?.componentRole || control.line.role,
            componentSource: existing?.componentSource || control.line.source,
            componentSourceSa: existing?.componentSourceSa || control.line.sourceSa || null,
            requestDate: existing?.requestDate || today(),
            requiredBy: requiredBy.value || null,
            workOrder: clean(wo.value),
            project: clean(project.value),
            floor: clean(floor.value),
            die: dottedDie(control.line.die),
            stockLength: cleanLength(control.length.value),
            finish: clean(control.finish.value).toUpperCase(),
            bars: control.bars.value === '' ? null : Number(control.bars.value),
            reason: clean(reason.value),
            note: clean(note.value),
            requestedBy: clean(requestedBy.value),
            createdAt: existing?.createdAt || new Date().toISOString(),
          };
          row.status = existing?.status === 'ENTERED'
            ? 'ENTERED' : orderReady(row) ? 'READY' : 'DRAFT';
          return row;
        });

        const duplicate = rows.find((row) => Object.values(state.materialOrders || {}).some((saved) =>
          saved.id !== row.id && saved.status !== 'ENTERED'
          && clean(saved.workOrder).toUpperCase() === clean(row.workOrder).toUpperCase()
          && clean(saved.die).toUpperCase() === clean(row.die).toUpperCase()
          && clean(saved.stockLength) === clean(row.stockLength)
          && clean(saved.finish).toUpperCase() === clean(row.finish).toUpperCase()));
        if (duplicate) {
          toast(`Open request already exists for ${duplicate.die}`);
          return;
        }

        saveMaterialOrders(rows);
        dlg.close();
        mode = 'orders';
        const ready = rows.filter((row) => row.status === 'READY').length;
        toast(`${rows.length} request${rows.length === 1 ? '' : 's'} saved${ready ? ` · ${ready} ready` : ' as draft'}`);
        rerender();
      },
    }],
  });
}

function excelDate(iso) {
  if (!iso) return '';
  const [year, month, day] = iso.split('-').map(Number);
  return year && month && day ? `${month}/${day}/${year}` : iso;
}

function tsvCell(value) {
  return clean(value).replace(/[\t\r\n]+/g, ' ');
}

function workbookRows(rows) {
  return rows.map((row) => [
    excelDate(row.requestDate), row.workOrder, row.project, row.floor,
    row.die, row.stockLength, row.finish, row.bars, row.reason,
  ].map(tsvCell).join('\t')).join('\n');
}

async function copyWorkbookRows(rows) {
  if (!rows.length) {
    toast('No ready requests to copy');
    return;
  }
  try {
    await navigator.clipboard.writeText(workbookRows(rows));
    toast(`${rows.length} workbook row${rows.length === 1 ? '' : 's'} copied · paste at Date`);
  } catch {
    toast('Clipboard access was blocked');
  }
}

function printOrders(rows) {
  if (!rows.length) {
    toast('No material requests to print');
    return;
  }
  const body = el('div.print-material-orders', {},
    el('table.print-table', {},
      el('thead', {}, el('tr', {},
        ...['Date', 'Work order / project', 'Floor', 'Extrusion', 'Length', 'Finish', 'Bars', 'Reason', 'Status']
          .map((label) => el('th', {}, label)))),
      el('tbody', {}, ...rows.map((row) => el('tr', {},
        el('td', {}, excelDate(row.requestDate)),
        el('td', {}, el('strong', {}, row.workOrder || '—'), el('br'), row.project || '—'),
        el('td', {}, row.floor || '—'),
        el('td.mono', {}, row.die || '—'),
        el('td', {}, row.stockLength ? `${row.stockLength}′` : '—'),
        el('td.mono', {}, row.finish || '—'),
        el('td.mono', {}, row.bars ?? '—'),
        el('td', {}, row.reason || '—', row.note ? el('small.print-subline', {}, row.note) : null),
        el('td', {}, row.status || 'DRAFT'))))));
  printDocument({
    title: 'Material Requests',
    subtitle: 'Prepared from Cutting Department shortages and manual requests',
    meta: [`${rows.length} request${rows.length === 1 ? '' : 's'}`, `Prepared by ${me()}`],
    body,
    landscape: true,
  });
}

function shortageView(rerender, go, orders) {
  if (!hasTasks()) {
    return el('section.panel', {}, el('div.empty', {},
      el('div.empty-icon', {}, icon('upload', { size: 28 })),
      el('h3', {}, 'Load the schedules to see shortages'),
      el('p', {}, 'You can still create a manual request or review saved order drafts.'),
      el('button.primary', { onclick: () => go('setup') }, 'Go to Setup')));
  }

  let groups = allBackOrders();
  if (mineOnly) groups = groups.filter((group) => group.assignee === me());

  const filter = el('div.material-subhead', {},
    el('div', {}, el('strong', {}, 'Confirmed shortages'),
      el('span', {}, 'Assign the shortage, then prepare only the extrusion that is actually needed.')),
    el('label.row.small.donetoggle', {},
      el('input', {
        type: 'checkbox', checked: mineOnly,
        onchange: (event) => { mineOnly = event.target.checked; rerender(); },
      }),
      `Only mine (${me()})`));

  if (!groups.length) {
    return el('div', {}, filter, el('section.panel', {}, el('div.empty', {},
      el('div.empty-icon', {}, icon('check', { size: 28 })),
      el('h3', {}, mineOnly ? 'Nothing assigned to you' : 'No material shortages'),
      el('p', {}, mineOnly
        ? 'Nothing is waiting on you right now.'
        : 'Nothing is flagged short of material.'))));
  }

  const sections = groups.map((group) => {
    const short = group.rows.reduce((sum, row) => sum + (row.bo.qty || 0), 0);
    const ownerKey = group.assignee || '__unassigned__';
    const expanded = expandedOwners.has(ownerKey);
    const visibleRows = expanded ? group.rows : group.rows.slice(0, 2);
    const hidden = group.rows.length - visibleRows.length;
    return el('section.dgroup.bo-group.material-shortage-group', {},
      el('div.bo-grouphead' + (group.assignee ? '' : '.none'), {},
        el('span.bo-avatar', { 'aria-hidden': 'true' },
          group.assignee ? group.assignee.slice(0, 1).toUpperCase() : '?'),
        el('span.bo-who', {}, group.assignee || 'Nobody is chasing these'),
        el('span.dgroup-count', {}, String(group.rows.length)),
        el('span.spacer'),
        short ? el('span.small.muted', {}, `${fmtNum(short)} pcs short`) : null),
      el('div.dgroup-body', {}, ...visibleRows.map(({ task, bo, machine }) => {
        const key = taskStatusKey(task);
        const prepared = orders.filter((order) => order.sourceTaskKey === key);
        return el('div.line.bo-line.is-bo.material-shortage-line', {
          onclick: () => backOrderDialog(task, rerender),
        },
          el('div.line-main', {},
            el('div.line-id', {},
              el('span.mono.strong', {}, task.wo),
              task.die ? el('span.die', {}, task.die) : null,
              chip(machineLabel(machine), 'mute'),
              prepared.length ? chip(`${prepared.length} prepared`,
                prepared.every((row) => row.status === 'ENTERED') ? 'ok' : 'work') : null),
            el('div.line-where', {},
              el('span', {}, task.project || '—'),
              task.floor ? el('span.muted', {}, ' · ' + task.floor) : null),
            bo.note ? el('div.line-bonote', {}, icon('note', { size: 13 }), el('span', {}, bo.note)) : null,
            bo.sheetShort ? el('div.line-bonote.from-sheet', {}, icon('alert', { size: 13 }),
              el('span', {}, el('span.muted', {}, 'workbook bars: '), bo.sheetShort)) : null),
          el('div.line-qty.bo-qty', {},
            bo.qty != null ? el('span.mono.bo-short', {}, fmtNum(bo.qty)) : el('span.mono.muted', {}, '—'),
            el('span.small.muted', {}, bo.qty != null ? 'pcs short' : 'pieces not counted')),
          el('div.material-shortage-actions', {},
            el('span.line-date.hide-sm', {}, fmtDate(task.cuttingDate)),
            el('button.' + (prepared.length ? 'ghost' : 'primary'), {
              onclick: (event) => {
                event.stopPropagation();
                if (prepared.length) { mode = 'orders'; rerender(); }
                else materialOrderDialog({ task }, rerender);
              },
            }, prepared.length ? 'Review order' : 'Prepare order', icon('chevron', { size: 15 }))));
      })),
      hidden || expanded && group.rows.length > 2 ? el('button.showmore.material-show-more', {
        onclick: () => {
          if (expanded) expandedOwners.delete(ownerKey);
          else expandedOwners.add(ownerKey);
          rerender();
        },
      }, expanded ? 'Show less' : `Show ${hidden} more`, icon('chevron', { size: 15 })) : null);
  });

  return el('div', {}, filter, ...sections);
}

function orderCard(order, rerender) {
  const tone = order.status === 'READY' ? 'ok' : order.status === 'ENTERED' ? 'mute' : 'warn';
  const missing = order.status === 'DRAFT' ? missingOrderFields(order) : [];
  return el(`article.material-order-card.${String(order.status || 'DRAFT').toLowerCase()}`, {},
    el('div.material-order-main', {},
      el('div.material-order-id', {},
        chip(order.status || 'DRAFT', tone),
        el('strong.mono', {}, order.die || 'No extrusion'),
        el('span.material-order-bars', {},
          el('b.mono', {}, order.bars ?? '—'), el('small', {}, 'bars'))),
      el('div.material-order-job', {},
        el('strong', {}, order.workOrder || 'No work order'),
        el('span', {}, [order.project, order.floor].filter(Boolean).join(' · ') || 'Project not set')),
      el('div.material-order-facts', {},
        el('span', {}, el('small', {}, 'Length'), el('b', {}, order.stockLength ? `${order.stockLength}′` : '—')),
        el('span', {}, el('small', {}, 'Finish'), el('b.mono', {}, order.finish || '—')),
        el('span', {}, el('small', {}, 'Reason'), el('b', {}, order.reason || '—')),
        order.requiredBy ? el('span', {}, el('small', {}, 'Needed'), el('b', {}, fmtDate(order.requiredBy))) : null),
      order.sourceAssembly ? el('div.material-order-source', {},
        icon('rollers', { size: 14 }),
        `${order.componentRole || 'Component'} from ${order.sourceAssembly}`,
        order.componentSource === 'variant' ? ` · recovered from ${order.componentSourceSa}` : '') : null,
      missing.length ? el('div.material-order-missing', {},
        icon('alert', { size: 14 }), `Complete before copying: ${missing.join(', ')}`) : null,
      order.note ? el('div.material-order-note', {}, icon('note', { size: 14 }), order.note) : null,
      el('div.small.muted.material-order-by', {},
        order.status === 'ENTERED' && order.enteredAt
          ? `Entered by ${order.enteredBy || order.by} · ${fmtWhen(order.enteredAt)}`
          : `Updated by ${order.by || order.requestedBy || 'Unassigned'} · ${fmtWhen(order.at)}`)),
    el('div.material-order-actions', {},
      el('button.ghost', { onclick: () => materialOrderDialog({ existing: order }, rerender) },
        icon('pencil', { size: 15 }), 'Edit'),
      el('button.ghost', {
        disabled: order.status === 'DRAFT',
        title: order.status === 'DRAFT' ? 'Complete the missing fields before copying' : undefined,
        onclick: () => copyWorkbookRows([order]),
      },
        icon('clipboard', { size: 15 }), 'Copy row'),
      order.status !== 'DRAFT' ? el('button.' + (order.status === 'ENTERED' ? 'ghost' : 'primary'), {
        onclick: () => {
          setMaterialOrderStatus(order.id, order.status === 'ENTERED' ? 'READY' : 'ENTERED');
          toast(order.status === 'ENTERED' ? 'Request moved back to ready' : 'Marked as entered in workbook');
          rerender();
        },
      }, icon(order.status === 'ENTERED' ? 'undo' : 'check', { size: 15 }),
      order.status === 'ENTERED' ? 'Restore' : 'Mark entered') : null,
      el('button.ghost.danger-text', {
        onclick: async () => {
          const yes = await confirmDialog('Delete material request',
            `Delete ${order.die || 'this request'} for ${order.workOrder || 'this job'}?`,
            { confirmLabel: 'Delete', danger: true });
          if (!yes) return;
          deleteMaterialOrder(order.id);
          toast('Material request deleted');
          rerender();
        },
      }, icon('x', { size: 15 }), 'Delete')));
}

function ordersView(rerender, orders) {
  const ready = orders.filter((row) => row.status === 'READY');
  const open = orders.filter((row) => row.status !== 'ENTERED');
  const controls = el('div.material-order-toolbar', {},
    el('div', {}, el('strong', {}, 'Prepared requests'),
      el('span', {}, 'Copy ready rows into the shared Material Requests workbook, then mark them entered.')),
    el('div.row', {},
      el('button.ghost', { disabled: !open.length, onclick: () => printOrders(open) },
        icon('print', { size: 16 }), 'Print open'),
      el('button.primary', { disabled: !ready.length, onclick: () => copyWorkbookRows(ready) },
        icon('clipboard', { size: 16 }), `Copy ready${ready.length ? ` (${ready.length})` : ''}`)));

  if (!orders.length) {
    return el('div', {}, controls, el('section.panel', {}, el('div.empty', {},
      el('div.empty-icon', {}, icon('clipboard', { size: 28 })),
      el('h3', {}, 'No material requests prepared'),
      el('p', {}, 'Start from a shortage, or create a request manually.'))));
  }

  return el('div', {}, controls,
    el('div.material-order-list', {}, ...orders.map((order) => orderCard(order, rerender))));
}

export function renderMaterials(rerender, go) {
  const shortages = hasTasks()
    ? allBackOrders().reduce((sum, group) => sum + group.rows.length, 0)
    : 0;
  const orders = orderRows();
  const drafts = orders.filter((row) => row.status === 'DRAFT').length;
  const ready = orders.filter((row) => row.status === 'READY').length;

  const head = el('div.centre-head.material-head', {},
    el('div.row.centre-title-row', {},
      el('div.centre-ident', {},
        el('span.centre-rail', { 'aria-hidden': 'true' }),
        el('div', {},
          el('h1.centre-title', {}, 'Materials'),
          el('div.centre-sub', {}, 'Shortages in, order-ready extrusion requests out'))),
      el('span.spacer'),
      el('button.primary.material-new', { onclick: () => materialOrderDialog({}, rerender) },
        icon('plus', { size: 17 }), 'New request'),
      el('div.centre-stats', {},
        el('div.cstat' + (shortages ? '.bad' : ''), {}, el('b', {}, fmtNum(shortages)), el('i', {}, 'shortages')),
        el('div.cstat' + (ready ? '.ok' : ''), {}, el('b', {}, fmtNum(ready)), el('i', {}, 'ready')),
        el('div.cstat' + (drafts ? '.warn' : ''), {}, el('b', {}, fmtNum(drafts)), el('i', {}, 'drafts')))),
    el('div.material-tabs', { role: 'tablist', 'aria-label': 'Materials view' },
      el('button', {
        role: 'tab', 'aria-selected': String(mode === 'shortages'),
        onclick: () => { mode = 'shortages'; rerender(); },
      }, icon('alert', { size: 16 }), 'Shortages', shortages ? el('span', {}, shortages) : null),
      el('button', {
        role: 'tab', 'aria-selected': String(mode === 'orders'),
        onclick: () => { mode = 'orders'; rerender(); },
      }, icon('clipboard', { size: 16 }), 'Order drafts', orders.length ? el('span', {}, orders.length) : null)));

  return el('div.centre.materials', {}, head,
    el('div.material-view.material-view-enter', {},
      mode === 'orders'
        ? ordersView(rerender, orders)
        : shortageView(rerender, go, orders)));
}
