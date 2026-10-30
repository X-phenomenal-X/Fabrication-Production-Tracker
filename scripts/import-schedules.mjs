/* Weekday schedule import.

   Reads the same workbooks Setup imports by hand, and writes only the shared
   schedules document. Statuses, notes and handovers stay where they are.

   node scripts/import-schedules.mjs --rolling <file> --cnc <file> [--daily <file>] [--dry-run]

   Sign-in comes from the environment, never from the command line:
     SUPABASE_URL, SUPABASE_ANON_KEY
     SUPABASE_EMAIL and SUPABASE_PASSWORD for the automation editor
   A refresh token is accepted instead of the password. See the README. */

import '../scripts/node-dom.mjs';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { importDailySchedule } from '../js/import-daily.js';
import {
  SHIFT_UPDATE_SHEET,
  importMachineWorkbook,
} from '../js/import-machines.js';
import { planScheduleUpdate } from '../js/store.js';
import {
  CloudError,
  authSession,
  cloudPull,
  cloudPush,
  refreshMembership,
  setCloudConfig,
} from '../js/cloud.js';

const HELP = `Import the Cutting schedules into the shared tracker.

node scripts/import-schedules.mjs --rolling <file> --cnc <file> [--daily <file>] [--dry-run]

--rolling   Rolling schedule. Current file: Rolling Schedule_2026.xlsx
            Sheets read: Auto, Manual, Complete
--cnc       CNC schedule. Current file: CNC Schedule_Rev E.xlsx
            Sheets read: FOM1, FOM2, FOM3, CNC & FMC, Shift Update
            MultiPunch & SAW is read when that tab is present
            The Daily Sched tab inside this file is not the daily schedule
--daily     Separate Daily Schedule workbook. Optional.
            Example: Daily Schedule Oct 13 Rev B.xlsx
            Sheet: Daily Sched, with a W/O # header
--dry-run   Print what would change and save nothing

The cloud is the environment, not the command:
  SUPABASE_URL and SUPABASE_ANON_KEY (the publishable key)
  SUPABASE_EMAIL and SUPABASE_PASSWORD are optional
  TRACKER_SITE defaults to "Cutting Dept."`;

const REQUIRED = {
  rolling: ['Auto', 'Manual', 'Complete'],
  cnc: ['FOM1', 'FOM2', 'FOM3', 'CNC & FMC', SHIFT_UPDATE_SHEET],
};

const SESSION_KEY = 'bv.cutting.auth';

export class ImportError extends Error {}

function saved(message) {
  const text = String(message || 'The import failed.').trim();
  return /nothing was saved\.?$/i.test(text) ? text : `${text} Nothing was saved.`;
}

export function parseArgs(argv) {
  const out = { cnc: null, rolling: null, daily: null, dryRun: false, help: false, order: [] };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { out.help = true; continue; }
    if (arg === '--dry-run') { out.dryRun = true; continue; }
    if (arg === '--cnc' || arg === '--rolling' || arg === '--daily') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) throw new ImportError(saved(`Missing the file after ${arg}.`));
      const kind = arg.slice(2);
      if (out[kind]) throw new ImportError(saved(`${arg} was given twice.`));
      out[kind] = value;
      out.order.push(kind);
      i += 1;
      continue;
    }
    throw new ImportError(`${saved(`Unknown option ${arg}.`)}\n${HELP}`);
  }
  return out;
}

function assertRealFile(file) {
  const base = path.basename(file);
  if (/autorecovered/i.test(base) || base.startsWith('~$')) {
    throw new ImportError(saved(`${base} is an Excel recovery or lock file, not a schedule to import.`));
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new ImportError(saved(`Cannot find the workbook ${file}.`));
  }
}

