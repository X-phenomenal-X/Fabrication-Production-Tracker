/* Setup: load the Rolling and CNC schedules, manage the shared file everyone
   syncs through, and keep the list of who is using it. */

import { el, chip, fmtNum, fmtWhen, toast, modal, download, confirmDialog } from '../ui.js';
import {
  state, setMachineImport, save, exportJson, importJson, resetAll,
  connectSharedFile, reconnectSharedFile, grantSharedFile, pullSharedFile,
  supportsSharedFile, sharedFileName, disconnectSharedFile, me,
} from '../store.js';
import { importMachineWorkbook } from '../import-machines.js';
import { MACHINE_BY_KEY } from '../machines.js';

let pendingHandle = null;

export async function initSharedFile(rerender) {
  if (!supportsSharedFile()) return;
  try {
    const r = await reconnectSharedFile();
    if (r?.needsPermission) pendingHandle = r.handle;
    rerender();
  } catch { /* nothing stored yet */ }
}

/* ---------- import ---------- */

async function handleMachineFile(file, kind, rerender) {
  toast(`Reading ${file.name}…`, 60000);
  try {
    const buf = await file.arrayBuffer();
    const result = await importMachineWorkbook(buf, { kind, fileName: file.name });
    const r = result.report;
    setMachineImport(result);
    toast(`Loaded ${result.tasks.length} lines from ${file.name}`);
    modal(`Imported ${file.name}`, el('div', {},
      el('div.stats', { style: { border: '1px solid var(--line-soft)', borderRadius: '8px', overflow: 'hidden', marginBottom: '14px' } },
        el('div.stat', {}, el('div.n', {}, fmtNum(r.count)), el('div.k', {}, 'Lines')),
        el('div.stat', {}, el('div.n', {}, String(r.sheets.length)), el('div.k', {}, 'Sheets'))),
      el('ul.list', { style: { border: '1px solid var(--line-soft)', borderRadius: '8px' } },
        ...r.sheets.map((sh) => el('li', {},
          el('div.row.small', {},
            el('strong', {}, sh.sheet),
            el('span.muted', {}, MACHINE_BY_KEY[sh.machine]?.label || sh.machine),
            el('span.spacer'),
            el('span.mono', {}, fmtNum(sh.rows) + ' rows'))))),
      r.missing.length ? el('div.banner.warn', { style: { marginTop: '12px' } },
        el('div', {}, 'Sheets not found: ' + r.missing.join(', '))) : null));
    rerender();
  } catch (e) {
    modal('Import failed', el('div', {},
      el('p', {}, e.message),
      el('p.small.muted', {}, 'Nothing already loaded has been changed.')));
  } finally {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
  }
}

/** One drop zone, used for each workbook. */
function dropZone({ title, hint, onFile }) {
  const zone = el('div.drop', {},
    el('div', { style: { fontSize: '14px', fontWeight: '600', marginBottom: '4px' } }, title),
    el('div.small.muted', { style: { marginBottom: '10px' } }, hint),
    el('button.primary.sm', {
      onclick: () => {
        const inp = el('input', { type: 'file', accept: '.xlsx', style: { display: 'none' } });
        inp.addEventListener('change', () => { if (inp.files[0]) onFile(inp.files[0]); });
        document.body.append(inp); inp.click(); inp.remove();
      },
    }, 'Choose file'));

  for (const ev of ['dragenter', 'dragover']) {
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); });
  }
  zone.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) onFile(f);
  });
  return zone;
}

/* ---------- view ---------- */

export function renderData(rerender) {
  const mm = state.machineMeta || {};
  const slot = (label, key, node) => el('div', {},
    el('div.row', { style: { marginBottom: '6px' } },
      el('strong.small', {}, label),
      el('span.spacer'),
      mm[key]?.fileName
        ? el('span.small.muted', {}, `${mm[key].fileName} · ${fmtNum(mm[key].count)} lines · ${fmtWhen(mm[key].importedAt)}`)
        : chip('not loaded', 'warn')),
    node);

  const importPanel = el('div.panel', {},
    el('header', {}, 'Schedules'),
    el('div.body', {},
      el('p.small.muted', { style: { marginTop: 0 } },
        'These two workbooks are the whole source of truth. Re-import either one ' +
        'whenever a new revision comes out — statuses you have set are kept.'),
      el('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '14px' } },
        slot('Rolling schedule', 'rolling', dropZone({
          title: 'Rolling workbook',
          hint: 'Auto, Manual and Complete sheets',
          onFile: (f) => handleMachineFile(f, 'rolling', rerender),
        })),
        slot('CNC schedule', 'cnc', dropZone({
          title: 'CNC workbook',
          hint: 'FOM 1-3, MultiPunch & SAW, CNC & FMC',
          onFile: (f) => handleMachineFile(f, 'cnc', rerender),
        })))));

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
          el('strong', {}, 'Two people updating the same line at once: '),
          'the app merges line by line and the most recent update wins for that one line. ' +
          'Separate lines never overwrite each other.')));
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
        el('span.spacer'),
        el('button.danger', {
          onclick: async () => {
            if (await confirmDialog('Clear everything on this device?',
              'The loaded schedules and every status set in this browser will be deleted. If you are connected to a shared file, that file is not touched.',
              { confirmLabel: 'Clear', danger: true })) {
              resetAll();
              location.reload();
            }
          },
        }, 'Clear this device')),
      el('div.small.muted', { style: { marginTop: '10px' } },
        'Export writes one JSON file containing the loaded schedules and every status set against them.')));

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

  return el('div', {}, importPanel,
    el('div.grid.two', { style: { marginTop: '16px' } },
      el('div', {}, sharedPanel),
      el('div', {}, backupPanel, peoplePanel)));
}
