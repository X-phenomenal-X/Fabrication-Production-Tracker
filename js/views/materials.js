/* Material Helper — the step between "we are short" and the department's
   Material Requests process.

   This is not purchasing. It raises no order, knows no vendor, holds no price
   and sends nothing anywhere. The shared Material Requests workbook remains
   the order record, exactly as it is today; what this page does is the part
   that currently goes wrong on the way to it — working out which real
   extrusion a shortage is actually about, and writing the four quantities down
   separately so the request is not guessed at the other end.

   Drafts live in this tab only. They are deliberately not saved and not
   synced: a purchasing-shaped record that outlives the copy-and-paste is the
   thing the department asked to be removed, and a half-owned second copy of an
   order is worse than no copy. The page says so on its face rather than
   implying durability it does not have. */

import { chip, download, el, fmtDate, fmtNum, icon, modal, printDocument, toast } from '../ui.js';
import { me } from '../store.js';
import { allBackOrders, hasTasks, machineConfig, taskStatusKey } from '../model.js';
import { MACHINE_BY_KEY } from '../machines.js';
import {
  REQUEST_REASONS, identifyMaterial, makeRequestDraft, missingRequestFields,
  provenanceLabel, requestComplete, requestCsv, workbookTsv,
} from '../material-plan.js';

/* Session-scoped, on purpose — see the file comment. */
const drafts = [];
let shortagesExpanded = false;
const SHORTAGE_PREVIEW = 4;

const text = (value) => String(value ?? '').trim();

function machineLabel(key) {
  const machine = MACHINE_BY_KEY[key];
  return machine ? machineConfig(machine).label : key || 'Unassigned';
}

/* The workbook's B/O column counts BARS and writes them as text — "3 BARS" on
   FOM 2 and FOM 3. It is not a piece count and is never used as one; it is
   offered as a starting number for the bars field and labelled as coming from
   the sheet. */
function barsFromSheet(bo) {
  const match = text(bo?.sheetShort).match(/(\d+(?:\.\d+)?)\s*BARS?/i);
  return match ? match[1] : '';
}

/* ---------- the dialog ---------- */

function provenanceChip(candidate) {
  if (candidate.provenance === 'direct') return chip('Entered directly', 'mute');
  if (candidate.provenance === 'variant') return chip('Recovered', 'warn');
  if (candidate.provenance === 'description') return chip('From description', 'warn');
  return chip('In the listing', 'ok');
}