function readWorkbook(file) {
  const buf = fs.readFileSync(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function loadMachine(file, kind) {
  assertRealFile(file);
  const fileName = path.basename(file);
  let parsed;
  try {
    parsed = await importMachineWorkbook(readWorkbook(file), { kind, fileName });
  } catch (error) {
    throw new ImportError(saved(error.message));
  }
  const fatalMissing = REQUIRED[kind].filter((name) => parsed.report.missing.includes(name));
  const bad = parsed.report.badHeaders || [];
  if (fatalMissing.length || bad.length) {
    const problems = [];
    if (fatalMissing.length) problems.push(`missing sheet ${fatalMissing.map((name) => `"${name}"`).join(', ')}`);
    if (bad.length) problems.push(`no WO# or W/O # header on ${bad.map((name) => `"${name}"`).join(', ')}`);
    const found = (parsed.report.workbookSheets || []).join(', ') || 'none';
    const label = kind === 'cnc' ? 'CNC' : 'Rolling';
    throw new ImportError(saved(`${fileName} is not the ${label} schedule (${problems.join('; ')}). Sheets found: ${found}.`));
  }
  const warnings = [];
  for (const name of parsed.report.missing) {
    if (!REQUIRED[kind].includes(name)) {
      warnings.push(`No "${name}" sheet, so jobs from that sheet are removed, same as importing this file by hand.`);
    }
  }
  for (const sheet of parsed.report.sheets) {
    if (!sheet.rows) warnings.push(`${sheet.sheet} had no job rows.`);
  }
  if (parsed.report.shiftUpdate?.unknown?.length) {
    warnings.push(`Shift update mentions ${parsed.report.shiftUpdate.unknown.join(', ')}, which this tracker does not show.`);
  }
  const notes = [];
  if (parsed.report.shiftSheet && parsed.report.shiftSheet !== SHIFT_UPDATE_SHEET) {
    notes.push(`Shift update was read from the tab "${parsed.report.shiftSheet}".`);
  }
  return {
    kind,
    fileName,
    tasks: parsed.tasks,
    shiftUpdate: parsed.shiftUpdate,
    report: parsed.report,
    warnings,
    notes,
  };
}

async function loadDaily(file) {
  assertRealFile(file);
  const fileName = path.basename(file);
  let parsed;
  try {
    parsed = await importDailySchedule(readWorkbook(file), { fileName });
  } catch (error) {
    throw new ImportError(saved(error.message));
  }
  if (!parsed.report.woHeaderFound) {
    throw new ImportError(saved(
      `${fileName} has a "Daily Sched" sheet but no "W/O #" header in the first rows. It does not look like the Daily Schedule.`,
    ));
  }
  return {
    kind: 'daily',
    fileName,
    rows: parsed.rows,
    report: parsed.report,
    warnings: [],
    notes: [],
  };
}

function tokenRole(token) {
  const part = String(token || '').split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString()).role || null;
  } catch {
    return null;
  }
}

function tokenPayload(token) {
  const part = String(token || '').split('.')[1];
  if (!part) return {};
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString());
  } catch {
    return {};
  }
}

