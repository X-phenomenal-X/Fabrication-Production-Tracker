/* Data & Import: load a schedule revision, see exactly what changed and what
   was rejected, and manage the shared file everyone syncs through. */

import { el, chip, fmtDate, fmtNum, fmtWhen, toast, modal, download, confirmDialog } from '../ui.js';
import {
  state, setImport, save, exportJson, importJson, resetAll, saveGuideDoc,
  connectSharedFile, reconnectSharedFile, grantSharedFile, pullSharedFile,
  supportsSharedFile, sharedFileName, disconnectSharedFile, me,
} from '../store.js';
import { importWorkbook, diffRevisions } from '../import.js';
import { SEED_DOCS } from './guide.js';

let pendingHandle = null;

export async function initSharedFile(rerender) {
  if (!supportsSharedFile()) return;
  try {
    const r = await reconnectSharedFile();
    if (r?.needsPermission) pendingHandle = r.handle;
    rerender();
  } catch { /* nothing stored yet */ }
}

export function seedGuide() {
  for (const d of SEED_DOCS) {
    if (!state.guide[d.id]) state.guide[d.id] = { ...d, at: new Date(0).toISOString(), by: 'starter' };
  }
  save();
}

/* ---------- import ---------- */

function changeReport(diff, report) {
  const section = (title, nodes, tone) => nodes.length
    ? el('div', { style: { marginBottom: '16px' } },
        el('div.row', { style: { marginBottom: '6px' } }, el('strong', {}, title), chip(String(nodes.length), tone)),
        el('ul.list', { style: { border: '1px solid var(--line-soft)', borderRadius: '8px' } }, ...nodes))
    : null;

  const added = diff.added.slice(0, 40).map((o) => el('li', {},
    el('span.mono.strong', {}, o.wo), ' ',
    el('span', {}, `${o.project || '—'} · ${o.floor || '—'}`),
    o.cuttingDate ? el('span.small.muted', {}, ` cut ${fmtDate(o.cuttingDate)}`) : null));

  const changed = diff.changed.slice(0, 60).map(({ order, fields }) => el('li', {},
    el('div.row', {}, el('span.mono.strong', {}, order.wo),
      el('span.small.muted', {}, `${order.project || '—'} · ${order.floor || '—'}`)),
    el('div.small', { style: { marginTop: '3px' } }, ...fields.map((f) =>
      el('div', {}, `${f.label}: `,
        el('span.muted', {}, String(f.from ?? '—')), ' → ',
        el('strong', {}, String(f.to ?? '—')))))));

  const removed = diff.removed.slice(0, 40).map((o) => el('li', {},
    el('span.mono.strong', {}, o.wo), ' ',
    el('span.muted', {}, `${o.project || '—'} · ${o.floor || '—'}`)));

  const quality = [];
  if (report.duplicates.length) {
    quality.push(el('li', {}, el('strong', {}, `${report.duplicates.length} duplicate row keys`),
      el('div.small.muted', {}, 'Same W/O, floor and project appear more than once. All rows were kept; the extras are numbered #2, #3 and so on.')));
  }
  if (report.skipped.length) {
    quality.push(el('li', {}, el('strong', {}, `${report.skipped.length} rows skipped`),
      el('div.small.muted', {}, report.skipped.slice(0, 6).map((s) => `row ${s.row}: ${s.value ?? ''} (${s.reason})`).join(' · '))));
  }
  if (report.errorCells.length) {
    quality.push(el('li', {}, el('strong', {}, `${report.errorCells.length} formula errors in the sheet`),
      el('div.small.muted', {}, 'Cells containing #REF!, #VALUE! or #N/A were read as blank. Worth fixing in the source file.')));
  }
  if (report.unknownStatus.length) {
    quality.push(el('li', {}, el('strong', {}, `${report.unknownStatus.length} free-text status values`),
      el('div.small.muted', {},
        Array.from(new Set(report.unknownStatus.map((u) => u.value))).slice(0, 8).join(' · '))));
  }

  return el('div', {},
    el('div.stats', { style: { marginBottom: '16px', border: '1px solid var(--line-soft)', borderRadius: '8px', overflow: 'hidden' } },
      el('div.stat', {}, el('div.n', {}, fmtNum(report.counts.orders)), el('div.k', {}, 'Orders')),
      el('div.stat.ok', {}, el('div.n', {}, fmtNum(diff.added.length)), el('div.k', {}, 'New')),
      el('div.stat.warn', {}, el('div.n', {}, fmtNum(diff.changed.length)), el('div.k', {}, 'Changed')),
      el('div.stat', {}, el('div.n', {}, fmtNum(diff.removed.length)), el('div.k', {}, 'Gone')),
    ),
    section('New orders', added, 'ok'),
    section('Changed', changed, 'warn'),
    section('No longer in the schedule', removed, 'mute'),
    quality.length ? el('div', {},
      el('div.row', { style: { marginBottom: '6px' } }, el('strong', {}, 'Data quality notes')),
      el('ul.list', { style: { border: '1px solid var(--line-soft)', borderRadius: '8px' } }, ...quality)) : null
  );
}

