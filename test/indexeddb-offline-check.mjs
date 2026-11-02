/* IndexedDB offline snapshot regression: quota-blocked localStorage, ordering,
   migration, and reset. No browser or dependencies required. */
import assert from 'node:assert/strict';

const legacy = new Map();
let quota = false;
globalThis.localStorage = {
  getItem: (key) => legacy.get(key) ?? null,
  setItem: (key, value) => {
    if (quota && key === 'bv.cutting.v1') {
      const error = new Error('Quota exceeded');
      error.name = 'QuotaExceededError';
      throw error;
    }
    legacy.set(key, String(value));
  },
  removeItem: (key) => legacy.delete(key),
};
let persistCalls = 0;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true, value: { storage: { persist: async () => { persistCalls++; return true; } } },
});

const records = new Map();
const db = {
  objectStoreNames: { contains: (name) => name === 'handles' },
  createObjectStore: () => {},
  close: () => {},
  transaction: () => {
    const tx = {
      objectStore: () => ({
        get: (key) => request(() => records.get(key), tx),
        put: (value, key) => request(() => records.set(key, value), tx),
        delete: (key) => request(() => records.delete(key), tx),
      }),
    };
    return tx;
  },
};
function request(action, tx) {
  const req = {};
  queueMicrotask(() => {
    try {
      req.result = action();
      req.onsuccess?.();
      queueMicrotask(() => tx.oncomplete?.());
    } catch (error) {
      req.error = error;
      req.onerror?.();
      tx.onerror?.();
    }
  });
  return req;
}
globalThis.indexedDB = {
  open: (name, version) => {
    assert.equal(name, 'bv-cutting');
    assert.equal(version, 1, 'existing handle store must not be replaced');
    const req = {};
    queueMicrotask(() => { req.result = db; req.onsuccess?.(); });
    return req;
  },
};

const { state, save, loadLocal, resetAll, storageStatus } = await import('../js/store.js');
records.set('shared', { name: 'shared-file.json' });
quota = true;
state.people = ['Offline operator'];
save();
state.people = ['Newest offline operator'];
save();
await loadLocal();
assert.deepEqual(state.people, ['Newest offline operator']);
assert.equal(JSON.parse(records.get('board')).people[0], 'Newest offline operator');
assert.equal(storageStatus().ok, true, 'quota-limited localStorage must not block IDB');
assert.equal(records.get('shared').name, 'shared-file.json');

await resetAll();
assert.equal(records.has('board'), false, 'reset did not clear IndexedDB');
assert.equal(records.has('shared'), true, 'reset erased the shared file handle');

quota = false;
legacy.set('bv.cutting.v1', JSON.stringify({ v: 1, people: ['Migrated operator'] }));
state.people = [];
await loadLocal();
assert.deepEqual(state.people, ['Migrated operator']);
assert.equal(JSON.parse(records.get('board')).people[0], 'Migrated operator');
assert.equal(legacy.has('bv.cutting.v1'), false, 'legacy copy not removed after successful migration');
assert.equal(persistCalls, 1, 'storage.persist must be requested once');

console.log('IndexedDB offline copy: OK');
