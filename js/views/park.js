/* Parking a line.

   A schedule lists what was planned, not what was decided. Jobs get cancelled,
   dies get remade under a different work order, elevations change — and the
   workbook goes on listing the line either way, because re-issuing the sheet
   costs somebody an afternoon. On the live books 62 open lines are dated
   December, and until now the only ways to stop counting them were to mark
   them Done, which is a lie the shift update then repeats, or to delete them,
   which the next import undoes.

   Parking is neither. The line leaves the queues and the counts, keeps its
   status, notes and history, and stays one filter away with the reason
   attached. The reason is not optional decoration: a parked line without one
   is indistinguishable from a mis-click, and the next person to look has no
   way to tell which it was. */

import { el, icon, modal, toast, toastAction, fmtWhen } from '../ui.js';
import { setParked, setParkedMany, restoreParked } from '../store.js';
import { taskStatusKey, parkedFor, daysLate } from '../model.js';

const REASONS = [
  'Job cancelled',
  'Remade under another W/O',
  'Elevation changed',
  'Superseded by a later revision',
];

export function parkDialog(task, rerender) {
  const key = taskStatusKey(task);
  const cur = parkedFor(key) || {};
  const on = !!cur.on;
  const late = daysLate(task);

  const reason = el('textarea', {
    rows: 2, value: cur.reason || '',
    placeholder: 'Why this line is not going to run',
  });

  const quick = (text) => el('button.linkbtn', {
    type: 'button',
    onclick: () => { reason.value = text; reason.focus(); },
  }, text);

  const body = el('div', {},
    el('div.bo-dialoghead', {},
      el('span.mono.strong', {}, `W/O ${task.wo}`),
      task.die ? el('span.die', {}, task.die) : null,
      el('span.small.muted', {},
        `${task.project || ''}${task.floor ? ' · ' + task.floor : ''}`.trim())),

    el('p.small.muted', { style: { marginTop: 'var(--s3)' } }, on
      ? 'This line is parked. Putting it back returns it to the queue and to '
        + 'every count, exactly as it was.'
      : 'Parking takes the line out of the queue, the open count and the shift '
        + 'update. Nothing is deleted — the status, notes and history stay, and '
        + 're-importing the workbook will not bring it back.'),

    late > 60 ? el('p.small.muted', {},
      icon('clock', { size: 13 }),
      ` This line is ${late} days past its cutting date.`) : null,

    on ? null : el('label.field', { style: { marginTop: 'var(--s3)' } },
      el('span', {}, 'Reason'), reason,
      el('div.rush-quick', {}, ...REASONS.map(quick))),

    cur.at ? el('div.small.muted', { style: { marginTop: 'var(--s3)' } },
      `Parked by ${cur.by} · ${fmtWhen(cur.at)}`
      + (cur.reason ? ` — ${cur.reason}` : '')) : null);

  modal(on ? `Parked — ${task.wo}` : `Park — ${task.wo}`, body, {
    actions: [
      on ? {
        label: 'Put it back', class: 'primary', onClick: (dlg) => {
          setParked(key, false);
          dlg.close(); toast('Back in the queue'); rerender();
        },
      } : {
        label: 'Park it', class: 'primary', onClick: (dlg) => {
          const why = reason.value.trim();
          if (!why) { toast('A reason is needed — it is the whole record'); reason.focus(); return; }
          setParked(key, true, why);
          dlg.close(); toast('Parked'); rerender();
        },
      },
    ],
  });
}


/* ---------- a batch of them ---------- */

/** Park several lines under one reason.

    Clearing a stale pile is a batch job by nature: the 62 December lines on the
    live books are one decision, not 62, and a dialog per line is how a cleanup
    gets abandoned a third of the way through. Undo covers the whole batch,
    because a bulk action nobody can reverse is one nobody will risk using. */
export function bulkParkDialog(keys, onDone) {
  const n = keys.length;
  const reason = el('textarea', {
    rows: 2, placeholder: 'Why these lines are not going to run',
  });
  const quick = (text) => el('button.linkbtn', {
    type: 'button',
    onclick: () => { reason.value = text; reason.focus(); },
  }, text);

  const body = el('div', {},
    el('p', { style: { marginTop: 0 } },
      `Park ${n} line${n === 1 ? '' : 's'}. They leave the queue, the open count `
      + 'and the shift update. Nothing is deleted, and a re-import will not bring '
      + 'them back.'),
    el('label.field', {},
      el('span', {}, 'Reason'), reason,
      el('div.rush-quick', {}, ...REASONS.map(quick))));

  modal(`Park ${n} line${n === 1 ? '' : 's'}`, body, {
    actions: [{
      label: 'Park them', class: 'primary', onClick: (dlg) => {
        const why = reason.value.trim();
        if (!why) { toast('A reason is needed — it is the whole record'); reason.focus(); return; }
        const before = setParkedMany(keys, true, why);
        dlg.close();
        toastAction(`${n} line${n === 1 ? '' : 's'} parked`, 'Undo', () => {
          restoreParked(before);
          onDone();
        });
        onDone();
      },
    }],
  });
}

/** Put a batch back in the queue. No dialog — there is nothing to record and
    nothing to get wrong, and undo covers the misfire. */
export function bulkUnpark(keys, onDone) {
  const n = keys.length;
  const before = setParkedMany(keys, false);
  toastAction(`${n} line${n === 1 ? '' : 's'} back in the queue`, 'Undo', () => {
    restoreParked(before);
    onDone();
  });
  onDone();
}
