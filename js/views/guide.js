/* The guide — the department's written process. Editable in the app so it stays
   current instead of rotting in a binder.

   The seed documents below are scaffolding built from the vocabulary in the
   Daily Schedule. They are a starting point for the department to correct, not
   an authority on how the shop runs. Anything the app could not know is marked
   with TODO so it is obvious what still needs a human. */

import { el, chip, fmtWhen, renderDoc, toast, confirmDialog, modal } from '../ui.js';
import { state, saveGuideDoc, deleteGuideDoc, me } from '../store.js';

export const SEED_DOCS = [
  {
    id: 'seed-statuses',
    title: 'Status codes — what they mean',
    order: 10,
    body: `These are the codes used in the Daily Schedule. The app normalises spelling
variants automatically (for example \`I.P\` is read as \`IP\`).

## Cut status (column CUT)
- **OK** — cutting complete for this order
- **IP** — in progress, started but not finished
- **ROLLING** — on the roll former
- **ROLLED** — roll forming finished
- **BO** — back order, cannot complete
- **NR** — not received
- **N/A** — does not apply to this order

## Material status (column purch)
- **Pulled** — material is pulled and staged, ready to cut
- **STOCK OK** — stock on hand, still needs pulling
- **@ PAINT** — out at paint, not available yet
- **ON ORDER** — purchased, not arrived
- **EXT DUE** — extrusion due in
- **TBD** — not yet determined

Anything in **ON ORDER**, **EXT DUE** or **TBD** shows as *Blocked* on the board,
because cutting cannot start without material.

### TODO for the department
- Confirm whether **ROLLED** counts as finished for scheduling purposes
- Confirm who is allowed to change an order to **BO**`,
  },
  {
    id: 'seed-operations',
    title: 'Cutting operations',
    order: 20,
    body: `Each order carries a piece count per operation. The app tracks how many
of those pieces are actually done — the spreadsheet only ever held the target.

## Operations with piece counts
- **HTS** — heights (sub-header: VERT. CUT)
- **WIDTHS** — (sub-header: VERT. CNC)
- **PUNCH**
- **VYNL.S** — vinyl strips
- **SP.S**
- **LVRS/TC PAN** — louvres / TC panel
- **VENT**
- **WW CNC** — window wall CNC
- **SLD ROLLING** — slider rolling
- **SLD CUTTING** — slider cutting
- **ADAPTORS CNC**

## Operations tracked as a status
- **BD Prep**
- **MTL STATUS**

## Not tracked here
- **CP CUTTING** (C CHANNEL / PANEL) — panel work, another department
- Panel-only orders are left out of the import entirely

**LVRS/TC PAN** is kept despite the name: louvres are Cutting's work.

### TODO for the department
- Add the machine or station that each operation runs on
- Add typical run rate per operation so the planner can estimate a shift`,
  },
  {
    id: 'seed-machines',
    title: 'Work centres and routing',
    order: 25,
    body: `Taken from the Shift Assignment, FOM and TARGETS sheets. Operator counts are
the usual full-shift crewing (week of Aug 12) — edit as they change.

## Rolling
- **Rolling (Auto)** — Etas line, 4 operators
- **Rolling (Manual)** — Iota line, 2 operators

## FOM
- **FOM 1** — 8900 + screen
- **FOM 2** — widths
- **FOM 3** — vents + widths

## CNC
- **CNC 1**, **CNC 2**, **CNC 3**, **CNC 140**

## Saws and punch
- **Elumatec Saw #1**, **Elumatec Saw #2**
- **Multi Punch** — counted in pieces, not frames

## Prep
- **Prep** — the BD Prep step

Notching, Saws #1/#3/#4/#5 and Proline are not tracked here.

## Product routing
- **Window wall** → Rolling, Elumatec Saw, FOM 2, Multi Punch, CNC
- **Vents** → Rolling, FOM 3
- **Doors** → Rolling, FOM 1, CNC

### TODO for the department
- Confirm the routing above still matches how work is released
- Add the usual operator count for **Prep** (not in the Shift Assignment sheet)
- Add cycle times per work centre so the planner can size a shift`,
  },
  {
    id: 'seed-rolling-setup',
    title: 'Rolling setup and changeovers',
    order: 26,
    body: `The rolling schedule is driven by **SA DIE#**, and each die maps to a setup
in the Rolling Set Up Chart.

## How a setup is identified
Setup number is **knurling setup - crimping setup**, for example \`11-1\`.

- \`S80.104\`, \`S80.105\`, \`S80.321\`, \`S80.333\`, \`S80.328\`, \`S80.179\` — INT 80.104 / 80.143 / 80.205 family, setup **11-1**
- \`S80.347\`, \`S80.346\` — setup **11-2**
- \`S80.278\`, \`S80.339\` — setup **12-1**

## Why it matters for scheduling
Orders sharing a setup should be run together. Every change of setup number is a
changeover, and changeovers are the main cost on the rolling line.

### TODO for the department
- Paste the full setup chart in here, or note where the master copy lives
- Record how long a changeover actually takes between each setup pair`,
  },
  {
    id: 'seed-shifts',
    title: 'Shifts and handover',
    order: 30,
    body: `## Shift pattern
- **Day** and **Afternoon** run full operations
- **Midnight** runs a 3-person crew — single-station work only

## Handover rules
1. Log piece counts on the board as work is completed, not at the end of the shift
2. Post a shift update before leaving, even on a quiet shift
3. Anything started but unfinished goes in **Carrying over**
4. Breakdowns and missing material go in **Issues** so they are visible on Today

### TODO for the department
- Confirm exact shift start and end times (the app assumes 07:00 / 15:00 / 23:00)
- Name who is responsible for posting the update on each shift`,
  },
  {
    id: 'seed-schedule',
    title: 'Working with the Daily Schedule file',
    order: 40,
    body: `The company issues the Daily Schedule as \`Daily_Schedule_<date>_Rev_<x>.xlsx\`.
This app does not replace that file — it reads it.

## When a new revision comes out
1. Open **Data & Import**
2. Drop the new workbook in
3. Review the change list — new orders, moved ship dates, changed cut status
4. Progress already logged in the app is kept; only the schedule is replaced

## What the app reads
- **Daily Sched** — the orders and the cutting columns
- **WIP** — the ERP export, for remaining quantities
- **PREP Tracker** — job level, project manager, last floor completed
- **screens sch** — screens

Rows that are section banners (\`IN CUTTING\`, \`MAT'L REQUIRED\`, \`WINDOW WALL\`)
are read as headings, not orders. Repeated header rows and separators are ignored.

### TODO for the department
- Note who issues the revision and how often`,
  },
];

