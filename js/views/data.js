/* Setup: load the Rolling and CNC schedules, manage the shared file everyone
   syncs through, and keep the list of who is using it. */

import { el, chip, icon, fmtNum, fmtWhen, toast, modal, download, confirmDialog } from '../ui.js';
import {
  state, setMachineImport, save, exportJson, importJson, resetAll,
  connectSharedFile, reconnectSharedFile, grantSharedFile, pullSharedFile,
  supportsSharedFile, sharedFileName, disconnectSharedFile, me,
  connectCloud, disconnectCloud, cloudStatus, cloudConfig, retrySync,
  sharedFileStatus, storageStatus,
} from '../store.js';
import { importMachineWorkbook } from '../import-machines.js';
import { staleImports } from '../model.js';
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

    // A sheet that came in empty is worth as much attention as one that was
    // missing: both mean a machine's queue will be blank, and the difference
    // between "the tab was renamed" and "the tab is genuinely clear" is the
    // difference between a bug and a quiet day.
    const empty = r.sheets.filter((sh) => !sh.rows);
    const unknown = r.sheets.filter((sh) => !MACHINE_BY_KEY[sh.machine]);

    modal(`Imported ${file.name}`, el('div', {},
      el('div.stats.import-stats', {},
        el('div.stat', {}, el('div.n', {}, fmtNum(r.count)), el('div.k', {}, 'Lines')),
        el('div.stat', {}, el('div.n', {}, String(r.sheets.length)), el('div.k', {}, 'Sheets read')),
        el('div.stat' + (r.missing.length ? '.bad' : ''), {},
          el('div.n', {}, String(r.missing.length)), el('div.k', {}, 'Not found'))),
      el('ul.list.import-sheets', {},
        ...r.sheets.map((sh) => el('li', {},
          el('div.row.small', {},
            el('strong', {}, sh.sheet),
            el('span.muted', {}, MACHINE_BY_KEY[sh.machine]?.label || sh.machine),
            !MACHINE_BY_KEY[sh.machine] ? chip('unrecognised machine', 'warn') : null,
            !sh.rows ? chip('no rows', 'warn') : null,
            el('span.spacer'),
            el('span.mono', {}, fmtNum(sh.rows) + ' rows'))))),

      r.missing.length ? el('div.banner.bad', { style: { marginTop: '12px' } },
        el('div', {},
          el('strong', {}, `${r.missing.length} sheet${r.missing.length > 1 ? 's were' : ' was'} not found: `),
          r.missing.join(', '),
          el('div.small', { style: { marginTop: '4px' } },
            'Those machines will show an empty queue. Usually the tab was renamed '
            + 'or hidden in Excel — check the workbook and import again.'))) : null,

      empty.length ? el('div.banner.warn', { style: { marginTop: '12px' } },
        el('div', {},
          el('strong', {}, 'Read but empty: '),
          empty.map((sh) => sh.sheet).join(', '),
          el('div.small', { style: { marginTop: '4px' } },
            'The tab was found with no schedule rows in it.'))) : null,

      unknown.length ? el('div.banner.warn', { style: { marginTop: '12px' } },
        el('div', {},
          el('strong', {}, 'Machines this app does not know: '),
          unknown.map((sh) => sh.machine).join(', '),
          el('div.small', { style: { marginTop: '4px' } },
            'Their lines were loaded but will not appear on any centre page.'))) : null));
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

/* ---------- cloud sync ---------- */

/* The shared file needs the File System Access API, which no phone browser
   has. This is the same sync over HTTPS, so the tracker can be open on a phone
   on the floor and a PC in the office at the same time. */

const SETUP_SQL = `create table if not exists tracker_state (
  site text not null,
  part text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (site, part)
);
alter table tracker_state enable row level security;
create policy "tracker read"   on tracker_state for select using (true);
create policy "tracker insert" on tracker_state for insert with check (true);
create policy "tracker update" on tracker_state for update using (true) with check (true);`;

