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

   A save does not upsert blindly. It writes only when updated_at is still the
   value this phone just read. If another phone wrote in between, the write
   matches nothing and the caller merges and tries again. That is what stops
   two phones, saving in the same second, from replacing each other's work.

   Who may read and write is the SQL in supabase/migrations. The publishable
   key is sent as apikey. Authorization is the signed-in person when we know
   their role, and the publishable key until the lock script is in place.
   Secret and service_role keys must never be put in this browser app. */

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

export class CloudError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function classify(status, detail, mode) {
  const text = detail || '';
  if (status === 401 && /invalid api key|no api key/i.test(text)) return 'key';
  if (status === 409) return 'conflict';
  if (status === 401 || status === 403) {
    if (mode === 'none') return 'not-a-member';
    if (mode === 'anon' || /row-level security|42501|permission denied|jwt/i.test(text)) {
      return 'auth-required';
    }
    return 'auth-required';
  }
  return 'other';
}

function messageFor(code, status, detail) {
  if (code === 'key') {
    return 'The cloud rejected the key. Check the publishable key (the anon '
      + 'public key on an older project), the Data API grant and the policies '
      + `from the setup SQL.${detail ? ` (${detail})` : ''}`;
  }
  if (code === 'auth-required') {
    return 'Please sign in to keep sharing. Your work is still saved on this phone.';
  }
  if (code === 'not-a-member') {
    return 'You are signed in, but this email is not on the Cutting list yet. '
      + 'Ask a supervisor to add you. Your work is still saved on this phone.';
  }
  if (status === 404) {
    return `No "${TABLE}" table at that address. Run the setup SQL in the Supabase `
      + 'SQL editor, then try again.';
  }
  return `Cloud error ${status}${detail ? `: ${detail}` : ''}`;
}

/** Turn the many ways this can fail into one sentence worth reading. */
async function explain(res, mode) {
  let detail = '';
  try {
    const body = await res.json();
    detail = body.message || body.hint || body.error || body.code || '';
  } catch { /* not JSON */ }
  const code = classify(res.status, detail, mode);
  if (code === 'auth-required') setAuthGate('sign-in');
  if (code === 'not-a-member') setAuthGate('not-a-member');
  return new CloudError(messageFor(code, res.status, detail), code === 'other' && res.status === 404 ? 'missing-table' : code);
}