function requestDialog({ task = null, bo = null, existing = null } = {}, rerender) {
  const workOrder = el('input', {
    value: existing?.workOrder || task?.wo || '', placeholder: 'Work order',
    'aria-label': 'Work order',
  });
  const project = el('input', {
    value: existing?.project || task?.project || '', placeholder: 'Project',
    'aria-label': 'Project',
  });
  const floor = el('input', {
    value: existing?.floor || task?.floor || '', placeholder: 'Floor or area',
    'aria-label': 'Floor or area',
  });
  const requiredBy = el('input', {
    type: 'date', value: existing?.requiredBy || task?.cuttingDate || '',
    'aria-label': 'Needed by',
  });

  const source = el('input', {
    value: existing?.scheduledAs || task?.die || '',
    placeholder: 'S80.104 or 80.113',
    'aria-label': 'Die or extrusion from the schedule',
  });

  const piecesShort = el('input', {
    type: 'number', min: '0', step: '1', inputmode: 'numeric',
    value: existing?.piecesShort ?? bo?.qty ?? '', placeholder: '0',
    'aria-label': 'Finished pieces short',
  });
  const bars = el('input', {
    type: 'number', min: '0', step: '1', inputmode: 'numeric',
    value: existing?.bars ?? barsFromSheet(bo), placeholder: '0',
    'aria-label': 'Bars to request',
  });
  const stockLength = el('input', {
    type: 'text', inputmode: 'decimal', value: existing?.stockLength || '',
    placeholder: '18', 'aria-label': 'Stock length in feet',
  });
  const finish = el('input', {
    value: existing?.finish || '', placeholder: 'K11704', 'aria-label': 'Finish or colour',
  });

  const reason = el('input', {
    value: existing?.reason || REQUEST_REASONS[0], list: 'material-reasons',
    placeholder: 'Reason code', 'aria-label': 'Reason',
  });
  const requestedBy = el('input', {
    value: existing?.requestedBy || me(), placeholder: 'Name', 'aria-label': 'Requested by',
  });
  const note = el('textarea', {
    value: existing?.note || bo?.note || '', rows: '2',
    placeholder: 'Interior only, replacement, supplier note…', 'aria-label': 'Note',
  });

  const area = el('div.mh-identify', { 'aria-live': 'polite' });
  let identified = identifyMaterial(source.value);
  let chosenKey = existing?.die
    ? identified.candidates.find((candidate) => candidate.die === existing.die)?.key || null
    : null;

  const chosenCandidate = () => identified.candidates.find((item) => item.key === chosenKey) || null;

  let resolvedFrom = null;

  function drawIdentity() {
    resolvedFrom = source.value;
    identified = identifyMaterial(source.value);
    if (!identified.candidates.some((candidate) => candidate.key === chosenKey)) {
      // One candidate is not a choice, so it does not need to be made.
      chosenKey = identified.candidates.length === 1 ? identified.candidates[0].key : null;
    }
    area.replaceChildren(...identityNodes());
  }

  /* Only when the number actually changed. Re-resolving on every blur tore the
     candidate list down as the operator reached for it: leaving the field to
     tap a candidate fires blur first, the list is rebuilt, and the tap lands on
     a node that is no longer in the document. */
  function refreshIdentity() {
    if (source.value !== resolvedFrom) drawIdentity();
  }

  function identityNodes() {
    if (identified.blocked) {
      return [el('div.banner.bad.mh-guardrail', { role: 'alert' },
        icon('alert', { size: 18 }),
        el('div', {}, el('strong', {}, identified.title), ' ', identified.detail))];
    }

    const nodes = [];
    if (identified.kind === 'assembly') {
      nodes.push(el('div.mh-assembly', {},
        el('div', {},
          el('span.mh-eyebrow', {}, 'Rolled sub-assembly'),
          el('strong.mono', {}, identified.assembly.sa),
          el('span.mh-assembly-desc', {}, identified.assembly.desc || 'Section Book listing')),
        chip(`${identified.candidates.length} extrusion${identified.candidates.length === 1 ? '' : 's'}`, 'work')));
      nodes.push(el('div.banner.info.mh-guardrail', {},
        icon('extrusion', { size: 18 }),
        el('div', {},
          el('strong', {}, 'Pick the extrusion that is actually short. '),
          'The sub-assembly number is not an orderable part and never leaves this page.')));
      if (identified.coverage?.missingRoles?.length) {
        nodes.push(el('div.banner.warn.mh-guardrail', {},
          icon('alert', { size: 18 }),
          el('div', {},
            el('strong', {}, 'This listing row is incomplete: '),
            `no ${identified.coverage.missingRoles.join(', ')}. `,
            'Check the drawing if the short part is one of those.')));
      }
    }

    const list = el('div.mh-candidates', { role: 'radiogroup', 'aria-label': 'Extrusion that is short' },
      ...identified.candidates.map((candidate) => {
        const on = candidate.key === chosenKey;
        return el(`button.mh-candidate${on ? '.on' : ''}${candidate.verified ? '' : '.unverified'}`, {
          type: 'button', role: 'radio', 'aria-checked': String(on),
          onclick: () => { chosenKey = candidate.key; drawIdentity(); },
        },
          el('span.mh-candidate-mark', { 'aria-hidden': 'true' },
            icon(on ? 'check' : 'dot', { size: 15 })),
          el('span.mh-candidate-copy', {},
            el('span.mh-candidate-id', {},
              el('b.mono', {}, candidate.die),
              el('span.mh-candidate-role', {}, candidate.role),
              provenanceChip(candidate)),
            el('small', {}, provenanceLabel(candidate))));
      }));
    nodes.push(list);

    const chosen = chosenCandidate();
    if (chosen && !chosen.verified) {
      nodes.push(el('div.banner.warn.mh-guardrail', { role: 'status' },
        icon('alert', { size: 18 }),
        el('div', {},
          el('strong', {}, 'This number is a cross-reference, not a printed value. '),
          'Confirm it against the drawing before the request is entered. '
          + 'It is marked as recovered wherever this request is printed or exported.')));
    }
    if (identified.references?.length) {
      nodes.push(el('div.small.muted.mh-references', {},
        'The listing text also mentions ',
        el('b.mono', {}, identified.references.map((item) => item.die).join(', ')),
        '. The source does not say what those parts are, so they are not offered as choices.'));
    }
    return nodes;
  }

  source.addEventListener('change', refreshIdentity);
  source.addEventListener('blur', refreshIdentity);
  drawIdentity();

  const body = el('div.mh-form', {},
    el('div.grid.mh-job', {},
      el('label.field', {}, el('span', {}, 'Work order'), workOrder),
      el('label.field', {}, el('span', {}, 'Project'), project),
      el('label.field', {}, el('span', {}, 'Floor or area'), floor),
      el('label.field', {}, el('span', {}, 'Needed by'), requiredBy)),

    el('label.field.mh-source', {},
      el('span', {}, 'Die or extrusion on the schedule'), source,
      el('small', {}, 'An S or SA number is expanded through the Section Book. '
        + 'The number you order is chosen below.')),
    area,

    /* Four numbers, four fields. See material-plan.js — collapsing any pair of
       these is the mistake this whole page exists to prevent. */
    el('div.grid.mh-quantities', {},
      el('label.field', {}, el('span', {}, 'Pieces short'), piecesShort),
      el('label.field', {}, el('span', {}, 'Bars to request'), bars),
      el('label.field', {}, el('span', {}, 'Stock length · ft'), stockLength),
      el('label.field', {}, el('span', {}, 'Finish or colour'), finish)),

    el('div.grid.mh-request', {},
      el('label.field', {}, el('span', {}, 'Reason'), reason),
      el('label.field', {}, el('span', {}, 'Requested by'), requestedBy)),
    el('datalist', { id: 'material-reasons' },
      ...REQUEST_REASONS.map((value) => el('option', { value }))),
    el('label.field', {}, el('span', {}, 'Note'), note));

  modal(existing ? `Request — ${existing.die}` : 'Identify material', body, {
    wide: true,
    actions: [{
      label: existing ? 'Save changes' : 'Add request',
      class: 'primary',
      onClick: (dlg) => {
        if (identified.blocked) {
          toast('Resolve the die before adding a request');
          return;
        }
        const candidate = chosenCandidate();
        if (!candidate) {
          toast('Choose the extrusion that is actually short');
          return;
        }
        const draft = makeRequestDraft({
          job: {
            taskKey: existing?.sourceTaskKey || (task ? taskStatusKey(task) : null),
            workOrder: workOrder.value,
            project: project.value,
            floor: floor.value,
            requiredBy: requiredBy.value,
          },
          identified,
          candidate,
          quantities: {
            piecesShort: piecesShort.value,
            bars: bars.value,
            stockLength: stockLength.value,
            finish: finish.value,
          },
          request: { reason: reason.value, requestedBy: requestedBy.value, note: note.value },
        });

        if (existing) {
          const at = drafts.findIndex((row) => row.id === existing.id);
          drafts.splice(at, 1, { ...draft, id: existing.id, preparedAt: existing.preparedAt });
        } else {
          drafts.unshift(draft);
        }
        dlg.close();
        toast(requestComplete(draft)
          ? `${draft.die} ready to copy`
          : `${draft.die} added — ${missingRequestFields(draft).join(', ')} still needed`);
        rerender();
      },
    }],
  });
}

