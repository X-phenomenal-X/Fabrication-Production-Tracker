/* Shift Update — write one, and read the ones already written.

   Laid out the way the department's own sheet is: one block per machine with
   #Ops, work done / in progress, what is next, and notes. Grouped by centre so
   Rolling, FOM, CNC and Multi Punch are visually separate rather than one long
   list, with the department's standing rows at the top exactly as they sit on
   the sheet. Back Order leads, since it is the one reported every shift;
   Service Orders and K1285 Pulls fold behind a link and open themselves when
   they already carry something.

   Two things make it quick to fill in. The machine's entry from the imported
   workbook can be pulled in whole or a line at a time, and any line whose
   status was moved during the shift is offered as a one-click insert — so the
   update is mostly assembled from what the app already saw happen. */

import {
  el, chip, icon, fmtDate, fmtWhen, toast, confirmDialog,
} from '../ui.js';
import { state, saveShiftLog, deleteShiftLog, me } from '../store.js';
import {
  today, hasTasks, machineConfig, shiftUpdateFor, workInShift, shiftUpdateAge,
  inProgressLines,
} from '../model.js';
import { machinesByGroup, STANDING_ROWS } from '../machines.js';
import { SHIFTS, SHIFT_ORDER, shiftAt } from '../shifts.js';

/* Centres in the order the sheet prints them. Only these four are tracked,
   so only these four are reported on. */
const CENTRES = [
  ['Rolling', 'Rolling'],
  ['FOM', 'FOM'],
  ['CNC', 'CNC & FMC'],
  ['Punch', 'Multi Punch'],
];

const FIELDS = [
  ['done', 'Work done / in progress'],
  ['next', 'Next in schedule'],
  ['notes', 'Notes'],
];

const view = { date: today(), shift: shiftAt(), mode: 'write' };

/* Edits live here until saved, so typing in one box never triggers a re-render
   that would steal focus from it. Changing date or shift drops the draft. */
let draft = null;
let draftKey = null;

function logKey(date, shift) {
  return `${date}|${shift}`;
}

function currentLog() {
  return state.shiftLogs?.[logKey(view.date, view.shift)] || null;
}

function loadDraft() {
  const key = logKey(view.date, view.shift);
  if (draftKey === key && draft) return draft;
  const saved = currentLog();
  draftKey = key;
  draft = {
    rows: JSON.parse(JSON.stringify(saved?.rows || {})),
    notes: saved?.notes || '',
  };
  return draft;
}

function dropDraft() {
  draft = null;
  draftKey = null;
}

function rowFor(key) {
  const d = loadDraft();
  if (!d.rows[key]) d.rows[key] = { ops: '', done: '', next: '', notes: '' };
  return d.rows[key];
}

function hasContent(r) {
  return !!(r && (r.done || r.next || r.notes || r.ops));
}

/* The department's own printed sheet now carries only one standing row, Back
   Order — Service Orders and K1285 Pulls were dropped from it. They still get
   reported occasionally, so they stay available but folded away rather than
   taking two of the three slots at the top of the page. */
const PRIMARY_STANDING = new Set(['backorder']);

let showExtraStanding = false;

/** Every reportable row on the page: the standing rows first, then the
    machines of each tracked centre, minus anything hidden in Setup. */
function sections() {
  const byGroup = machinesByGroup();
  const standing = STANDING_ROWS
    .map((r) => ({ ...r, standing: true, secondary: !PRIMARY_STANDING.has(r.key) }))
    .sort((a, b) => a.secondary - b.secondary);
  const out = [{
    label: 'Department',
    hint: 'Reported every shift',
    rows: standing,
  }];

  for (const [group, label] of CENTRES) {
    // The CNC & FMC holding queue is not a machine anyone stands at, so it is
    // not something to report a shift on.
    const rows = (byGroup.get(group) || [])
      .filter((m) => !m.queue).map(machineConfig).filter((m) => !m.hidden);
    if (rows.length) out.push({ label, rows });
  }
  return out;
}

/* ---------- writing ---------- */

/** One-click inserts: what this shift actually moved in the tracker, and what
    the imported workbook already says about this machine. */