async function request(cfg, path, { method = 'GET', bearer, prefer, body, allowConflict = false } = {}) {
  const sent = bearer || await dataBearer();
  // An anonymous call must present the key for THIS project. Signing in later
  // replaces it with the person's token; until then a setup test has to be
  // able to try a key that is not saved yet.
  const token = sent.mode === 'editor' || sent.mode === 'viewer' || sent.mode === 'none'
    ? sent.token
    : cfg.key;
  let res;
  try {
    res = await fetch(`${cfg.url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(prefer ? { Prefer: prefer } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    // fetch only rejects for network-level problems, which on the floor means
    // no internet or a blocked address rather than anything the user did.
    throw new CloudError(
      'Could not reach the cloud. Check the internet connection and the '
      + `address.${e?.message ? ` (${e.message})` : ''}`,
      'network');
  }
  if (allowConflict && res.status === 409) return { conflict: true, body: null, mode: sent.mode };
  if (!res.ok) throw await explain(res, sent.mode);
  if (res.status === 204) return { conflict: false, body: null, mode: sent.mode };
  const text = await res.text();
  return { conflict: false, body: text ? JSON.parse(text) : null, mode: sent.mode };
}

/** Read one or both documents. Returns { base, work } with missing parts null. */
export async function cloudPull(parts = CLOUD_PARTS, cfg = cloudConfig()) {
  if (!cfg) return null;
  const list = parts.map((p) => `"${p}"`).join(',');
  const { body } = await request(cfg,
    `${TABLE}?site=eq.${encodeURIComponent(cfg.site)}&part=in.(${list})&select=part,data,updated_at`);

  const out = { base: null, work: null, updatedAt: {} };
  for (const row of body || []) {
    out[row.part] = row.data;
    out.updatedAt[row.part] = row.updated_at;
  }
  return out;
}

/** Write documents only when each part is still the version we just read.
    `expected[part]` null means the row was absent and this is an insert.
    A conflict means another phone wrote first; nothing was overwritten. */
export async function cloudPush(docs, { expected = {}, cfg = cloudConfig() } = {}) {
  if (!cfg) return { ok: false };
  const updatedAt = {};
  for (const [part, data] of Object.entries(docs)) {
    if (data == null) continue;
    const outcome = await pushPart(cfg, part, data, expected[part] || null);
    if (outcome.conflict) return { ok: false, conflict: true, part };
    updatedAt[part] = outcome.updatedAt;
  }
  return { ok: true, updatedAt };
}

async function pushPart(cfg, part, data, expectedAt) {
  const stamp = new Date().toISOString();
  if (!expectedAt) {
    const inserted = await request(cfg, TABLE, {
      method: 'POST',
      prefer: 'return=representation',
      allowConflict: true,
      body: { site: cfg.site, part, data, updated_at: stamp },
    });
    if (inserted.conflict) return { conflict: true };
    const row = Array.isArray(inserted.body) ? inserted.body[0] : inserted.body;
    return { updatedAt: row?.updated_at || stamp };
  }

  const filter = [
    `site=eq.${encodeURIComponent(cfg.site)}`,
    `part=eq.${encodeURIComponent(part)}`,
    `updated_at=eq.${encodeURIComponent(expectedAt)}`,
  ].join('&');
  const patched = await request(cfg, `${TABLE}?${filter}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: { data, updated_at: stamp },
  });
  const rows = Array.isArray(patched.body) ? patched.body : [];
  // PostgREST answers a filter that matches nothing with an empty list, not
  // an error. That empty list is the other phone having saved first.
  if (!rows.length) return { conflict: true };
  return { updatedAt: rows[0].updated_at || stamp };
}

/** Just the timestamps, for deciding whether a pull is worth doing at all. */
export async function cloudStamps(cfg = cloudConfig()) {
  if (!cfg) return null;
  const { body } = await request(cfg,
    `${TABLE}?site=eq.${encodeURIComponent(cfg.site)}&select=part,updated_at`);
  const out = {};
  for (const row of body || []) out[row.part] = row.updated_at;
  return out;
}

/** Check a config before saving it, so a typo is caught at setup rather than
    silently failing every sync afterwards. */
export async function cloudTest(cfg) {
  if (!cfg?.url || !cfg?.key) {
    throw new Error('Both the project URL and the publishable key are needed.');
  }
  try {
    new URL(cfg.url);
  } catch {
    throw new Error('That project URL does not look like a web address.');
  }
  await cloudPull(['work'], { site: 'cutting', ...cfg, url: String(cfg.url).trim().replace(/\/+$/, ''), key: String(cfg.key).trim() });
  return true;
}

/* Sign-in for the shared board.

   The publishable key still has to live in the browser — that is how a static
   site talks to Supabase — but it is no longer a password. After the lock
   script runs, that key can only start an email link. Reading and changing
   the board requires a signed-in member.

   Roles live in tracker_members, not in the token. A supervisor can paste one
   insert in the SQL editor, and the row rules can see the same table. The
   browser never writes that table.

   Until the lock script exists, a phone that already syncs keeps using the
   publishable key. A 401 from the locked table switches that phone to the
   sign-in screen. Local work is not cleared either way. */

const LS_SESSION = 'bv.cutting.auth';
const LS_VERIFIER = 'bv.cutting.auth.verifier';

let gate = null;
let booting = false;
let implicitNow = false;
let refreshing = null;
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn();
}

