/* Contract test for the deployed half of Photo to To-Do. It compiles the
   Edge Function with the same pinned esbuild used by the app, captures the
   Deno.serve handler, and drives origin, access-key and OpenAI request rules
   without using production credentials or sending a real image. */

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { transform } from 'esbuild';
import { ROOT } from './env.mjs';

const sourcePath = path.join(ROOT, 'supabase', 'functions', 'photo-to-todos', 'index.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = await transform(source, { loader: 'ts', target: 'es2022', format: 'iife' });
const settings = new Map([
  ['PHOTO_TODO_ALLOWED_ORIGINS', 'https://x-phenomenal-x.github.io'],
  ['PHOTO_TODO_ACCESS_KEY', 'department-test-code'],
  ['OPENAI_API_KEY', 'openai-test-key'],
]);
let handler = null;
let openAiRequest = null;
let calls = 0;
const context = vm.createContext({
  Deno: {
    env: { get: (name) => settings.get(name) || '' },
    serve: (fn) => { handler = fn; },
  },
  Request, Response, Headers, TextEncoder, Set, Math, JSON, String, Number, Array,
  fetch: async (url, options) => {
    calls += 1;
    openAiRequest = { url: String(url), headers: options.headers, body: JSON.parse(options.body) };
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
const req = (method, { requestOrigin = origin, key = 'department-test-code', body = null } = {}) =>
  new Request('https://project.supabase.co/functions/v1/photo-to-todos', {
    method,
    headers: {
      Origin: requestOrigin,
      apikey: 'sb_publishable_test',
      'x-photo-todo-key': key,
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

const beforeBadKey = calls;
const blockedKey = await handler(req('POST', {
  key: 'wrong-code', body: { image: 'data:image/jpeg;base64,AA==' },
}));
if (blockedKey.status !== 401 || calls !== beforeBadKey) {
  throw new Error('A wrong department code spent model allowance');
}

const accepted = await handler(req('POST', {
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
console.log('  • department access key blocks before model spend: pass');
console.log('  • Responses API uses image input, store:false and strict JSON schema: pass');
console.log('  • only reviewed candidate JSON returns; no database write: pass');
console.log('\nERRORS: none');