function suggestions(row, entry, rerender) {
  const add = (field, text) => {
    const cur = row[field] || '';
    if (cur.split('\n').some((l) => l.trim() === text.trim())) return false;
    row[field] = cur ? `${cur}\n${text}` : text;
    return true;
  };

  const has = (field, text) => (row[field] || '')
    .split('\n').some((l) => l.trim() === text.trim());

  const group = (label, field, items, cls = '') => (items.length
    ? el('div.sug' + cls, {},
        el('span.sug-label', {}, label),
        el('div.sug-items', {}, ...items.map((text) => {
          // Suggestions already written into the box stay visible but read as
          // spent, so it is obvious what is left to pick up.
          const used = has(field, text);
          return el('button.sug-chip' + (used ? '.used' : ''), {
            type: 'button',
            title: used ? 'Already in the update' : 'Add to ' + FIELDS.find(([f]) => f === field)[1],
            onclick: () => { if (add(field, text)) rerender(); },
          }, icon('check', { size: 10 }), text);
        })))
    : null);

  const tracked = entry.tracked || [];
  const running = entry.running || [];
  const sheet = entry.sheet;

  // Date the workbook suggestions: they are a snapshot from whenever the file
  // was last saved, and offering them unlabelled next to this shift's own
  // tracked work invites pasting yesterday's report into today's.
  const age = sheet ? shiftUpdateAge(sheet.date) : null;
  const from = sheet
    ? `From the workbook${sheet.date ? ` · ${fmtDate(sheet.date)}${age && age.days ? ` (${age.label})` : ''}` : ''}`
    : '';

  // Two sources, and they are not equally trustworthy. What the tracker watched
  // happen during *this* shift is fact; the workbook block is a snapshot from
  // whenever the file was last saved and may be days old. They are kept in
  // separate blocks, each saying where it came from, so nobody pastes last
  // Wednesday's schedule into tonight's update.
  const live = tracked.length
    ? el('div.sugblock.live', {},
        el('div.sugblock-head', {},
          icon('check', { size: 13 }),
          el('span', {}, 'What this shift moved'),
          el('span.sugblock-count', {}, String(tracked.length))),
        group('Add to work done', 'done', tracked))
    : null;

  /* What the schedules say is in process on this machine right now, whoever
     set it and whenever. Distinct from the block above, which is only what
     moved inside this shift's hours as recorded here — until everyone is using
     the app that block is thin, while the workbook's own IP marks are not. */
  const nowRunning = running.length
    ? el('div.sugblock.running', {},
        el('div.sugblock-head', {},
          icon('play', { size: 12 }),
          el('span', {}, 'In process now'),
          el('span.sugblock-count', {}, String(running.length))),
        group('Add to work done', 'done', running))
    : null;

  const fromSheet = sheet && ((sheet.done || []).length || (sheet.next || []).length || (sheet.notes || []).length)
    ? el('div.sugblock.sheet', {},
        el('div.sugblock-head', {},
          icon('note', { size: 13 }),
          el('span', {}, from || 'From the workbook'),
          age && age.days ? chip(age.label, age.tone) : null),
        group('Work done', 'done', sheet.done || []),
        group('Next in schedule', 'next', sheet.next || []),
        group('Notes', 'notes', sheet.notes || []))
    : null;

  if (!live && !nowRunning && !fromSheet) return null;
  return el('div.sugs', {}, live, nowRunning, fromSheet);
}

/** The tracker's own record of what moved, phrased the way the sheet is. */
function trackedLines(machineKey) {
  if (!machineKey) return [];
  return workInShift(machineKey, view.date, view.shift).map(({ task, to }) => {
    const what = task.project || task.wo;
    const where = task.floor ? ` ${task.floor}` : '';
    const die = task.die ? ` (${task.die})` : '';
    const st = to === 'DONE' ? ' — Done' : to === 'IN_PROGRESS' ? ' — IP' : '';
    return `${what}${where}${die}${st}`;
  });
}

