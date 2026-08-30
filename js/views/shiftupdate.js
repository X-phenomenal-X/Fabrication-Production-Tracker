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
  el, chip, icon, fmtDate, fmtWhen, toast, confirmDialog, printDocument, modal,
} from '../ui.js';
import { state, saveShiftLog, deleteShiftLog, me } from '../store.js';
import {
  today, hasTasks, machineConfig, shiftUpdateFor, workInShift, shiftUpdateAge,
  inProgressLines,
} from '../model.js';
import { machinesByGroup, STANDING_ROWS } from '../machines.js';
import {
  SHIFTS, SHIFT_ORDER, breakRanges, normalizeShift, shiftAt, shiftLabel,
} from '../shifts.js';

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

const view = {
  date: today(), shift: shiftAt() || 'DAY', mode: 'write', onlyIncomplete: false,
  // Where the phone's stepper is, and which machine has its suggestions
  // open. Null means "wherever the work is" — see activeMobileIndex.
  mobileIndex: null, mobileSugsFor: null, mobileSugsAll: null,
};

function shiftDef(value = view.shift) {
  return SHIFTS[normalizeShift(value)] || {
    key: value, label: String(value || 'Unknown'), range: '', breaks: [], full: true,
  };
}

function operationalShift(value = view.shift) {
  return SHIFT_ORDER.includes(normalizeShift(value));
}