/* ---------- what leaves the app ---------- */

async function copyRows(rows) {
  if (!rows.length) {
    toast('No complete requests to copy');
    return;
  }
  try {
    await navigator.clipboard.writeText(workbookTsv(rows));
    toast(`${rows.length} workbook row${rows.length === 1 ? '' : 's'} copied — paste at the Date column`);
  } catch {
    toast('Clipboard access was blocked');
  }
}

function exportRows(rows) {
  if (!rows.length) {
    toast('Nothing to export');
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  download(`material-requests-${stamp}.csv`, requestCsv(rows), 'text/csv');
  toast(`${rows.length} request${rows.length === 1 ? '' : 's'} exported`);
}

function printRows(rows) {
  if (!rows.length) {
    toast('Nothing to print');
    return;
  }
  const body = el('div.print-material-requests', {},
    el('p.print-note', {},
      'Prepared in the Cutting tracker for the Material Requests process. '
      + 'This sheet is not an order.'),
    el('table.print-table', {},
      el('thead', {}, el('tr', {}, ...[
        'Work order / project', 'Extrusion', 'Scheduled as', 'Pieces short',
        'Bars', 'Length', 'Finish', 'Needed by', 'Reason',
      ].map((label) => el('th', {}, label)))),
      el('tbody', {}, ...rows.map((row) => el('tr', {},
        el('td', {}, el('strong', {}, row.workOrder || '—'), el('br'),
          row.project || '—', row.floor ? ` · ${row.floor}` : ''),
        el('td.mono', {}, row.die,
          el('small.print-subline', {}, `${row.role} · ${provenanceLabel(row)}`)),
        el('td.mono', {}, row.scheduledAs || '—'),
        el('td.mono', {}, row.piecesShort ?? '—'),
        el('td.mono', {}, row.bars ?? '—'),
        el('td.mono', {}, row.stockLength ? `${row.stockLength}′` : '—'),
        el('td.mono', {}, row.finish || '—'),
        el('td', {}, row.requiredBy ? fmtDate(row.requiredBy) : '—'),
        el('td', {}, row.reason || '—',
          row.note ? el('small.print-subline', {}, row.note) : null,
          requestComplete(row) ? null
            : el('small.print-subline', {}, `Incomplete: ${missingRequestFields(row).join(', ')}`)))))));

  printDocument({
    title: 'Material requests',
    subtitle: 'Identified extrusions prepared from confirmed shortages',
    meta: [`${rows.length} request${rows.length === 1 ? '' : 's'}`, `Prepared by ${me()}`],
    body,
    landscape: true,
  });
}

/* ---------- the page ---------- */

function shortageLine(row, rerender) {
  const { task, bo, machine } = row;
  const prepared = drafts.filter((draft) => draft.sourceTaskKey === taskStatusKey(task));
  return el('div.mh-shortage', {},
    el('div.mh-shortage-main', {},
      el('div.mh-shortage-id', {},
        el('span.mono.strong', {}, task.wo),
        task.die ? el('span.die', {}, task.die) : null,
        chip(machineLabel(machine), 'mute'),
        prepared.length ? chip(`${prepared.length} prepared`, 'ok') : null),
      el('div.mh-shortage-where', {},
        el('span', {}, task.project || '—'),
        task.floor ? el('span.muted', {}, ` · ${task.floor}`) : null),
      bo.note ? el('div.mh-shortage-note', {}, icon('note', { size: 13 }), el('span', {}, bo.note)) : null,
      bo.sheetShort ? el('div.mh-shortage-note.from-sheet', {}, icon('alert', { size: 13 }),
        el('span', {}, el('span.muted', {}, 'workbook bars: '), bo.sheetShort)) : null),
    el('div.mh-shortage-qty', {},
      bo.qty != null ? el('b.mono', {}, fmtNum(bo.qty)) : el('b.mono.muted', {}, '—'),
      el('small', {}, bo.qty != null ? 'pcs short' : 'not counted')),
    el('div.mh-shortage-when', {}, fmtDate(task.cuttingDate)),
    el('button.mh-shortage-go', {
      onclick: () => requestDialog({ task, bo }, rerender),
    }, 'Identify', icon('chevron', { size: 15 })));
}

function shortagesPanel(rerender, go) {
  if (!hasTasks()) {
    return el('section.panel.mh-panel', {},
      el('header', {}, el('h2', {}, 'Confirmed shortages')),
      el('div.empty', {},
        el('div.empty-icon', {}, icon('upload', { size: 26 })),
        el('h3', {}, 'No schedule loaded'),
        el('p', {}, 'Import the machine workbooks to start from a real shortage, '
          + 'or prepare a request by hand.'),
        el('button.primary', { onclick: () => go('setup') }, 'Go to Setup')));
  }

  const rows = allBackOrders().flatMap((group) => group.rows);
  if (!rows.length) {
    return el('section.panel.mh-panel', {},
      el('header', {}, el('h2', {}, 'Confirmed shortages')),
      el('div.empty', {},
        el('div.empty-icon', {}, icon('check', { size: 26 })),
        el('h3', {}, 'Nothing is flagged short'),
        el('p', {}, 'Requests can still be prepared by hand.')));
  }

  rows.sort((a, b) => (a.task.cuttingDate || '9999').localeCompare(b.task.cuttingDate || '9999'));
  const shown = shortagesExpanded ? rows : rows.slice(0, SHORTAGE_PREVIEW);
  const hidden = rows.length - shown.length;

  return el('section.panel.mh-panel', {},
    el('header', {},
      el('h2', {}, 'Confirmed shortages'),
      el('span.spacer'),
      el('span.dgroup-count', {}, String(rows.length))),
    el('div.body.flush.mh-shortages', {}, ...shown.map((row) => shortageLine(row, rerender))),
    hidden || shortagesExpanded ? el('button.showmore', {
      onclick: () => { shortagesExpanded = !shortagesExpanded; rerender(); },
    }, shortagesExpanded ? 'Show fewer' : `Show ${hidden} more`, icon('chevron', { size: 15 })) : null);
}

function draftCard(draft, rerender) {
  const missing = missingRequestFields(draft);
  const fact = (label, value, tone = '') => el(`div.mh-fact${tone ? '.' + tone : ''}`, {},
    el('small', {}, label), el('b.mono', {}, value));

  return el(`article.mh-draft${missing.length ? '.incomplete' : ''}`, {},
    el('div.mh-draft-head', {},
      el('div.mh-draft-id', {},
        el('strong.mono', {}, draft.die),
        el('span.mh-draft-role', {}, draft.role)),
      chip(missing.length ? 'Incomplete' : 'Ready to copy', missing.length ? 'warn' : 'ok')),

    el('div.mh-draft-job', {},
      el('strong', {}, draft.workOrder || 'No work order'),
      el('span', {}, [draft.project, draft.floor].filter(Boolean).join(' · ') || 'No project')),

    el('div.mh-draft-facts', {},
      fact('Pieces short', draft.piecesShort ?? '—'),
      fact('Bars', draft.bars ?? '—'),
      fact('Length', draft.stockLength ? `${draft.stockLength}′` : '—'),
      fact('Needed by', draft.requiredBy ? fmtDate(draft.requiredBy) : '—'),
      fact('Finish', draft.finish || '—')),

    el(`div.mh-draft-source${draft.verified ? '' : '.unverified'}`, {},
      icon(draft.verified ? 'extrusion' : 'alert', { size: 14 }),
      el('span', {}, draft.sourceAssembly
        ? `${draft.role} of ${draft.sourceAssembly} — ${provenanceLabel(draft)}`
        : provenanceLabel(draft))),

    draft.note ? el('div.mh-draft-note', {}, icon('note', { size: 14 }), el('span', {}, draft.note)) : null,
    missing.length ? el('div.mh-draft-missing', {},
      icon('alert', { size: 14 }), `Still needed: ${missing.join(', ')}`) : null,

    el('div.mh-draft-actions', {},
      el('button.ghost', { onclick: () => requestDialog({ existing: draft }, rerender) },
        icon('pencil', { size: 15 }), 'Edit'),
      el('button.ghost', {
        disabled: !!missing.length,
        title: missing.length ? 'Complete the request before copying its row' : undefined,
        onclick: () => copyRows([draft]),
      }, icon('clipboard', { size: 15 }), 'Copy row'),
      el('button.ghost.danger-text', {
        onclick: () => {
          const at = drafts.findIndex((row) => row.id === draft.id);
          if (at >= 0) drafts.splice(at, 1);
          toast(`${draft.die} removed`);
          rerender();
        },
      }, icon('x', { size: 15 }), 'Remove')));
}

function draftsPanel(rerender) {
  const ready = drafts.filter(requestComplete);
  return el('section.panel.mh-panel', {},
    el('header', {},
      el('h2', {}, 'Prepared requests'),
      el('span.spacer'),
      el('div.row.mh-draft-tools', {},
        el('button.ghost.sm', { disabled: !drafts.length, onclick: () => printRows(drafts) },
          icon('print', { size: 15 }), 'Print'),
        el('button.ghost.sm', { disabled: !drafts.length, onclick: () => exportRows(drafts) },
          icon('download', { size: 15 }), 'Export'),
        el('button.primary.sm', { disabled: !ready.length, onclick: () => copyRows(ready) },
          icon('clipboard', { size: 15 }), `Copy rows${ready.length ? ` (${ready.length})` : ''}`))),
    drafts.length
      ? el('div.body.mh-drafts', {}, ...drafts.map((draft) => draftCard(draft, rerender)))
      : el('div.empty', {},
          el('div.empty-icon', {}, icon('clipboard', { size: 26 })),
          el('h3', {}, 'Nothing prepared yet'),
          el('p', {}, 'Start from a shortage above, or prepare a request by hand.')));
}

export function renderMaterialHelper(rerender, go) {
  const shortages = hasTasks()
    ? allBackOrders().reduce((sum, group) => sum + group.rows.length, 0)
    : 0;
  const ready = drafts.filter(requestComplete).length;

  const head = el('div.centre-head.mh-head', {},
    el('div.row.centre-title-row', {},
      el('div.centre-ident', {},
        el('span.centre-rail', { 'aria-hidden': 'true' }),
        el('div', {},
          el('h1.centre-title', {}, 'Material Helper'),
          el('div.centre-sub', {}, 'A confirmed shortage in — the extrusion that is actually short out'))),
      el('span.spacer'),
      el('button.primary.mh-new', { onclick: () => requestDialog({}, rerender) },
        icon('plus', { size: 17 }), 'Request by hand'),
      el('div.centre-stats', {},
        el('div.cstat' + (shortages ? '.bad' : ''), {}, el('b', {}, fmtNum(shortages)), el('i', {}, 'shortages')),
        el('div.cstat', {}, el('b', {}, fmtNum(drafts.length)), el('i', {}, 'prepared')),
        el('div.cstat' + (ready ? '.ok' : ''), {}, el('b', {}, fmtNum(ready)), el('i', {}, 'ready')))));

  /* Said on the page rather than in a note somewhere, because both halves are
     easy to assume wrongly: that this orders something, and that it remembers. */
  const scope = el('div.banner.info.mh-scope', {},
    icon('alert', { size: 18 }),
    el('div', {},
      el('strong', {}, 'This prepares a request; it does not order anything. '),
      'The shared Material Requests workbook stays the order record. Drafts live in '
      + 'this tab only — they are not saved or synced, so copy, print or export '
      + 'before you close it.'));

  return el('div.centre.mh', {}, head, scope,
    shortagesPanel(rerender, go),
    draftsPanel(rerender));
}