function card(machine, rerender) {
  const row = rowFor(machine.key);
  const sheet = machine.standing ? null : shiftUpdateFor(machine.key);
  const tracked = machine.standing ? [] : trackedLines(machine.key);
  const running = machine.standing ? [] : inProgressLines(machine.key);
  const filled = hasContent(row);

  const box = (field, label, placeholder, lines) => el('label.field', {},
    el('span', {}, label),
    el('textarea', {
      value: row[field] || '',
      placeholder,
      rows: lines,
      oninput: (e) => { row[field] = e.target.value; },
    }));

  // Pulling the whole workbook entry in one go is the common case; the chips
  // below are for picking single lines out of it.
  const pullAll = sheet && (sheet.done.length || sheet.next.length)
    ? el('button.linkbtn', {
        type: 'button',
        title: 'Copy the workbook entry into all three boxes',
        onclick: () => {
          for (const [field, key] of [['done', 'done'], ['next', 'next'], ['notes', 'notes']]) {
            const items = sheet[key] || [];
            if (!items.length) continue;
            const have = new Set((row[field] || '').split('\n').map((l) => l.trim()));
            const add = items.filter((t) => !have.has(t.trim()));
            if (!add.length) continue;
            row[field] = row[field] ? `${row[field]}\n${add.join('\n')}` : add.join('\n');
          }
          rerender();
        },
      }, icon('undo', { size: 11 }), 'Pull last update')
    : null;

  return el('div.sucard' + (filled ? '.filled' : '') + (sheet?.down ? '.down' : ''), {},
    // A machine being down is the biggest thing that can be true of it this
    // shift — it outranks everything else on the card and gets its own band
    // rather than a chip lost in a header row.
    sheet?.down ? el('div.sucard-down', {},
      icon('alert', { size: 15 }),
      el('strong', {}, machine.label + ' is down'),
      el('span', {}, 'Say what happened and what is needed in Notes')) : null,
    el('div.sucard-head', {},
      filled ? el('span.sucard-tick', { title: 'Written up' }, icon('check', { size: 13 })) : null,
      el('span.sucard-name', {}, machine.label),
      machine.note ? el('span.sucard-sub', {}, machine.note) : null,
      el('span.spacer'),
      pullAll,
      machine.standing ? null : el('label.sucard-ops', {},
        el('span', {}, '#Ops'),
        el('input', {
          type: 'number', min: '0', inputmode: 'numeric',
          value: row.ops ?? '',
          placeholder: machine.ops == null ? '—' : String(machine.ops),
          oninput: (e) => { row.ops = e.target.value; },
        }))),

    el('div.sucard-body', {},
      box('done', 'Work done / in progress', '1-\n2-\n3-', 3),
      box('next', 'Next in schedule', '1-\n2-\n3-', 3),
      box('notes', 'Notes', 'Breakdowns, material, anything the next shift needs', 2)),

    suggestions(row, { tracked, running, sheet }, rerender));
}

function writeView(rerender) {
  const d = loadDraft();
  const saved = currentLog();
  const all = sections();
  const total = all.reduce((a, s) => a + s.rows.length, 0);
  const done = all.reduce((a, s) => a + s.rows.filter((m) => hasContent(d.rows[m.key])).length, 0);

  const blocks = all.map((s) => {
    // A secondary standing row still shows if somebody has already written in
    // it — folding away something with content in it would hide their work.
    const shown = s.rows.filter((m) => !m.secondary || showExtraStanding || hasContent(d.rows[m.key]));
    const folded = s.rows.length - shown.length;

    return el('section.dgroup', {},
      el('div.dgroup-head', {},
        el('span.dgroup-label', {}, s.label),
        el('span.dgroup-count', {}, `${s.rows.filter((m) => hasContent(d.rows[m.key])).length}/${s.rows.length}`),
        s.hint ? el('span.small.muted', {}, s.hint) : null,
        folded ? el('span.spacer') : null,
        folded ? el('button.linkbtn', {
          onclick: () => { showExtraStanding = true; rerender(); },
        }, `＋ ${s.rows.filter((m) => m.secondary).map((m) => m.label).join(' and ')}`) : null),
      el('div.sugrid', {}, ...shown.map((m) => card(m, rerender))));
  });

  return el('div', {},
    ...blocks,

    el('div.panel.su-general', {},
      el('header', {}, 'General notes'),
      el('div.body', {},
        el('textarea', {
          value: d.notes,
          rows: 3,
          placeholder: 'Anything not tied to one machine — people, material, safety, visitors.',
          oninput: (e) => { d.notes = e.target.value; },
        }))),

    el('div.su-actions', {},
      el('span.small.muted', {},
        saved ? `Last saved by ${saved.by} · ${fmtWhen(saved.at)}` : 'Not saved yet',
        el('span.dot-sep', {}, '·'),
        `${done} of ${total} filled in`),
      el('span.spacer'),
      saved ? el('button.danger', {
        onclick: async () => {
          const ok = await confirmDialog(
            'Delete this shift update?',
            `The ${SHIFTS[view.shift].label} update for ${fmtDate(view.date, { withDay: true })} will be removed for everyone.`,
            { confirmLabel: 'Delete', danger: true });
          if (!ok) return;
          deleteShiftLog(logKey(view.date, view.shift));
          dropDraft();
          toast('Shift update deleted');
          rerender();
        },
      }, 'Delete') : null,
      el('button.primary', {
        onclick: () => {
          const rows = Object.fromEntries(
            Object.entries(d.rows).filter(([, r]) => hasContent(r)));
          if (!Object.keys(rows).length && !d.notes.trim()) {
            toast('Fill in at least one machine first');
            return;
          }
          saveShiftLog(view.date, view.shift, { rows, notes: d.notes.trim() });
          dropDraft();
          view.mode = 'read';
          toast('Shift update saved');
          rerender();
        },
      }, icon('check', { size: 14 }), 'Save shift update')));
}