function sqlDialog() {
  const box = el('textarea', {
    value: SETUP_SQL,
    readonly: true,
    style: { minHeight: '260px', fontFamily: 'var(--mono)', fontSize: '12px' },
  });
  modal('Run this once in Supabase', el('div', {},
    el('p.small.muted', { style: { marginTop: 0 } },
      'Supabase → SQL Editor → New query → paste → Run. It makes the one table '
      + 'the tracker syncs through.'),
    box,
    el('div.banner.warn', { style: { marginTop: '12px' } },
      el('div', {},
        el('strong', {}, 'Anyone with the address and the key can read and write this data. '),
        'There is no login. Keep the key to the department, the same way the network share is kept to the department.'))),
    {
      wide: true,
      actions: [{
        label: 'Copy SQL', class: 'primary', onClick: async () => {
          try {
            await navigator.clipboard.writeText(SETUP_SQL);
            toast('SQL copied');
          } catch { box.select(); toast('Select and copy the text'); }
        },
      }],
    });
}

function cloudSection(rerender) {
  const st = cloudStatus();
  const cfg = cloudConfig();
  const body = el('div.body', {});

  if (st.on) {
    const busy = st.pushing || st.pulling;
    const attention = st.error || st.pending;
    body.append(
      el('div.banner' + (st.error ? '.bad' : attention ? '.warn' : '.ok'), { style: { marginBottom: '12px' } },
        el('div', {},
          el('strong', {}, st.error ? 'Sync problem: ' : busy ? 'Syncing now: ' : st.pending ? 'Waiting to sync: ' : 'Up to date: '),
          st.error || (st.pending ? `${st.pending} pending change${st.pending === 1 ? '' : 's'}` : st.where),
          el('div.small', { style: { marginTop: '4px' } },
            st.error
              ? 'Your work is still saved on this device and will go up once this is fixed.'
              : `${st.where}.${st.at ? ` Last successful sync ${fmtWhen(st.at)}.` : ' Connecting for the first time.'}`))),
      el('div.row', {},
        el('button', {
          onclick: async () => {
            const ok = await retrySync();
            toast(ok ? 'Sync complete' : 'Sync still needs attention');
            rerender();
          },
        }, icon(st.error ? 'alert' : 'cloud', { size: 14 }), st.error || st.pending ? ' Retry now' : ' Check now'),
        el('button', { onclick: sqlDialog }, 'Show setup SQL'),
        el('button.ghost', {
          onclick: async () => {
            const ok = await confirmDialog('Stop syncing this device?',
              'Work already sent stays in the cloud. This device keeps its own copy and stops sending updates.',
              { confirmLabel: 'Stop syncing' });
            if (!ok) return;
            disconnectCloud(); toast('Sync off'); rerender();
          },
        }, 'Stop syncing')));
    return el('div.panel', {}, el('header', {}, 'Sync across devices'), body);
  }

  const url = el('input', {
    value: cfg?.url || '', placeholder: 'https://xxxxxxxx.supabase.co',
    autocapitalize: 'off', spellcheck: false,
  });
  const key = el('input', {
    value: cfg?.key || '', placeholder: 'anon public key',
    autocapitalize: 'off', spellcheck: false,
  });
  const site = el('input', { value: cfg?.site || 'cutting', placeholder: 'cutting' });

  body.append(
    el('p.small.muted', { style: { marginTop: 0 } },
      'Connect this device to a free Supabase project and the tracker works on '
      + 'phones too — statuses, notes, rush, back orders and shift updates all '
      + 'merge line by line, exactly as they do through the shared file.'),
    el('ol.small.muted.cloud-steps', {},
      el('li', {}, 'Make a free project at supabase.com.'),
      el('li', {}, 'Run the setup SQL once — ',
        el('button.linkbtn', { onclick: sqlDialog }, 'show it'), '.'),
      el('li', {}, 'Copy the Project URL and the anon public key from Settings → API, and paste them here.'),
      el('li', {}, 'Do the same on every phone and PC, with the same site name.')),

    el('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: '12px', marginTop: '14px' } },
      el('label.field', {}, el('span', {}, 'Project URL'), url),
      el('label.field', {}, el('span', {}, 'Anon public key'), key),
      el('label.field', {}, el('span', {}, 'Site name',
        el('em.of-total', {}, 'same on every device')), site)),

    el('div.row', { style: { marginTop: '14px' } },
      el('button.primary', {
        onclick: async (e) => {
          const btn = e.target;
          btn.disabled = true;
          btn.textContent = 'Checking…';
          try {
            const where = await connectCloud({
              url: url.value, key: key.value, site: site.value,
            });
            toast(`Syncing with ${where}`);
            rerender();
          } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Connect';
            modal('Could not connect', el('div', {},
              el('p', {}, err.message),
              el('p.small.muted', {},
                'Nothing was changed. Your data is still on this device.')));
          }
        },
      }, 'Connect')));

  return el('div.panel', {}, el('header', {}, 'Sync across devices'), body);
}