function shiftSortRank(value) {
  const i = SHIFT_ORDER.indexOf(normalizeShift(value));
  return i >= 0 ? i : SHIFT_ORDER.length;
}

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
  view.mobileIndex = null;
  view.mobileSugsFor = null;
  view.mobileSugsAll = null;
  railScroll = 0;
  railCentredOn = null;
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
function suggestions(row, entry, rerender, { limit = 0, onShowAll = null } = {}) {
  const add = (field, text) => {
    const cur = row[field] || '';
    if (cur.split('\n').some((l) => l.trim() === text.trim())) return false;
    row[field] = cur ? `${cur}\n${text}` : text;
    return true;
  };

  const has = (field, text) => (row[field] || '')
    .split('\n').some((l) => l.trim() === text.trim());

  /* `limit` is for the phone. A busy machine offers eighty-odd lines, and on
     a desk monitor that is a column beside the boxes; on a phone it is the
     boxes pushed off the bottom of the screen by a list nobody scrolls to the
     end of. The rest stay one tap away rather than gone. */
  const group = (label, field, items, cls = '') => {
    if (!items.length) return null;
    const shown = limit ? items.slice(0, limit) : items;
    const hidden = items.length - shown.length;
    return el('div.sug' + cls, {},
      el('span.sug-label', {}, label),
      el('div.sug-items', {}, ...shown.map((text) => {
        // Suggestions already written into the box stay visible but read as
        // spent, so it is obvious what is left to pick up.
        const used = has(field, text);
        return el('button.sug-chip' + (used ? '.used' : ''), {
          type: 'button',
          title: used ? 'Already in the update' : 'Add to ' + FIELDS.find(([f]) => f === field)[1],
          onclick: () => { if (add(field, text)) rerender(); },
        }, icon('check', { size: 10 }), text);
      }),
        hidden && onShowAll ? el('button.sug-chip.sug-more', {
          type: 'button', title: `Show the other ${hidden}`, onclick: onShowAll,
        }, `+${hidden} more`) : null));
  };

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

  return el('div.sucard' + (filled ? '.filled' : '') + (sheet?.down ? '.down' : ''), {
    id: 'su-' + machine.key,
  },
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
    const shown = s.rows.filter((m) => {
      const filled = hasContent(d.rows[m.key]);
      if (view.onlyIncomplete && filled) return false;
      return !m.secondary || showExtraStanding || filled;
    });
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

  /* What is left to write, and a way straight to it.

     `total` and `done` were already being computed here and then thrown away,
     so the page knew how far along it was and never said. On a 13-machine
     update that is the whole difficulty: the form is nine thousand pixels
     tall, and finding the two boxes nobody has filled in meant scrolling all
     of it. Secondary standing rows are excluded from "left to write" — they
     are reported occasionally, not every shift, so counting them would make
     the page permanently unfinished. */
  const outstanding = all
    .flatMap((s) => s.rows)
    .filter((m) => !m.secondary && !hasContent(d.rows[m.key]));

  const jump = (key) => {
    const card = document.getElementById('su-' + key);
    if (!card) return;
    card.scrollIntoView({ block: 'center' });
    card.querySelector('textarea')?.focus();
  };

  return el('div.su-wide', {},
    el('div.su-progress' + (outstanding.length ? '' : '.complete'), {},
      el('div.su-progress-count', {},
        el('b', {}, `${done}`), el('span', {}, ` of ${total} written`)),
      outstanding.length
        ? el('div.su-progress-left', {},
            el('span.su-progress-label', {}, 'Still to write'),
            el('div.su-progress-chips', {}, ...outstanding.map((m) => el('button.su-jump', {
              title: `Go to ${m.label}`,
              onclick: () => jump(m.key),
            }, m.label))))
        : el('div.su-progress-left', {},
            icon('check', { size: 14 }),
            el('span', {}, 'Every machine has something written.'))),

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
            `The ${shiftDef().label} update for ${fmtDate(view.date, { withDay: true })} will be removed for everyone.`,
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

/* ---------- writing on a phone ----------

   The same update, but one machine at a time.

   The form above is thirteen cards stacked in a column. On a desk monitor that
   is a page you scan; on a phone held in a doorway at 23:20 it is nine thousand
   pixels of scrolling to find the two boxes nobody filled in, and the thing
   most often typed into it — one machine's three lines — costs a hunt every
   time. So the phone gets a stepper instead: a rail that says how far along the
   update is and lets any machine be jumped to, one editor open at a time, and a
   dock that saves what is written so far and moves to the next machine nobody
   has done.

   Both surfaces are built on every render and CSS shows exactly one, so this is
   a second presentation of the same draft rather than a second writer. Nothing
   here holds state the desktop form cannot see: they share `draft`, so a shift
   started on a phone finishes on a monitor. */

/** Every reportable row in one flat, ordered list — the order the stepper
    walks. The page above folds the two retired standing rows behind a link;
    the rail has room for all thirteen and marking them done is the whole
    point of it, so nothing is folded here. */
function reportRows() {
  return sections().flatMap((s) => s.rows.map((m) => ({ ...m, section: s.label })));
}

/** The row the phone is editing. Resolved rather than trusted: the index is
    kept across re-renders in `view`, and a stale one from a longer list would
    otherwise point past the end. With nothing chosen it opens on the first row
    nobody has written, so picking the page up mid-shift lands on the work. */
function activeMobileIndex(rows, d) {
  if (view.mobileIndex != null) {
    return Math.min(Math.max(view.mobileIndex, 0), Math.max(rows.length - 1, 0));
  }
  const next = rows.findIndex((m) => !m.secondary && !hasContent(d.rows[m.key]));
  return next < 0 ? 0 : next;
}

/** The next row still to write, wrapping once past the end so finishing in the
    middle of the rail carries on from the top rather than stopping. The two
    retired standing rows are skipped — they are reported occasionally, not
    every shift, so landing on them would make the update feel unfinished. */
function nextIncomplete(rows, from, d) {
  const open = (m) => !m.secondary && !hasContent(d.rows[m.key]);
  for (let i = from + 1; i < rows.length; i += 1) if (open(rows[i])) return i;
  for (let i = 0; i <= from && i < rows.length; i += 1) if (open(rows[i])) return i;
  return -1;
}

/** How much the app can offer this machine, for the disclosure button. Kept as
    a count so the suggestions themselves — three blocks and up to a dozen
    chips — stay folded until somebody asks for them. */
function mobileSuggestionCount({ tracked, running, sheet }) {
  return tracked.length + running.length + (sheet
    ? (sheet.done || []).length + (sheet.next || []).length + (sheet.notes || []).length
    : 0);
}

/** Everything the header carries on a monitor that will not fit beside a title
    on a phone: the mode switch, both print routes, and the general notes box.
    None of it is dropped — a shift lead prints the update from the floor — it
    just stops competing with the machine being written up. */
function mobileShiftActions(rerender) {
  const d = loadDraft();
  const saved = currentLog();
  const selected = shiftDef();

  const item = (ic, label, hint, onclick, { disabled = false } = {}) =>
    el('button.su-m-menuitem', {
      type: 'button', disabled,
      onclick: (e) => { e.currentTarget.closest('dialog')?.close(); onclick(); },
    },
      el('span.su-m-menuicon', {}, icon(ic, { size: 17 })),
      el('span.su-m-menutext', {},
        el('strong', {}, label),
        el('small', {}, hint)));

  // The breaks are here to be read, not pressed. A disabled button says the
  // opposite — that this is something that could be done, just not now.
  const fact = (ic, label, hint) => el('div.su-m-menuitem.su-m-menufact', {},
    el('span.su-m-menuicon', {}, icon(ic, { size: 17 })),
    el('span.su-m-menutext', {},
      el('strong', {}, label),
      el('small', {}, hint)));

  const notes = el('textarea', {
    value: d.notes,
    rows: 5,
    placeholder: 'Anything not tied to one machine — people, material, safety, visitors.',
    oninput: (e) => { d.notes = e.target.value; },
  });

  const body = el('div.su-m-menu', {},
    item('note', 'Read this update', saved
      ? `Saved by ${saved.by} · ${fmtWhen(saved.at)}`
      : 'Nothing saved for this shift yet',
    () => { view.mode = 'read'; rerender(); }),

    fact('clock', `${selected.label} breaks`, breakRanges(view.shift).join(' · ') || '—'),

    item('print', 'Print update', 'The written entries, as a sheet',
      printCurrentShiftUpdate),

    item('clipboard', 'Print blank form', operationalShift()
      ? 'An empty sheet to fill in by hand'
      : 'Day and Afternoon only',
    printBlankShiftUpdate, { disabled: !operationalShift() }),

    el('label.field.su-m-menunotes', {},
      el('span', {}, 'General notes'),
      notes));

  modal('Shift update', body, {
    actions: [{
      label: 'Done', class: 'primary', onClick: (dlg) => { dlg.close(); rerender(); },
    }],
  });
}

/* The rail is rebuilt on every render, so left alone it comes back at zero —
   the same fault that once hid the current page from the nav. Carry the
   position across rebuilds, and centre the active step whenever it changes, so
   step 9 of 13 is visible rather than three screens to the right. */
let railScroll = 0;
let railCentredOn = null;

function settleRail(rail, key) {
  requestAnimationFrame(() => {
    // Built on every render but only laid out on a phone; on a monitor it is
    // display:none, every box is zero, and centring would be meaningless.
    if (!rail.isConnected || !rail.clientWidth) return;
    rail.scrollLeft = railScroll;
    if (railCentredOn !== key) {
      const on = rail.querySelector('.su-m-step.here');
      if (on) {
        const rr = rail.getBoundingClientRect();
        const br = on.getBoundingClientRect();
        // Centred, so the steps either side stay half-visible — the only hint
        // on the screen that the row moves at all.
        rail.scrollLeft += (br.left + br.width / 2) - (rr.left + rr.width / 2);
      }
      railCentredOn = key;
    }
    railScroll = rail.scrollLeft;
    rail.addEventListener('scroll', () => { railScroll = rail.scrollLeft; }, { passive: true });
  });
}

/** The one machine being written up. Three boxes, the operator count, and —
    only if asked for — everything the app already knows about this machine. */
function mobileEditor(machine, rerender) {
  const row = rowFor(machine.key);
  const sheet = machine.standing ? null : shiftUpdateFor(machine.key);
  const tracked = machine.standing ? [] : trackedLines(machine.key);
  const running = machine.standing ? [] : inProgressLines(machine.key);
  const entry = { tracked, running, sheet };
  const offered = mobileSuggestionCount(entry);
  const open = view.mobileSugsFor === machine.key;
  const showAll = view.mobileSugsAll === machine.key;

  const box = (field, label, placeholder, lines) => el('label.field.su-m-box', {},
    el('span', {}, label),
    el('textarea', {
      value: row[field] || '',
      placeholder,
      rows: lines,
      oninput: (e) => { row[field] = e.target.value; },
    }));

  /* A number pad for one digit is the wrong keyboard to open on a phone, and
     crewing moves by one. The field stays typeable for the rare four. */
  const bump = (by) => {
    const now = Number(row.ops === '' || row.ops == null ? (machine.ops ?? 0) : row.ops);
    row.ops = String(Math.max(0, (Number.isFinite(now) ? now : 0) + by));
    rerender();
  };

  const pullAll = sheet && (sheet.done.length || sheet.next.length)
    ? el('button.su-m-pull', {
        type: 'button',
        onclick: () => {
          for (const field of ['done', 'next', 'notes']) {
            const items = sheet[field] || [];
            if (!items.length) continue;
            const have = new Set((row[field] || '').split('\n').map((l) => l.trim()));
            const add = items.filter((t) => !have.has(t.trim()));
            if (!add.length) continue;
            row[field] = row[field] ? `${row[field]}\n${add.join('\n')}` : add.join('\n');
          }
          rerender();
        },
      }, icon('undo', { size: 14 }), 'Pull last update')
    : null;

  return el('section.su-m-editor' + (sheet?.down ? '.down' : ''), { id: 'su-m-' + machine.key },
    sheet?.down ? el('div.sucard-down', {},
      icon('alert', { size: 15 }),
      el('strong', {}, machine.label + ' is down'),
      el('span', {}, 'Say what happened and what is needed in Notes')) : null,

    el('div.su-m-editorhead', {},
      el('div.su-m-ident', {},
        el('span.su-m-section', {}, machine.section),
        el('h2.su-m-name', {}, machine.label),
        machine.note ? el('span.su-m-note', {}, machine.note) : null),
      machine.standing ? null : el('div.su-m-ops', {},
        el('span.su-m-opslabel', {}, '# Ops'),
        el('div.su-m-opsset', {},
          el('button.su-m-opsbtn', {
            type: 'button', 'aria-label': `One fewer operator on ${machine.label}`,
            onclick: () => bump(-1),
          }, icon('minus', { size: 14 })),
          el('input.su-m-opsnum', {
            type: 'number', min: '0', inputmode: 'numeric',
            'aria-label': `Operators on ${machine.label}`,
            value: row.ops ?? '',
            placeholder: machine.ops == null ? '—' : String(machine.ops),
            oninput: (e) => { row.ops = e.target.value; },
          }),
          el('button.su-m-opsbtn', {
            type: 'button', 'aria-label': `One more operator on ${machine.label}`,
            onclick: () => bump(1),
          }, icon('plus', { size: 14 }))))),

    pullAll,

    el('div.su-m-boxes', {},
      box('done', 'Work done / in progress', '1-\n2-\n3-', 4),
      box('next', 'Next in schedule', '1-\n2-\n3-', 3),
      box('notes', 'Notes', 'Breakdowns, material, anything the next shift needs', 2)),

    /* Folded by default. The suggestion blocks are the most useful thing on
       the card and the tallest — left open they push the boxes somebody came
       here to type in off the bottom of the screen. */
    offered ? el('div.su-m-suggests', {},
      el('button.su-m-suggestbtn' + (open ? '.open' : ''), {
        type: 'button', 'aria-expanded': String(open),
        onclick: () => { view.mobileSugsFor = open ? null : machine.key; rerender(); },
      },
        icon('bolt', { size: 15 }),
        el('span', {}, open ? 'Hide suggestions' : 'Suggested lines'),
        el('span.su-m-suggestcount', {}, String(offered)),
        el('span.su-m-suggestcaret', {}, icon('chevron', { size: 14 }))),
      open ? suggestions(row, entry, rerender, showAll ? {} : {
        limit: 5,
        onShowAll: () => { view.mobileSugsAll = machine.key; rerender(); },
      }) : null) : null);
}

/** The phone writer: how far along, which machine, and the way on. */
function mobileWriteView(rerender) {
  const d = loadDraft();
  const rows = reportRows();
  const index = activeMobileIndex(rows, d);
  const machine = rows[index];
  const saved = currentLog();
  const counted = rows.filter((m) => !m.secondary);
  const written = counted.filter((m) => hasContent(d.rows[m.key])).length;
  const left = counted.length - written;

  const goTo = (i) => {
    view.mobileIndex = Math.min(Math.max(i, 0), rows.length - 1);
    view.mobileSugsFor = null;
    view.mobileSugsAll = null;
    rerender();
  };

  /* Save what is written and move on. Partial by design: an update is written
     across a shift, not in one sitting, and a writer who has done four
     machines at 19:00 should be able to put the phone down without either
     losing them or being told the form is incomplete. */
  const saveAndNext = () => {
    const write = Object.fromEntries(
      Object.entries(d.rows).filter(([, r]) => hasContent(r)));
    if (!Object.keys(write).length && !d.notes.trim()) {
      toast('Write something on a machine first');
      return;
    }
    saveShiftLog(view.date, view.shift, { rows: write, notes: d.notes.trim() });
    const target = nextIncomplete(rows, index, d);
    dropDraft();
    if (target < 0) {
      view.mobileIndex = index;
      toast('Saved — every machine is written up');
    } else {
      view.mobileIndex = target;
      view.mobileSugsFor = null;
      view.mobileSugsAll = null;
      toast(`Saved — ${rows[target].label} next`);
    }
    rerender();
    document.querySelector('.su-m-editor')?.scrollIntoView({ block: 'start' });
  };

  const rail = el('div.su-m-rail', { role: 'tablist', 'aria-label': 'Machines to write up' },
    ...rows.map((m, i) => {
      const filled = hasContent(d.rows[m.key]);
      const here = i === index;
      return el('button.su-m-step'
        + (filled ? '.done' : '') + (here ? '.here' : '') + (m.secondary ? '.extra' : ''), {
        type: 'button', role: 'tab', 'aria-selected': String(here),
        title: `${m.section} · ${m.label}${filled ? ' · written' : ''}`,
        onclick: () => goTo(i),
      },
        el('span.su-m-stepmark', {}, filled ? icon('check', { size: 12 }) : String(i + 1)),
        el('span.su-m-steplabel', {}, m.short || m.label));
    }));
  settleRail(rail, `${view.date}|${view.shift}|${machine ? machine.key : ''}`);

  return el('div.su-m', {},
    el('div.su-m-top', {},
      el('div.su-m-count', {},
        el('b', {}, String(written)),
        el('span', {}, ` of ${counted.length} written`),
        left ? null : el('span.su-m-alldone', {}, icon('check', { size: 13 }), 'complete')),
      el('span.spacer'),
      el('button.su-m-more', {
        type: 'button', 'aria-label': 'Shift update actions',
        onclick: () => mobileShiftActions(rerender),
      }, icon('list', { size: 17 }), el('span', {}, 'More'))),

    rail,

    mobileEditor(machine, rerender),

    el('div.su-m-move', {},
      el('button.su-m-prev', {
        type: 'button', disabled: index <= 0,
        onclick: () => goTo(index - 1),
      }, icon('chevron', { size: 15 }), el('span', {}, 'Previous')),
      el('button.su-m-next', {
        type: 'button', disabled: index >= rows.length - 1,
        onclick: () => goTo(index + 1),
      }, el('span', {}, 'Next'), icon('chevron', { size: 15 }))),

    el('p.su-m-saved', {}, saved
      ? `Last saved by ${saved.by} · ${fmtWhen(saved.at)}`
      : 'Nothing saved for this shift yet'),

    /* Above the home indicator, and always there: the one thing this screen is
       for should never need scrolling to. */
    el('div.su-m-dock', {},
      el('button.primary.su-m-save', {
        type: 'button', onclick: saveAndNext,
      }, icon('check', { size: 16 }),
        el('span', {}, left > 1 ? 'Save & next' : 'Save update'))));
}

/* ---------- reading ---------- */

/** The update as plain text, for pasting into an email or a chat. */
function asText(log) {
  const out = [`${shiftLabel(log.shift)} shift — ${fmtDate(log.date, { withDay: true })}`, ''];
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

function printShiftUpdate(log, { draft: isDraft = false, blank = false } = {}) {
  const blocks = sections().map((section) => {
    // The paper form mirrors the department's current sheet: Back Order plus
    // every visible machine. The two retired standing rows stay available in
    // the interactive writer, but do not consume handwriting space on paper.
    const rows = blank
      ? section.rows.filter((machine) => !machine.secondary)
      : section.rows.filter((machine) => hasContent(log.rows?.[machine.key]));
    if (!rows.length) return null;
    return el('section.print-table-group.print-shift-group' + (blank ? '.print-shift-blank' : ''), {},
      el('h2', {}, section.label, el('span', {}, blank
        ? 'Fill by hand'
        : `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`)),
      el('table.print-table.print-shift-table', {},
        el('thead', {}, el('tr', {},
          ...['Machine', '# Ops', 'Work done / in progress', 'Next in schedule', 'Notes']
            .map((label) => el('th', {}, label)))),
        el('tbody', {}, ...rows.map((machine) => {
          const row = blank ? {} : log.rows[machine.key];
          return el('tr', {},
            el('td', {}, el('strong', {}, machine.label),
              machine.note ? el('small', {}, machine.note) : null),
            el('td.mono.num', {}, blank ? '\u00a0' : row.ops || '—'),
            el('td.preline', {}, blank ? '\u00a0' : row.done || '—'),
            el('td.preline', {}, blank ? '\u00a0' : row.next || '—'),
            el('td.preline', {}, blank ? '\u00a0' : row.notes || '—'));
        }))));
  }).filter(Boolean);

  const body = el('div.print-shift-update', {},
    ...blocks,
    blank ? el('section.print-general-notes.print-handwrite-notes', {},
      el('h2', {}, 'General notes'),
      el('div.print-handwrite-lines', {}, ...Array.from({ length: 3 }, () => el('span', {}))))
      : log.notes ? el('section.print-general-notes', {},
        el('h2', {}, 'General notes'), el('p.preline', {}, log.notes)) : null,
    el('footer.print-signoff', {},
      blank ? 'Completed by: ______________________________    Time: ______________'
        : isDraft ? `Draft prepared by ${me()}`
          : `Written by ${log.by || '—'}${log.at ? ` · ${fmtWhen(log.at)}` : ''}`));

  const selected = shiftDef(log.shift);

  printDocument({
    title: `${shiftLabel(log.shift)} shift update${blank ? ' — blank' : ''}`,
    subtitle: [
      fmtDate(log.date, { withDay: true }),
      blank && selected.range ? selected.range : null,
      blank && selected.breaks?.length ? `Breaks ${breakRanges(log.shift).join(' · ')}` : null,
    ].filter(Boolean).join(' · '),
    meta: [blank ? 'BLANK FORM · FILL BY HAND' : isDraft ? 'DRAFT — NOT SAVED' : 'Saved shift record'],
    body,
    landscape: true,
  });
}

function printBlankShiftUpdate() {
  if (!operationalShift()) {
    toast('Blank forms are available for Day and Afternoon shifts');
    return;
  }
  printShiftUpdate({
    date: view.date, shift: view.shift, rows: {}, notes: '', by: '', at: null,
  }, { blank: true });
}

function printCurrentShiftUpdate() {
  if (view.mode === 'read') {
    const saved = currentLog();
    if (!saved) {
      toast('There is no saved update to print');
      return;
    }
    printShiftUpdate(saved);
    return;
  }

  // Textareas update the draft object without re-rendering, so derive this at
  // click time rather than freezing an empty snapshot when the header renders.
  const current = loadDraft();
  const rows = Object.fromEntries(
    Object.entries(current.rows).filter(([, row]) => hasContent(row)));
  const notes = current.notes.trim();
  if (!Object.keys(rows).length && !notes) {
    toast('Fill in at least one machine before printing');
    return;
  }
  printShiftUpdate({
    date: view.date, shift: view.shift, rows, notes, by: me(), at: null,
  }, { draft: true });
}

function readView(rerender) {
  const log = currentLog();
  const selected = shiftDef();
  const canWrite = operationalShift();

  if (!log) {
    return el('div.panel', {}, el('div.empty', {},
      el('div.empty-icon', {}, icon('note', { size: 28 })),
      el('h3', {}, 'Nothing written for this shift'),
      el('p', {}, `No ${selected.label.toLowerCase()} update for ${fmtDate(view.date, { withDay: true })}.`),
      canWrite ? el('button.primary', {
        style: { marginTop: '12px' },
        onclick: () => { view.mode = 'write'; rerender(); },
      }, 'Write the update') : el('p.small.muted', {},
        'This is a historical shift. New updates are available only for Day and Afternoon.')));
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
      canWrite ? el('button.primary', {
        onclick: () => { view.mode = 'write'; rerender(); },
      }, icon('pencil', { size: 14 }), 'Edit') : chip('historical · read only', 'mute')));
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
    .sort((a, b) => ((a.date + shiftSortRank(a.shift)) < (b.date + shiftSortRank(b.shift)) ? 1 : -1));
  const saved = currentLog();
  const selectedShift = shiftDef();

  // How far through the update the writer is. The same count the footer shows,
  // but at the top where it answers "is this nearly done" before scrolling.
  const draft = loadDraft();
  const allRows = sections();
  const total = allRows.reduce((a, s) => a + s.rows.length, 0);
  const filled = allRows.reduce(
    (a, s) => a + s.rows.filter((m) => hasContent(draft.rows[m.key])).length, 0);
  const pct = total ? Math.round((filled / total) * 100) : 0;
  const canPrint = view.mode === 'write' || !!saved;

  const head = el('div.centre-head.su-head-page' + (view.mode === 'read' ? '.reading' : ''), {},
    el('div.row.centre-title-row.printable-title-row', {},
      el('div.centre-ident', {},
        el('span.centre-rail', { 'aria-hidden': 'true' }),
        el('div', {},
          el('h1.centre-title', {}, 'Shift update'),
          el('div.centre-sub', {},
            fmtDate(view.date, { withDay: true }),
            el('span.dot-sep', {}, '·'),
            selectedShift.label,
            selectedShift.range ? el('span.dot-sep', {}, '·') : null,
            selectedShift.range || null,
            el('span.dot-sep', {}, '·'),
            view.mode === 'read' ? 'Reading' : `Writing as ${me()}`))),
      el('span.spacer'),
      el('button.print-action', {
        type: 'button', disabled: !canPrint,
        title: canPrint
          ? `Print the ${selectedShift.label.toLowerCase()} shift update`
          : 'Add or open a shift update before printing',
        onclick: printCurrentShiftUpdate,
      }, icon('print', { size: 16 }), el('span', {}, 'Print update')),
      el('button.print-action.print-blank-action', {
        type: 'button', disabled: !operationalShift(),
        title: operationalShift()
          ? `Print a blank ${selectedShift.label.toLowerCase()} form to fill by hand`
          : 'Blank forms are available for Day and Afternoon shifts',
        onclick: printBlankShiftUpdate,
      }, icon('note', { size: 16 }), el('span', {}, 'Print blank')),
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
          title: `${SHIFTS[k].label} · ${SHIFTS[k].range} · Breaks: ${breakRanges(k).join(', ')}`,
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
      selectedShift.legacy ? chip('historical shift · read only', 'mute') : null,
      view.mode === 'write' ? el('label.row.small.donetoggle', {},
        el('input', {
          type: 'checkbox', checked: view.onlyIncomplete,
          onchange: (e) => { view.onlyIncomplete = e.target.checked; rerender(); },
        }),
        'Only incomplete') : null,
      el('span.spacer'),
      posted.length
        ? el('span.small.muted', {}, `${posted.length} update${posted.length === 1 ? '' : 's'} on file`)
        : null),

    !selectedShift.legacy ? el('div.su-breaks', {},
      icon('clock', { size: 14 }),
      el('strong', {}, `${selectedShift.label} breaks`),
      el('span', {}, breakRanges(view.shift).join(' · '))) : null,

    /* The bar is the at-a-glance proportion; the number and the way to act on
       it live in the rail below, which also lists what is still missing. Both
       spelling out "N of M" put the same count twice in adjacent rows. */
    view.mode === 'write' ? el('div.progress', {
      title: `${filled} of ${total} machines written up`,
    }, el('i', { style: { width: pct + '%' } })) : null);

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
        chip(shiftLabel(l.shift), shiftDef(l.shift).legacy ? 'warn' : 'mute'),
        el('strong', {}, fmtDate(l.date, { withDay: true })),
        el('span.muted.small', {},
          `${Object.keys(l.rows || {}).length} machine${Object.keys(l.rows || {}).length === 1 ? '' : 's'}`),
        el('span.spacer'),
        el('span.muted.small', {}, `${l.by} · ${fmtWhen(l.at)}`));
    }))) : null;

  return el('div.centre', {},
    head,
    // Both writers are built, and CSS shows the one that fits the screen.
    // Reading is one column either way, so it needs no phone variant.
    view.mode === 'write'
      ? el('div.su-writers', {}, mobileWriteView(rerender), writeView(rerender))
      : readView(rerender),
    recent);
}