/* ---------- reading ---------- */

/** The update as plain text, for pasting into an email or a chat. */
function asText(log) {
  const out = [`${SHIFTS[log.shift]?.label || log.shift} shift — ${fmtDate(log.date, { withDay: true })}`, ''];
  for (const s of sections()) {
    const rows = s.rows.filter((m) => hasContent(log.rows[m.key]));
    if (!rows.length) continue;
    out.push(`== ${s.label} ==`);
    for (const m of rows) {
      const r = log.rows[m.key];
      out.push(`${m.label}${r.ops ? `  (${r.ops} ops)` : ''}`);
      for (const [field, label] of FIELDS) {
        if (!r[field]) continue;
        out.push(`  ${label}:`);
        for (const line of String(r[field]).split('\n')) {
          if (line.trim()) out.push(`    ${line.trim()}`);
        }
      }
      out.push('');
    }
  }
  if (log.notes) out.push('== General notes ==', log.notes, '');
  out.push(`Written by ${log.by}`);
  return out.join('\n');
}

function readView(rerender) {
  const log = currentLog();

  if (!log) {
    return el('div.panel', {}, el('div.empty', {},
      el('div.empty-icon', {}, icon('note', { size: 28 })),
      el('h3', {}, 'Nothing written for this shift'),
      el('p', {}, `No ${SHIFTS[view.shift].label.toLowerCase()} update for ${fmtDate(view.date, { withDay: true })}.`),
      el('button.primary', {
        style: { marginTop: '12px' },
        onclick: () => { view.mode = 'write'; rerender(); },
      }, 'Write the update')));
  }

  const blocks = sections().map((s) => {
    const rows = s.rows.filter((m) => hasContent(log.rows[m.key]));
    if (!rows.length) return null;

    return el('section.dgroup', {},
      el('div.dgroup-head', {}, el('span.dgroup-label', {}, s.label)),
      el('div.dgroup-body', {}, ...rows.map((m) => {
        const r = log.rows[m.key];
        return el('div.suread', {},
          el('div.suread-name', {},
            el('strong', {}, m.label),
            r.ops ? chip(`${r.ops} ops`, 'mute') : null),
          el('div.suread-cols', {}, ...FIELDS.map(([field, label]) => (r[field]
            ? el('div.suread-col', {},
                el('div.su-label', {}, label),
                el('div.suread-text', {}, String(r[field])))
            : null))));
      })));
  }).filter(Boolean);

  return el('div', {},
    ...blocks,

    log.notes ? el('div.panel.su-general', {},
      el('header', {}, 'General notes'),
      el('div.body', {}, el('div.suread-text', {}, log.notes))) : null,

    el('div.su-actions', {},
      el('span.small.muted', {}, `Written by ${log.by} · ${fmtWhen(log.at)}`),
      el('span.spacer'),
      el('button', {
        onclick: async () => {
          const text = asText(log);
          try {
            await navigator.clipboard.writeText(text);
            toast('Copied — paste it wherever you need');
          } catch {
            // Clipboard is blocked over file:// in some browsers; fall back to
            // a selectable box the reader can copy by hand.
            const ta = el('textarea', {
              value: text,
              style: { width: '100%', minHeight: '340px', fontFamily: 'inherit' },
            });
            const { modal } = await import('../ui.js');
            modal('Shift update text', ta, { wide: true });
            ta.select();
          }
        },
      }, icon('note', { size: 14 }), 'Copy as text'),
      el('button.primary', {
        onclick: () => { view.mode = 'write'; rerender(); },
      }, icon('pencil', { size: 14 }), 'Edit')));
}

/* ---------- page ---------- */