/* ---------- view ---------- */

/* Getting a fresh install usable is four things in order, and until they are
   done the page is a to-do list rather than a settings screen. Once they are,
   it collapses to a single line of confirmation instead of nagging. */
function firstRun(rerender) {
  const mm = state.machineMeta || {};
  const sharing = cloudStatus().on || !!sharedFileName();

  const steps = [
    { n: 1, label: 'Import the Rolling schedule', done: !!mm.rolling,
      hint: 'Auto, Manual and Complete sheets' },
    { n: 2, label: 'Import the CNC schedule', done: !!mm.cnc,
      hint: 'FOM 1–3, Multi Punch, CNC & FMC, and the shift update' },
    { n: 3, label: 'Set up sharing', done: sharing,
      hint: 'Cloud sync for phones, or one file on the shared drive' },
    { n: 4, label: 'Add the crew', done: (state.people || []).length > 0,
      hint: 'So every change is recorded against a name' },
  ];
  const left = steps.filter((s) => !s.done);

  if (!left.length) {
    return el('div.panel.setup-done', {},
      el('div.body.row', {},
        el('span.setup-tick', {}, icon('check', { size: 14 })),
        el('strong', {}, 'Set up and ready'),
        el('span.small.muted', {},
          `${fmtNum((state.tasks || []).length)} lines loaded · `
          + `${cloudStatus().on ? 'syncing to the cloud' : sharedFileName() ? 'sharing a file' : ''}`
          + ` · ${state.people.length} on the crew`)));
  }

  return el('div.panel.setup-steps', {},
    el('header', {}, `Getting started — ${steps.length - left.length} of ${steps.length} done`),
    el('div.body.flush', {},
      el('ol.setup-list', {}, ...steps.map((s) => el('li.setup-step' + (s.done ? '.done' : ''), {},
        el('span.setup-num', {}, s.done ? icon('check', { size: 14 }) : String(s.n)),
        el('div', {},
          el('div.setup-label', {}, s.label),
          el('div.small.muted', {}, s.hint)))))));
}