async function handleFile(file, rerender) {
  const busy = toast(`Reading ${file.name}…`, 60000);
  try {
    const buf = await file.arrayBuffer();
    const result = await importWorkbook(buf, { fileName: file.name });
    const diff = diffRevisions(state.orders, result.orders);

    modal(`Import ${file.name}`, changeReport(diff, result.report), {
      wide: true,
      actions: [
        { label: 'Cancel', onClick: (dlg) => dlg.close() },
        {
          label: `Load ${fmtNum(result.orders.length)} orders`, class: 'primary',
          onClick: (dlg) => {
            setImport(result);
            toast(`Loaded ${result.orders.length} orders from ${file.name}`);
            dlg.close();
            rerender();
          }
        },
      ],
    });
  } catch (e) {
    modal('Import failed', el('div', {},
      el('p', {}, e.message),
      el('p.small.muted', {}, 'The schedule already loaded has not been changed.')));
  } finally {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
  }
}

/* ---------- view ---------- */

export function renderData(rerender) {
  const meta = state.meta;

  const drop = el('div.drop', {},
    el('div', { style: { fontSize: '15px', fontWeight: '600', marginBottom: '4px' } },
      'Drop the Daily Schedule workbook here'),
    el('div.small', {}, 'or'),
    el('div', { style: { marginTop: '10px' } },
      el('button.primary', {
        onclick: () => {
          const inp = el('input', { type: 'file', accept: '.xlsx', style: { display: 'none' } });
          inp.addEventListener('change', () => {
            if (inp.files[0]) handleFile(inp.files[0], rerender);
          });
          document.body.append(inp);
          inp.click();
          inp.remove();
        },
      }, 'Choose file')),
    el('div.small.muted', { style: { marginTop: '10px' } },
      'Reads the Daily Sched, WIP, PREP Tracker and screens sch sheets. Nothing is uploaded anywhere.'));

  for (const ev of ['dragenter', 'dragover']) {
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  }
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f, rerender);
  });

  const importPanel = el('div.panel', {},
    el('header', {}, 'Schedule revision',
      el('span.spacer'),
      meta.fileName ? el('span.small.muted', {}, `${meta.fileName} · loaded ${fmtWhen(meta.importedAt)}`) : null),
    el('div.body', {}, drop));

  /* shared file */
  const connected = sharedFileName();
  const sharedBody = el('div.body', {});

  if (!supportsSharedFile()) {
    sharedBody.append(el('div.banner.warn', {},
      el('div', {},
        el('strong', {}, 'This browser cannot open a shared file. '),
        'Chrome or Edge is needed for live sharing. Until then, use Export and Import below to pass data around.')));
  } else if (pendingHandle) {
    sharedBody.append(
      el('div.banner.info', { style: { marginBottom: '12px' } },
        el('div', {}, `Reconnect to ${pendingHandle.name} — the browser needs permission again after a restart.`)),
      el('button.primary', {
        onclick: async () => {
          try {
            const name = await grantSharedFile(pendingHandle);
            pendingHandle = null;
            toast(`Connected to ${name}`);
            rerender();
          } catch (e) { toast(e.message); }
        },
      }, 'Reconnect'));
  } else if (connected) {
    sharedBody.append(
      el('div.banner.ok', { style: { marginBottom: '12px' } },
        el('div', {}, el('strong', {}, 'Connected: '), connected,
          el('div.small', { style: { marginTop: '4px' } },
            'Changes save here automatically. Other people pointing at the same file will pick them up.'))),
      el('div.row', {},
        el('button', {
          onclick: async () => { await pullSharedFile(); toast('Refreshed from shared file'); rerender(); },
        }, 'Refresh now'),
        el('button.ghost', {
          onclick: () => { disconnectSharedFile(); toast('Disconnected'); rerender(); },
        }, 'Disconnect')));
  } else {
    sharedBody.append(
      el('p.small.muted', { style: { marginTop: 0 } },
        'Point everyone at one JSON file on the shared drive (or a synced SharePoint folder) and the department sees the same board. ' +
        'Each person connects once on their own PC.'),
      el('div.row', {},
        el('button.primary', {
          onclick: async () => {
            try { toast(`Connected to ${await connectSharedFile()}`); rerender(); }
            catch (e) { if (e.name !== 'AbortError') toast(e.message); }
          },
        }, 'Open existing shared file'),
        el('button', {
          onclick: async () => {
            try { toast(`Created ${await connectSharedFile({ create: true })}`); rerender(); }
            catch (e) { if (e.name !== 'AbortError') toast(e.message); }
          },
        }, 'Create a new one')),
      el('div.banner.warn', { style: { marginTop: '12px' } },
        el('div', {},
          el('strong', {}, 'Two people editing the same order at once: '),
          'the app merges record by record and the most recent edit wins for that one field. ' +
          'Separate orders never overwrite each other.')));
  }

  const sharedPanel = el('div.panel', {}, el('header', {}, 'Shared file'), sharedBody);

  /* backup */
  const backupPanel = el('div.panel', {},
    el('header', {}, 'Backup & transfer'),
    el('div.body', {},
      el('div.row', {},
        el('button', {
          onclick: () => {
            download(`cutting-tracker-${new Date().toISOString().slice(0, 10)}.json`, exportJson());
            toast('Exported');
          },
        }, 'Export everything'),
        el('button', {
          onclick: () => {
            const inp = el('input', { type: 'file', accept: '.json', style: { display: 'none' } });
            inp.addEventListener('change', async () => {
              if (!inp.files[0]) return;
              try {
                importJson(await inp.files[0].text(), { merge: true });
                toast('Merged');
                rerender();
              } catch (e) { toast('Could not read that file'); }
            });
            document.body.append(inp); inp.click(); inp.remove();
          },
        }, 'Import a backup'),
        el('button', {
          onclick: () => { seedGuide(); toast('Starter guide sections restored'); rerender(); },
        }, 'Restore starter guide'),
        el('span.spacer'),
        el('button.danger', {
          onclick: async () => {
            if (await confirmDialog('Clear everything on this device?',
              'Progress, shift logs, plans and guide edits stored in this browser will be deleted. If you are connected to a shared file, that file is not touched.',
              { confirmLabel: 'Clear', danger: true })) {
              resetAll();
              location.reload();
            }
          },
        }, 'Clear this device')),
      el('div.small.muted', { style: { marginTop: '10px' } },
        'Export writes one JSON file containing the schedule, all logged progress, shift updates, plans and the guide.')));

  /* people */
  const peopleInput = el('input', { placeholder: 'Add a name', style: { maxWidth: '220px' } });
  const peoplePanel = el('div.panel', {},
    el('header', {}, 'Who is using this'),
    el('div.body', {},
      el('div.row', { style: { marginBottom: '12px' } },
        peopleInput,
        el('button', {
          onclick: () => {
            const n = peopleInput.value.trim();
            if (!n) return;
            if (!state.people.includes(n)) state.people.push(n);
            if (!state.settings.me) state.settings.me = n;
            save(); peopleInput.value = ''; rerender();
          },
        }, 'Add')),
      state.people.length
        ? el('div.tag-row', {}, ...state.people.map((p) => el('span.chip' + (p === me() ? '.ok' : ''), {},
            p,
            el('button.ghost.sm', {
              style: { padding: '0 2px', border: 'none' },
              onclick: () => {
                state.people = state.people.filter((x) => x !== p);
                if (state.settings.me === p) state.settings.me = state.people[0] || null;
                save(); rerender();
              },
            }, '×'))))
        : el('div.small.muted', {}, 'No names yet. Add the people on your crew so updates are attributed.')));

  /* audit */
  const auditPanel = el('div.panel', {},
    el('header', {}, 'Recent activity'),
    state.audit.length
      ? el('ul.list', {}, ...state.audit.slice(0, 30).map((a) => el('li', {},
          el('div.row.small', {},
            el('strong', {}, a.who),
            el('span', {}, a.what),
            el('span.muted', {}, a.detail || ''),
            el('span.spacer'),
            el('span.muted.nowrap', {}, fmtWhen(a.at))))))
      : el('div.empty', {}, 'Nothing yet.'));

  return el('div', {}, importPanel,
    el('div.grid.two', { style: { marginTop: '16px' } },
      el('div', {}, sharedPanel, peoplePanel),
      el('div', {}, backupPanel, auditPanel)));
}