async function authRequest(cfg, grant, body) {
  let response;
  try {
    response = await fetch(`${cfg.url}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new ImportError(saved(`Could not reach Supabase.${error?.message ? ` (${error.message})` : ''}`));
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new ImportError(saved('Sign-in failed. Check the automation email and password.'));
  }
  return payload;
}

function rememberSession(body) {
  const payload = tokenPayload(body.access_token);
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    accessToken: body.access_token,
    refreshToken: body.refresh_token || null,
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
    email: body.user?.email || payload.email || null,
    userId: body.user?.id || payload.sub || null,
    role: 'pending',
  }));
}

async function signIn(env) {
  const url = String(env.SUPABASE_URL || '').trim();
  const key = String(env.SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) {
    throw new ImportError(saved('Set SUPABASE_URL and SUPABASE_ANON_KEY.'));
  }
  if (tokenRole(key) === 'service_role') {
    throw new ImportError(saved('The service role key cannot be used. Use the anon key and an editor account.'));
  }
  const cfg = {
    url: url.replace(/\/+$/, ''),
    key,
    site: String(env.TRACKER_SITE || 'Cutting Dept.').trim() || 'Cutting Dept.',
  };
  setCloudConfig(cfg);

  const email = String(env.SUPABASE_EMAIL || '').trim();
  const password = String(env.SUPABASE_PASSWORD || '');
  let refresh = String(env.SUPABASE_REFRESH_TOKEN || '').trim();
  const refreshFile = String(env.SUPABASE_REFRESH_TOKEN_FILE || '').trim();
  if (!refresh && refreshFile && fs.existsSync(refreshFile)) {
    refresh = fs.readFileSync(refreshFile, 'utf8').trim();
  }
  // The Cutting board is open to the publishable key. Email is only for a
  // project that has already been locked to invited editors.
  if (!email && !password && !refresh) {
    localStorage.removeItem(SESSION_KEY);
    return cfg;
  }
  let body;
  if (email && password) body = await authRequest(cfg, 'password', { email, password });
  else if (refresh) body = await authRequest(cfg, 'refresh_token', { refresh_token: refresh });
  else {
    throw new ImportError(saved('Set SUPABASE_EMAIL and SUPABASE_PASSWORD for the automation editor account.'));
  }
  if (refreshFile && body.refresh_token && body.refresh_token !== refresh) {
    fs.writeFileSync(refreshFile, `${body.refresh_token}\n`, { mode: 0o600 });
  }
  rememberSession(body);
  const role = await refreshMembership();
  if (role !== 'editor') {
    const why = role === 'viewer' ? 'it is a viewer and cannot change the board'
      : role === 'none' ? 'it is not on the Cutting list'
        : role === 'legacy' ? 'the member list is not set up yet'
          : 'its editor permission could not be confirmed';
    throw new ImportError(saved(`Signed in, but ${why}.`));
  }
  return cfg;
}

function printSummary(planned, { dryRun }) {
  for (const file of planned.files) {
    if (file.status === 'unchanged') {
      console.log(`${file.fileName}: unchanged, skipped`);
    } else {
      const verb = dryRun ? 'would load' : 'loaded';
      const shift = file.shiftChanged ? '; shift update changed' : '';
      console.log(`${file.fileName}: ${verb}, ${file.count} ${file.noun} (added ${file.diff.added}, changed ${file.diff.changed}, removed ${file.diff.removed})${shift}`);
    }
    for (const note of file.notes || []) console.log(`  note: ${note}`);
    for (const warning of file.warnings || []) console.log(`  warning: ${warning}`);
  }
  if (dryRun) console.log('Dry run. Nothing was saved.');
  else if (!planned.changed) console.log('No schedule changes. Nothing was saved.');
  else console.log('Saved the schedules. Statuses, notes and handovers were left as they are.');
}

async function previewSchedules(cfg, loaded, by) {
  const remote = await cloudPull(['base'], cfg);
  return { ...planScheduleUpdate(remote?.base, loaded, by), saved: false };
}

async function commitSchedules(cfg, loaded, by) {
  let planned = null;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const remote = await cloudPull(['base'], cfg);
    const expected = remote?.updatedAt?.base || null;
    planned = planScheduleUpdate(remote?.base, loaded, by);
    if (!planned.changed) return { ...planned, saved: false };
    const result = await cloudPush({ base: planned.next }, { expected: { base: expected }, cfg });
    if (result?.conflict) continue;
    if (!result?.ok) throw new ImportError(saved('The schedules could not be saved.'));
    return { ...planned, saved: true };
  }
  throw new ImportError('Someone else saved the schedules at the same time, so this run wrote nothing. Run the import again.');
}

export async function runImport(argv, { env = process.env } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(HELP);
    return { help: true, saved: false, changed: false, files: [], dryRun: false };
  }
  const loaded = [];
  for (const kind of args.order) {
    if (kind === 'daily') loaded.push(await loadDaily(args.daily));
    else loaded.push(await loadMachine(args[kind], kind));
  }
  if (!loaded.length) throw new ImportError(`${HELP}\nGive at least one of --rolling, --cnc or --daily. Nothing was saved.`);

  let cfg;
  try {
    cfg = await signIn(env);
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError(saved(error.message));
  }
  const by = authSession()?.email || env.SUPABASE_EMAIL || 'Schedule import';
  try {
    const outcome = args.dryRun
      ? await previewSchedules(cfg, loaded, by)
      : await commitSchedules(cfg, loaded, by);
    printSummary(outcome, args);
    return { ...outcome, dryRun: !!args.dryRun };
  } catch (error) {
    if (error instanceof ImportError) throw error;
    if (error instanceof CloudError) throw new ImportError(saved(error.message));
    throw error;
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) {
  runImport(process.argv).catch((error) => {
    console.error(error?.message || error);
    if (!(error instanceof ImportError)) console.error(error?.stack || '');
    process.exit(1);
  });
}
