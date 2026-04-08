const DB_NAME = "kokoro-tts-web-history";
const DB_VERSION = 2;
const STORE = "sessions";
const REWRITE_STORE = "rewrite_sessions";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(REWRITE_STORE)) {
        db.createObjectStore(REWRITE_STORE, { keyPath: "id" });
      }
    };
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {{ id: string, savedAt: string, basename: string, payload: object, audioBlob: Blob, label?: string }} record
 */
export async function saveSession(record) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    await reqToPromise(store.put(record));
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function listSessionsInternal(db) {
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const all = await reqToPromise(store.getAll());
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  all.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  return all;
}

export async function listSessions() {
  const db = await openDb();
  try {
    return await listSessionsInternal(db);
  } finally {
    db.close();
  }
}

export async function getSession(id) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const row = await reqToPromise(store.get(id));
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return row ?? null;
  } finally {
    db.close();
  }
}

export async function deleteSession(id) {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    await reqToPromise(store.delete(id));
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * @param {{ id: string, createdAt: string, title: string, sourceText: string, rewrittenText: string, keyPhrases: string[] }} record
 */
export async function saveRewriteRecord(record) {
  const db = await openDb();
  try {
    const tx = db.transaction(REWRITE_STORE, "readwrite");
    const store = tx.objectStore(REWRITE_STORE);
    await reqToPromise(store.put(record));
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function listRewriteRecords() {
  const db = await openDb();
  try {
    const tx = db.transaction(REWRITE_STORE, "readonly");
    const store = tx.objectStore(REWRITE_STORE);
    const all = await reqToPromise(store.getAll());
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return all;
  } finally {
    db.close();
  }
}
