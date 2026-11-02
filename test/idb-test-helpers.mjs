/* Storage helpers for tests. The browser helper is self-contained so it can be
   passed directly to Playwright page.evaluate() without a test-server route. */
export async function browserBoard() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('bv-cutting', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const raw = await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly');
      const request = tx.objectStore('handles').get('board');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
    return typeof raw === 'string' ? JSON.parse(raw) : raw || {};
  } finally { db.close(); }
}

export async function readNodeBoard() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('bv-cutting', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const raw = await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly');
      const request = tx.objectStore('handles').get('board');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return typeof raw === 'string' ? JSON.parse(raw) : raw || {};
  } finally { db.close(); }
}

export async function writeNodeBoard(board) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('bv-cutting', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put(JSON.stringify(board), 'board');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
