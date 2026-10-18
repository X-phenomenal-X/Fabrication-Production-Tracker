/* Contract test for the deployed half of Photo to To-Do. It compiles the
   Edge Function with the same pinned esbuild used by the app, captures the
   Deno.serve handler, and drives origin, editor-login and OpenAI request rules
   without using production credentials or sending a real image. */

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { transform } from 'esbuild';
import { ROOT } from './env.mjs';

const EDITOR_ID = '11111111-1111-1111-1111-111111111111';
const VIEWER_ID = '22222222-2222-2222-2222-222222222222';

function fakeJwt(sub) {
  const payload = Buffer.from(JSON.stringify({ sub })).toString('base64url');
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

const sourcePath = path.join(ROOT, 'supabase', 'functions', 'photo-to-todos', 'index.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = await transform(source, { loader: 'ts', target: 'es2022', format: 'iife' });
const settings = new Map([
  ['PHOTO_TODO_ALLOWED_ORIGINS', 'https://x-phenomenal-x.github.io'],
  ['OPENAI_API_KEY', 'openai-test-key'],
  ['SUPABASE_URL', 'https://project.supabase.co'],
  ['SUPABASE_ANON_KEY', 'sb_publishable_test'],
]);
let handler = null;
let openAiRequest = null;
let calls = 0;
const context = vm.createContext({
  Deno: {
    env: { get: (name) => settings.get(name) || '' },
    serve: (fn) => { handler = fn; },
  },
  Request, Response, Headers, TextEncoder, Set, Math, JSON, String, Number, Array, URL, atob,
  fetch: async (url, options) => {
    const address = String(url);
    if (address.includes('/rest/v1/tracker_members')) {
      const id = new URL(address).searchParams.get('user_id')?.replace(/^eq\./, '') || '';
      const role = id === EDITOR_ID ? 'editor' : id === VIEWER_ID ? 'viewer' : null;
      const auth = options?.headers?.Authorization || options?.headers?.authorization || '';
      if (!auth.startsWith('Bearer ') || options?.headers?.apikey !== 'sb_publishable_test') {
        return new Response(JSON.stringify({ message: 'missing user token' }), { status: 401 });
      }
      return new Response(JSON.stringify(role ? [{ role }] : []), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!address.startsWith('https://api.openai.com/')) {
      return new Response(JSON.stringify({ message: 'unexpected fetch' }), { status: 500 });
    }
    calls += 1;
    openAiRequest = { url: address, headers: options.headers, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        summary: 'Two explicit actions found.',
        tasks: [
          { text: 'Move cart to FOM 2', assignee: null, confidence: .94,
            evidence: 'move cart FOM2', needsReview: false },
          { text: 'Check W/O 29604', assignee: 'Abhay', confidence: .7,
            evidence: 'check 29604', needsReview: true },
        ],
      }) }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  },
});
new vm.Script(compiled.code, { filename: sourcePath }).runInContext(context);
if (typeof handler !== 'function') throw new Error('Edge Function did not register a Deno.serve handler');

const origin = 'https://x-phenomenal-x.github.io';
const req = (method, { requestOrigin = origin, token = null, body = null } = {}) =>
  new Request('https://project.supabase.co/functions/v1/photo-to-todos', {
    method,
    headers: {
      Origin: requestOrigin,
      apikey: 'sb_publishable_test',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

const preflight = await handler(req('OPTIONS'));
if (preflight.status !== 204 || preflight.headers.get('access-control-allow-origin') !== origin) {
  throw new Error('Allowed browser origin did not receive a valid CORS preflight');
}

const blockedOrigin = await handler(req('POST', {
  requestOrigin: 'https://attacker.example',
  body: { image: 'data:image/jpeg;base64,AA==' },
}));
if (blockedOrigin.status !== 403) throw new Error('Unlisted browser origin reached photo analysis');

const beforeDenied = calls;
const missingToken = await handler(req('POST', {
  body: { image: 'data:image/jpeg;base64,AA==' },
}));
if (missingToken.status !== 401 || calls !== beforeDenied) {
  throw new Error('A missing login spent model allowance');
}
const viewer = await handler(req('POST', {
  token: fakeJwt(VIEWER_ID), body: { image: 'data:image/jpeg;base64,AA==' },
}));
if (viewer.status !== 403 || calls !== beforeDenied) {
  throw new Error('A view-only login spent model allowance');
}

const accepted = await handler(req('POST', {
  token: fakeJwt(EDITOR_ID),
  body: {
    image: 'data:image/jpeg;base64,AA==',
    guidance: 'Only afternoon-shift actions',
  },
}));
const result = await accepted.json();
if (accepted.status !== 200 || result.tasks?.length !== 2 || result.tasks[1].assignee !== 'Abhay') {
  throw new Error('Valid structured model output was not returned as To-Do candidates');
}
if (accepted.headers.get('cache-control') !== 'no-store') throw new Error('Photo response can be cached');
if (calls !== 1 || openAiRequest?.url !== 'https://api.openai.com/v1/responses') {
  throw new Error('Valid photo did not make exactly one Responses API call');
}
if (openAiRequest.body.store !== false
  || openAiRequest.body.text?.format?.type !== 'json_schema'
  || openAiRequest.body.text?.format?.strict !== true
  || openAiRequest.body.input?.[0]?.content?.[1]?.type !== 'input_image') {
  throw new Error('OpenAI request lost its no-store, image or strict structured-output boundary');
}
const prompt = openAiRequest.body.input?.[0]?.content?.[0]?.text || '';
if (!/Do not create purchasing, material-ordering or purchase-request actions/i.test(prompt)
  || !/Only afternoon-shift actions/.test(prompt)) {
  throw new Error('Photo prompt lost its no-purchasing rule or operator guidance');
}

console.log('  • CORS origin allowlist: pass');
console.log('  • missing login and view-only role block before model spend: pass');
console.log('  • Responses API uses image input, store:false and strict JSON schema: pass');
console.log('  • only reviewed candidate JSON returns; no database write: pass');
console.log('\nERRORS: none');