function editor(doc, rerender) {
  const title = el('input', { value: doc?.title || '', placeholder: 'Section title' });
  const body = el('textarea', {
    value: doc?.body || '',
    style: { minHeight: '340px', fontFamily: 'var(--mono)', fontSize: '13px' },
    placeholder: '## Heading\n- bullet\n**bold** and `code`',
  });

  modal(doc ? 'Edit section' : 'New section',
    el('div', {},
      el('label.field', { style: { marginBottom: '12px' } }, el('span', {}, 'Title'), title),
      el('label.field', {}, el('span', {}, 'Content — headings with ##, bullets with -'), body)),
    {
      wide: true,
      actions: [
        doc ? {
          label: 'Delete', class: 'danger', onClick: async (dlg) => {
            if (await confirmDialog('Delete section?', `"${doc.title}" will be removed for everyone.`,
              { confirmLabel: 'Delete', danger: true })) {
              deleteGuideDoc(doc.id); dlg.close(); rerender();
            }
          }
        } : null,
        {
          label: 'Save', class: 'primary', onClick: (dlg) => {
            if (!title.value.trim()) { toast('Give the section a title.'); return; }
            saveGuideDoc({
              id: doc?.id, title: title.value.trim(), body: body.value,
              order: doc?.order ?? 100,
            });
            toast('Saved');
            dlg.close();
            rerender();
          }
        },
      ].filter(Boolean),
    });
}

export function renderGuide(rerender) {
  const docs = Object.values(state.guide)
    .filter((d) => d && !d.deleted)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || String(a.title).localeCompare(String(b.title)));

  const head = el('div.panel', {},
    el('div.body', {},
      el('div.row', {},
        el('div', {},
          el('div', { style: { fontWeight: '700', fontSize: '16px' } }, 'Department guide'),
          el('div.small.muted', {}, 'How we work. Anyone can edit — every change is stamped with who and when.')),
        el('span.spacer'),
        el('button.primary', { onclick: () => editor(null, rerender) }, '+ New section'))));

  if (!docs.length) {
    return el('div', {}, head, el('div.panel', {},
      el('div.empty', {},
        el('h3', {}, 'The guide is empty'),
        el('div', {}, 'Restore the starter sections from Data & Import, or add your own.'))));
  }

  const toc = el('div.panel', {},
    el('header', {}, 'Contents'),
    el('ul.list', {}, ...docs.map((d) => el('li', {
      style: { cursor: 'pointer' },
      onclick: () => document.getElementById('doc-' + d.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    }, d.title))));

  const bodies = docs.map((d) => el('div.panel', { id: 'doc-' + d.id },
    el('header', {}, d.title,
      el('span.spacer'),
      el('span.small.muted.hide-sm', {}, `${d.by || 'seed'} · ${fmtWhen(d.at)}`),
      el('button.sm.ghost', { onclick: () => editor(d, rerender) }, 'Edit')),
    el('div.body', {}, el('div.doc', { html: renderDoc(d.body) }))));

  return el('div', {}, head,
    el('div.grid', { style: { gridTemplateColumns: 'minmax(200px,240px) 1fr', marginTop: '16px', alignItems: 'start' } },
      toc, el('div', {}, ...bodies)));
}