export function onAuth(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function authGate() { return gate; }

export function authBooting() { return booting; }

export function setAuthGate(next) {
  const value = next || null;
  if (value === gate) return;
  gate = value;
  emit();
}

function project() {
  try {
    const raw = localStorage.getItem(LS_CLOUD);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved?.url || !saved?.key) return null;
    return {
      url: String(saved.url).trim().replace(/\/+$/, ''),
      key: String(saved.key).trim(),
    };
  } catch {
    return null;
  }
}

export function authSession() {
  try {
    const raw = localStorage.getItem(LS_SESSION);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved?.accessToken) return null;
    return saved;
  } catch {
    return null;
  }
}

function writeSession(session) {
  if (!session) localStorage.removeItem(LS_SESSION);
  else localStorage.setItem(LS_SESSION, JSON.stringify(session));
  emit();
}

export function hasSession() {
  return !!authSession()?.accessToken;
}

/** editor, viewer, none (signed in, not on the list), legacy (lock script
    not run yet), or pending. */
export function membershipRole() {
  return authSession()?.role || null;
}

export function watchViewOnly(fn) {
  viewOnlyHandler = fn;
}

let viewOnlyHandler = null;
export function noteViewOnly() {
  viewOnlyHandler?.();
}

function bytesToBase64Url(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomVerifier() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function codeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

function jwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/')
      + '='.repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function redirectUrl() {
  const url = new URL(location.href);
  url.hash = '';
  url.searchParams.delete('code');
  if (url.searchParams.get('type')) url.searchParams.delete('type');
  return url.origin + url.pathname + url.search;
}

function sessionFromToken(body) {
  const accessToken = body.access_token;
  const payload = jwtPayload(accessToken);
  const previous = authSession();
  return {
    accessToken,
    refreshToken: body.refresh_token || previous?.refreshToken || null,
    expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000,
    email: body.user?.email || payload?.email || previous?.email || null,
    userId: body.user?.id || payload?.sub || previous?.userId || null,
    role: previous?.role || 'pending',
  };
}

async function authFetch(path, options = {}) {
  const cfg = project();
  if (!cfg) throw new Error('Connect Sync across devices in Setup first. Your work is still saved on this phone.');
  let response;
  try {
    response = await fetch(`${cfg.url}${path}`, {
      ...options,
      headers: {
        apikey: cfg.key,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error('Could not reach the sign-in service. Check the internet connection. Your work is still saved on this phone.');
  }
  return response;
}

/** Email a one-time link. create_user is false so this screen cannot open
    an account the supervisor did not invite. */
export async function requestMagicLink(email) {
  const address = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new Error('Enter the email address a supervisor invited.');
  }
  const verifier = randomVerifier();
  localStorage.setItem(LS_VERIFIER, verifier);
  const response = await authFetch(`/auth/v1/otp?redirect_to=${encodeURIComponent(redirectUrl())}`, {
    method: 'POST',
    body: JSON.stringify({
      email: address,
      create_user: false,
      code_challenge: await codeChallenge(verifier),
      code_challenge_method: 's256',
    }),
  });
  if (response.status === 429) {
    throw new Error('Too many sign-in emails. Wait a minute and try again.');
  }
  if (response.status >= 500) {
    throw new Error('The sign-in service is busy. Try again in a minute.');
  }
  // The same sentence for a real invite and an unknown email, so the screen
  // does not reveal who is on the list.
  return 'If that email was invited, a sign-in link is on its way. Open it in this same browser.';
}

async function exchangeCode(code) {
  const verifier = localStorage.getItem(LS_VERIFIER);
  if (!verifier) {
    throw new Error('Open the sign-in link in the same browser that asked for it, or send yourself a new link from this phone.');
  }
  const response = await authFetch('/auth/v1/token?grant_type=pkce', {
    method: 'POST',
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    throw new Error('That sign-in link has expired. Send yourself a new one from this phone.');
  }
  localStorage.removeItem(LS_VERIFIER);
  writeSession(sessionFromToken(body));
}

async function refresh(session) {
  const response = await authFetch('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    writeSession(null);
    setAuthGate('sign-in');
    throw new Error('Please sign in again. Your work is still saved on this phone.');
  }
  const next = sessionFromToken(body);
  writeSession(next);
  return next;
}

/** Access token, refreshed if it is about to expire. Null when signed out. */
export async function freshSession() {
  const session = authSession();
  if (!session?.accessToken) return null;
  if (!session.refreshToken || session.expiresAt - Date.now() > 60_000) return session;
  if (!refreshing) refreshing = refresh(session).finally(() => { refreshing = null; });
  return refreshing;
}

/** Which bearer the data requests should use.

    An editor or viewer sends their own login. Someone signed in but missing
    from the list does too, so they cannot fall back to the old open key.
    Everyone else keeps the publishable key until the lock script is in place,
    which is what lets a mid-shift phone keep syncing before anyone signs in. */
export async function dataBearer() {
  const cfg = project();
  const session = await freshSession();
  if (session?.role === 'editor' || session?.role === 'viewer' || session?.role === 'none') {
    return { token: session.accessToken, mode: session.role };
  }
  return { token: cfg?.key || '', mode: 'anon' };
}

export async function refreshMembership() {
  const session = await freshSession();
  if (!session?.accessToken || !session.userId) return null;
  const cfg = project();
  if (!cfg) return session.role || null;
  let response;
  try {
    response = await fetch(
      `${cfg.url}/rest/v1/tracker_members?user_id=eq.${encodeURIComponent(session.userId)}&select=role`,
      { headers: { apikey: cfg.key, Authorization: `Bearer ${session.accessToken}` } },
    );
  } catch {
    return session.role || null;
  }
  const current = authSession() || session;
  if (response.status === 404) {
    current.role = 'legacy';
  } else if (!response.ok) {
    return current.role || null;
  } else {
    const rows = await response.json().catch(() => []);
    const role = rows?.[0]?.role;
    current.role = role === 'editor' || role === 'viewer' ? role : 'none';
  }
  writeSession(current);
  if (current.role === 'none') setAuthGate('not-a-member');
  else if (gate === 'not-a-member' || gate === 'sign-in' || gate === 'signing-in') setAuthGate(null);
  return current.role;
}

/** A magic-link hash would be read as a page name. Take the tokens out of the
    address before the shell looks at the hash. */
export function takeImplicitSession() {
  if (typeof location === 'undefined') return false;
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const accessToken = hash.get('access_token');
  if (!accessToken) return false;
  writeSession(sessionFromToken({
    access_token: accessToken,
    refresh_token: hash.get('refresh_token'),
    expires_in: hash.get('expires_in'),
  }));
  implicitNow = true;
  const url = new URL(location.href);
  url.hash = '';
  history.replaceState(null, '', url.pathname + url.search);
  return true;
}

export async function bootAuth() {
  if (typeof location === 'undefined') return { signedInNow: false };
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  let signedInNow = implicitNow;
  implicitNow = false;
  if (code) {
    booting = true;
    setAuthGate('signing-in');
    try {
      await exchangeCode(code);
      signedInNow = true;
    } catch (error) {
      setAuthGate('sign-in');
      return { signedInNow: false, error: error.message };
    } finally {
      booting = false;
      url.searchParams.delete('code');
      const type = url.searchParams.get('type');
      if (type === 'magiclink' || type === 'signup' || type === 'recovery' || type === 'invite') {
        url.searchParams.delete('type');
      }
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }
  if (hasSession()) {
    try { await refreshMembership(); }
    catch (error) { return { signedInNow, error: error.message }; }
  }
  if (signedInNow && authGate() === 'signing-in') setAuthGate(null);
  return { signedInNow };
}

export function signOut() {
  writeSession(null);
  localStorage.removeItem(LS_VERIFIER);
  if (gate === 'not-a-member' || gate === 'signing-in') setAuthGate('sign-in');
  else emit();
}

if (typeof location !== 'undefined' && new URL(location.href).searchParams.has('code')) {
  booting = true;
}
