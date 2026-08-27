/* Cloud sync — the transport only. Nothing in here knows what a task is; it
   moves two JSON documents to and from a Supabase table and reports failures
   in words an operator can act on.

   Why Supabase: it speaks plain REST over HTTPS, so this needs no SDK, no
   build step and no bundled dependency — the same constraint that produced the
   hand-rolled XLSX reader. Any PostgREST-compatible host works the same way.

   Two documents, not one:
     base — the imported workbooks (tasks, machineMeta, shiftUpdate). About a
            megabyte, and only changes when somebody re-imports.
     work — everything people do (statuses, notes, edits, back orders, rush,
            assignments, shift updates, history). Small, and changes constantly.
   Pushing them separately is the difference between a phone uploading a
   megabyte every few seconds and uploading a few kilobytes.

   The table (run once in the Supabase SQL editor):

     create table if not exists tracker_state (
       site text not null,
       part text not null,
       data jsonb not null,
       updated_at timestamptz not null default now(),
       primary key (site, part)
     );
     alter table tracker_state enable row level security;
     create policy "tracker read"   on tracker_state for select using (true);
     create policy "tracker insert" on tracker_state for insert with check (true);
     create policy "tracker update" on tracker_state for update using (true) with check (true);

   Those policies let anyone holding the URL and the publishable key read and write
   the department's data. That is the trade for not running a login — keep the
   key to the team, the same way the network share is kept to the team. */

const LS_CLOUD = 'bv.cutting.cloud';
const TABLE = 'tracker_state';

export const CLOUD_PARTS = ['base', 'work'];

export function cloudConfig() {
  try {
    const raw = localStorage.getItem(LS_CLOUD);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return c && c.url && c.key ? { site: 'cutting', ...c } : null;
  } catch {
    return null;
  }
}

export function setCloudConfig(cfg) {
  if (!cfg) localStorage.removeItem(LS_CLOUD);
  else {
    localStorage.setItem(LS_CLOUD, JSON.stringify({
      url: String(cfg.url || '').trim().replace(/\/+$/, ''),
      key: String(cfg.key || '').trim(),
      site: String(cfg.site || 'cutting').trim() || 'cutting',
    }));
  }
}

export function cloudEnabled() {
  return !!cloudConfig();
}

/** Where the data lives, for showing in Setup. */
export function cloudHost() {
  const c = cloudConfig();
  if (!c) return null;
  try {
    return `${new URL(c.url).hostname} · ${c.site}`;
  } catch {
    return c.site;
  }
}

function headers(cfg, extra = {}) {
  return {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

/** Turn the many ways this can fail into one sentence worth reading. */
async function explain(res) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body.message || body.hint || body.error || '';
  } catch { /* not JSON */ }

  if (res.status === 401 || res.status === 403) {
    return new Error(
      'The cloud rejected the key. Check the publishable key (the anon public '
      + 'key on an older project), and that the grant and the three '
      + `policies in the setup SQL were created.${detail ? ` (${detail})` : ''}`);
  }
  if (res.status === 404) {
    return new Error(
      `No "${TABLE}" table at that address. Run the setup SQL in the Supabase `
      + 'SQL editor, then try again.');
  }
  return new Error(`Cloud error ${res.status}${detail ? `: ${detail}` : ''}`);
}

async function call(cfg, path, opts = {}) {
  let res;
  try {
    res = await fetch(`${cfg.url}/rest/v1/${path}`, opts);
  } catch (e) {
    // fetch only rejects for network-level problems, which on the floor means
    // no internet or a blocked address rather than anything the user did.
    throw new Error(
      'Could not reach the cloud. Check the internet connection and the '
      + `address.${e?.message ? ` (${e.message})` : ''}`);
  }
  if (!res.ok) throw await explain(res);
  return res;
}

/** Read one or both documents. Returns { base, work } with missing parts null. */
export async function cloudPull(parts = CLOUD_PARTS, cfg = cloudConfig()) {
  if (!cfg) return null;
  const list = parts.map((p) => `"${p}"`).join(',');
  const res = await call(cfg,
    `${TABLE}?site=eq.${encodeURIComponent(cfg.site)}&part=in.(${list})&select=part,data,updated_at`,
    { headers: headers(cfg) });

  const rows = await res.json();
  const out = { base: null, work: null, updatedAt: {} };
  for (const r of rows) {
    out[r.part] = r.data;
    out.updatedAt[r.part] = r.updated_at;
  }
  return out;
}

/** Write documents. `docs` is { base?, work? } — only the parts given are sent. */
export async function cloudPush(docs, cfg = cloudConfig()) {
  if (!cfg) return false;
  const rows = Object.entries(docs)
    .filter(([, data]) => data != null)
    .map(([part, data]) => ({ site: cfg.site, part, data, updated_at: new Date().toISOString() }));
  if (!rows.length) return false;

  await call(cfg, `${TABLE}?on_conflict=site,part`, {
    method: 'POST',
    headers: headers(cfg, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows),
  });
  return true;
}

/** Just the timestamps, for deciding whether a pull is worth doing at all. */
export async function cloudStamps(cfg = cloudConfig()) {
  if (!cfg) return null;
  const res = await call(cfg,
    `${TABLE}?site=eq.${encodeURIComponent(cfg.site)}&select=part,updated_at`,
    { headers: headers(cfg) });
  const out = {};
  for (const r of await res.json()) out[r.part] = r.updated_at;
  return out;
}

/** Check a config before saving it, so a typo is caught at setup rather than
    silently failing every sync afterwards. */
export async function cloudTest(cfg) {
  if (!cfg?.url || !cfg?.key) throw new Error('Both the project URL and the publishable key are needed.');
  try {
    new URL(cfg.url);
  } catch {
    throw new Error('That project URL does not look like a web address.');
  }
  await cloudPull(['work'], { site: 'cutting', ...cfg });
  return true;
}