export function renderData(rerender) {
  const mm = state.machineMeta || {};
  const sharing = cloudStatus().on || !!sharedFileName();
  const sharingProblem = cloudStatus().error || sharedFileStatus().error;
  const storage = storageStatus();
  const slot = (label, key, node) => el('div', {},
    el('div.row', { style: { marginBottom: '6px' } },
      el('strong.small', {}, label),
      el('span.spacer'),
      mm[key]?.fileName
        ? el('span.small.muted', {}, `${mm[key].fileName} · ${fmtNum(mm[key].count)} lines · ${fmtWhen(mm[key].importedAt)}`)
        : chip('not loaded', 'warn')),
    node);

  // A parsing fix only takes effect on the next import, so data loaded before
  // one keeps showing whatever the old parser made of the file. Without this
  // the only clue is that the numbers look odd.
  const stale = staleImports();
  const KIND_LABEL = { rolling: 'Rolling', cnc: 'CNC' };

  const importPanel = el('div.panel', {},
    el('header', {}, 'Schedules'),
    el('div.body', {},
      stale.length ? el('div.banner.warn', { style: { marginBottom: '14px' } },
        el('div', {},
          el('strong', {}, `Re-import the ${stale.map((k) => KIND_LABEL[k]).join(' and ')} `
            + `workbook${stale.length > 1 ? 's' : ''}. `),
          'This data was read by an older version of the app. Everything you have '
          + 'set — statuses, notes, rush, back orders — is kept; only what the '
          + 'workbook itself says is re-read.')) : null,
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
          'the app merges line by line and the later saved revision wins for that one line. ' +
          'Separate lines never overwrite each other.')));
  }

  const sharedPanel = el('div.panel', {}, el('header', {}, 'Shared file'), sharedBody);

  const cloudPanel = cloudSection(rerender);

  /* Backup and reset. Kept apart from everything above and folded shut by
     default: these are the rarely-used controls, and one of them wipes the
     device. It should take a deliberate click to even see it. */
  const backupPanel = el('details.panel.setup-advanced', {},
    el('summary', {},
      icon('chevron', { size: 14 }),
      el('span', {}, 'Backup, transfer and reset'),
      el('span.small.muted', {}, 'Rarely needed')),
    el('div.body', {},
      el('div.row', {},
        el('button', {
          onclick: () => {
            download(`cutting-tracker-${new Date().toISOString().slice(0, 10)}.json`, exportJson());
            state.settings.lastBackupAt = new Date().toISOString();
            save();
            toast('Exported');
            rerender();
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
        }, 'Import a backup')),
      el('div.small.muted', { style: { marginTop: '10px' } },
        'Export writes one JSON file containing the loaded schedules and every status set against them.'),

      el('div.dangerzone', {},
        el('div', {},
          el('strong', {}, 'Clear this device'),
          el('div.small.muted', {},
            'Deletes the loaded schedules and every status set in this browser. '
            + 'A shared file or cloud project is not touched.')),
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
        }, 'Clear this device'))));

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

  const health = [
    {
      label: 'Schedules', ok: !!mm.rolling && !!mm.cnc, icon: 'list',
      value: mm.rolling && mm.cnc
        ? `${fmtNum((state.tasks || []).length)} lines loaded`
        : 'Both workbooks are required',
    },
    {
      label: 'Sharing', ok: sharing && !sharingProblem, icon: sharingProblem ? 'alert' : 'cloud',
      value: sharingProblem ? 'Sync needs attention'
        : cloudStatus().on ? 'Cloud sync connected'
        : sharedFileName() ? 'Shared file connected' : 'This device only',
    },
    {
      label: 'Device storage', ok: storage.ok, icon: storage.ok ? 'check' : 'alert',
      value: storage.ok ? 'Saving normally' : storage.error,
    },
    {
      label: 'Crew identity', ok: (state.people || []).length > 0, icon: 'dot',
      value: state.people.length ? `${state.people.length} people · ${me()}` : 'Add the crew',
    },
    {
      label: 'Latest backup', ok: !!state.settings.lastBackupAt, icon: 'clock',
      value: state.settings.lastBackupAt ? fmtWhen(state.settings.lastBackupAt) : 'No backup recorded',
    },
  ];

  return el('div.setup-page', {},
    el('div.setup-heading', {},
      el('h1', {}, 'Setup'),
      el('p', {}, 'Data readiness, sharing, people and recovery for this device.')),
    el('div.setup-health', {}, ...health.map((h) => el('div.setup-health-card' + (h.ok ? '.ok' : '.warn'), {},
      el('span.setup-health-icon', {}, icon(h.icon, { size: 16 })),
      el('div', {},
        el('span.setup-health-label', {}, h.label),
        el('strong', {}, h.value))))),
    firstRun(rerender),
    el('div', { style: { marginTop: '16px' } }, importPanel),
    el('div.grid.two', { style: { marginTop: '16px' } },
      el('div', {}, cloudPanel, sharedPanel),
      el('div', {}, peoplePanel)),
    el('div', { style: { marginTop: '16px' } }, backupPanel));
}
