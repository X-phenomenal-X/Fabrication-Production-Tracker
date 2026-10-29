/* The shared link connects itself. A fresh device, and a device still
   carrying the old placeholder site name, land on the Cutting department
   project. Another site name is left alone. Local preview hosts do not
   write that live project.
   Run: node test/cloud-defaults-check.mjs */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const memory = new Map();
globalThis.localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key),
  clear: () => memory.clear(),
};

const { applyDepartmentCloud, cloudConfig, setCloudConfig } = await import('../js/cloud.js');

const PROJECT = 'https://irzuiemjveyjyongotij.supabase.co';
const KEY = 'sb_publishable_ZKBk7dgna0bZ4jFKu6GHpQ_eu2-DYE8';
const SITE = 'Cutting Dept.';

const cloudSource = fs.readFileSync(path.join(root, 'js/cloud.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const dataSource = fs.readFileSync(path.join(root, 'js/views/data.js'), 'utf8');
const employeesSource = fs.readFileSync(path.join(root, 'js/views/employees.js'), 'utf8');

if (!cloudSource.includes(PROJECT) || !cloudSource.includes(KEY) || !cloudSource.includes(SITE)) {
  throw new Error('the Cutting department project is not built into the client');
}
if (KEY.includes('service_role') || cloudSource.includes('service_role_key')) {
  throw new Error('a secret key was built into the client');
}
if (appSource.includes('whopick') || appSource.includes('Who are you?') || appSource.includes('Please sign in')) {
  throw new Error('the shell still asks who you are or tells you to sign in');
}
if (/app user picker|Who are you\?/.test(employeesSource)) {
  throw new Error('the employee directory still describes the identity picker');
}
if (/sign in with the invited email|Email me a sign-in link|Loading sign-in/.test(dataSource)) {
  throw new Error('Setup still nags for an email sign-in');
}

function withHost(hostname, protocol, run) {
  const previous = globalThis.location;
  globalThis.location = { hostname, protocol };
  try { return run(); }
  finally {
    if (previous === undefined) delete globalThis.location;
    else globalThis.location = previous;
  }
}

function expectDepartment(config, label) {
  if (config?.url !== PROJECT || config?.key !== KEY || config?.site !== SITE) {
    throw new Error(`${label}: ${JSON.stringify(config)}`);
  }
}

localStorage.clear();
delete globalThis.location;
expectDepartment(applyDepartmentCloud(), 'a fresh device did not receive the built-in connection');

localStorage.clear();
setCloudConfig({ url: 'https://old.example', key: 'old-key', site: 'cutting' });
withHost('x-phenomenal-x.github.io', 'https:', () => {
  expectDepartment(applyDepartmentCloud(), 'a device saved as site cutting was not migrated');
});

localStorage.clear();
localStorage.setItem('bv.cutting.cloud', JSON.stringify({
  url: 'https://old.example', key: 'old-key',
}));
withHost('', 'file:', () => {
  expectDepartment(applyDepartmentCloud(), 'a shared-drive file with no site name was not migrated');
});

localStorage.clear();
setCloudConfig({ url: 'https://other.example', key: 'other-key', site: 'Other Shop' });
withHost('x-phenomenal-x.github.io', 'https:', () => {
  const kept = applyDepartmentCloud();
  if (kept?.url !== 'https://other.example' || kept?.site !== 'Other Shop' || kept?.key !== 'other-key') {
    throw new Error('a different site was overwritten: ' + JSON.stringify(kept));
  }
});

localStorage.clear();
setCloudConfig({ url: 'https://preview.example', key: 'preview-key', site: 'cutting' });
withHost('127.0.0.1', 'http:', () => {
  const kept = applyDepartmentCloud();
  if (kept?.url !== 'https://preview.example' || kept?.site !== 'cutting') {
    throw new Error('a local preview host was pointed at the live project: ' + JSON.stringify(kept));
  }
});

localStorage.clear();
withHost('localhost', 'http:', () => {
  const kept = applyDepartmentCloud();
  if (kept) throw new Error('localhost applied the live project: ' + JSON.stringify(kept));
});

console.log('Cloud defaults: OK');