export function renderShiftUpdate(rerender, go) {
  if (!hasTasks()) {
    return el('div.panel', {},
      el('div.empty', {},
        el('div.empty-icon', {}, icon('upload', { size: 28 })),
        el('h3', {}, 'No schedule loaded yet'),
        el('p', {}, 'Import the Rolling and CNC workbooks to get started.'),
        el('button.primary', { onclick: () => go('setup') }, 'Go to Setup')));
  }

  const posted = Object.values(state.shiftLogs || {})
    .sort((a, b) => ((a.date + SHIFT_ORDER.indexOf(a.shift)) < (b.date + SHIFT_ORDER.indexOf(b.shift)) ? 1 : -1));
  const saved = currentLog();

  // How far through the update the writer is. The same count the footer shows,
  // but at the top where it answers "is this nearly done" before scrolling.
  const draft = loadDraft();
  const allRows = sections();
  const total = allRows.reduce((a, s) => a + s.rows.length, 0);
  const filled = allRows.reduce(
    (a, s) => a + s.rows.filter((m) => hasContent(draft.rows[m.key])).length, 0);
  const pct = total ? Math.round((filled / total) * 100) : 0;

  const head = el('div.centre-head.su-head-page' + (view.mode === 'read' ? '.reading' : ''), {},
    el('div.row.centre-title-row', {},
      el('div.centre-ident', {},
        el('span.centre-rail', { 'aria-hidden': 'true' }),
        el('div', {},
          el('h1.centre-title', {}, 'Shift update'),
          el('div.centre-sub', {},
            fmtDate(view.date, { withDay: true }),
            el('span.dot-sep', {}, '·'),
            SHIFTS[view.shift].label,
            el('span.dot-sep', {}, '·'),
            view.mode === 'read' ? 'Reading' : `Writing as ${me()}`))),
      el('span.spacer'),
      el('div.su-when', {},
        el('input.su-date', {
          type: 'date', value: view.date, 'aria-label': 'Shift date',
          onchange: (e) => {
            view.date = e.target.value || today();
            dropDraft();
            rerender();
          },
        }),
        el('div.subtabs', {}, ...SHIFT_ORDER.map((k) => el('button', {
          'aria-current': String(view.shift === k),
          title: SHIFTS[k].full ? 'Full crew' : `${SHIFTS[k].crew}-person crew`,
          onclick: () => { view.shift = k; dropDraft(); rerender(); },
        }, SHIFTS[k].label))))),

    // Writing and reading are different jobs on the same data, so the switch
    // between them is a real control rather than one pill among the filters.
    el('div.centre-filters', {},
      el('div.seg.su-mode', { role: 'group', 'aria-label': 'Mode' },
        ...[['write', 'Write', 'pencil'], ['read', 'Read', 'note']].map(([k, label, ic]) =>
          el('button.seg-btn' + (view.mode === k ? '.on' : ''), {
            'aria-pressed': String(view.mode === k),
            onclick: () => { view.mode = k; rerender(); },
          }, icon(ic, { size: 15 }), el('span', {}, label)))),
      saved ? chip('saved', 'ok') : chip('not written yet', 'warn'),
      SHIFTS[view.shift].full ? null : chip(`${SHIFTS[view.shift].crew}-person crew`, 'mute'),
      el('span.spacer'),
      posted.length
        ? el('span.small.muted', {}, `${posted.length} update${posted.length === 1 ? '' : 's'} on file`)
        : null),

    view.mode === 'write' ? el('div.progress', {
      title: `${filled} of ${total} machines written up`,
    }, el('i', { style: { width: pct + '%' } })) : null,
    view.mode === 'write'
      ? el('div.progress-cap', {}, `${filled} of ${total} written up`)
      : null);

  const recent = posted.length ? el('div.panel.su-recent', {},
    el('header', {}, 'Recent updates'),
    el('ul.list', {}, ...posted.slice(0, 8).map((l) => {
      const here = l.date === view.date && l.shift === view.shift;
      return el('li.su-recentrow' + (here ? '.here' : ''), {
        onclick: () => {
          view.date = l.date;
          view.shift = l.shift;
          view.mode = 'read';
          dropDraft();
          rerender();
        },
      },
        chip(SHIFTS[l.shift]?.label || l.shift, SHIFTS[l.shift]?.full ? 'mute' : 'warn'),
        el('strong', {}, fmtDate(l.date, { withDay: true })),
        el('span.muted.small', {},
          `${Object.keys(l.rows || {}).length} machine${Object.keys(l.rows || {}).length === 1 ? '' : 's'}`),
        el('span.spacer'),
        el('span.muted.small', {}, `${l.by} · ${fmtWhen(l.at)}`));
    }))) : null;

  return el('div.centre', {},
    head,
    view.mode === 'write' ? writeView(rerender) : readView(rerender),
    recent);
}
