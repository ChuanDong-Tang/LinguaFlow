const DB_NAME = "kokoro-tts-web-history";
const DB_VERSION = 5;
const STORE = "sessions";
const REWRITE_STORE = "rewrite_sessions";
const SUPER_DICT_STORE = "super_dict_records";
const DAILY_CAPTURE_STORE = "daily_capture_records";
const CHAT_SESSION_STORE = "chat_sessions";

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
      if (!db.objectStoreNames.contains(SUPER_DICT_STORE)) {
        db.createObjectStore(SUPER_DICT_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(DAILY_CAPTURE_STORE)) {
        db.createObjectStore(DAILY_CAPTURE_STORE, { keyPath: "dateKey" });
      }
      if (!db.objectStoreNames.contains(CHAT_SESSION_STORE)) {
        const chatStore = db.createObjectStore(CHAT_SESSION_STORE, { keyPath: "id" });
        chatStore.createIndex("updatedAt", "updatedAt", { unique: false });
      } else {
        const chatStore = e.target.transaction.objectStore(CHAT_SESSION_STORE);
        if (!chatStore.indexNames.contains("updatedAt")) {
          chatStore.createIndex("updatedAt", "updatedAt", { unique: false });
        }
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

/**
 * @param {{ id: string, createdAt: string, query: string, title: string}} record
 */
export async function saveSuperDictRecord(record) {
  const db = await openDb();
  try {
    const tx = db.transaction(SUPER_DICT_STORE, "readwrite");
    const store = tx.objectStore(SUPER_DICT_STORE);
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

export async function listSuperDictRecords() {
  const db = await openDb();
  try {
    const tx = db.transaction(SUPER_DICT_STORE, "readonly");
    const store = tx.objectStore(SUPER_DICT_STORE);
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

export async function deleteSuperDictRecord(id) {
  const db = await openDb();
  try {
    const tx = db.transaction(SUPER_DICT_STORE, "readwrite");
    const store = tx.objectStore(SUPER_DICT_STORE);
    await reqToPromise(store.delete(id));
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * @param {{
 *   dateKey: string,
 *   updatedAt: string,
 *   items: Array<{
 *     id: string,
 *     chatSessionId?: string,
 *     chatTurnId?: string,
 *     createdAt?: string,
 *     sourceText?: string,
 *     naturalVersion?: string,
 *     reply?: string,
 *     keyPhrases?: string[],
 *     keyPhraseSource?: "natural_version" | "user_selected",
 *     practiceBlankIndexes?: number[],
 *     practiceCorrectBlankIndexes?: number[],
 *     note?: string
 *   }>
 * }} record
 */
export async function saveDailyCaptureRecord(record) {
  const db = await openDb();
  try {
    const tx = db.transaction(DAILY_CAPTURE_STORE, "readwrite");
    const store = tx.objectStore(DAILY_CAPTURE_STORE);
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

export async function getDailyCaptureRecord(dateKey) {
  const db = await openDb();
  try {
    const tx = db.transaction(DAILY_CAPTURE_STORE, "readonly");
    const store = tx.objectStore(DAILY_CAPTURE_STORE);
    const row = await reqToPromise(store.get(dateKey));
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return row ?? null;
  } finally {
    db.close();
  }
}

export async function listDailyCaptureRecords() {
  const db = await openDb();
  try {
    const tx = db.transaction(DAILY_CAPTURE_STORE, "readonly");
    const store = tx.objectStore(DAILY_CAPTURE_STORE);
    const all = await reqToPromise(store.getAll());
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    all.sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
    return all;
  } finally {
    db.close();
  }
}

/**
 * @param {{ id: string, dateKey: string, title: string, createdAt: string, updatedAt: string, turns: unknown[], kind?: string, practice?: object, practiceCompleted?: boolean }} record
 */
export async function saveChatSessionRecord(record) {
  const db = await openDb();
  try {
    const tx = db.transaction(CHAT_SESSION_STORE, "readwrite");
    const store = tx.objectStore(CHAT_SESSION_STORE);
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

export async function listChatSessionRecords() {
  const db = await openDb();
  try {
    const tx = db.transaction(CHAT_SESSION_STORE, "readonly");
    const store = tx.objectStore(CHAT_SESSION_STORE);
    const all = await reqToPromise(store.getAll());
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return all;
  } finally {
    db.close();
  }
}

export async function deleteChatSessionRecord(id) {
  const db = await openDb();
  try {
    const tx = db.transaction(CHAT_SESSION_STORE, "readwrite");
    const store = tx.objectStore(CHAT_SESSION_STORE);
    await reqToPromise(store.delete(id));
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function overwriteChatSessionRecords(records) {
  const db = await openDb();
  try {
    const tx = db.transaction(CHAT_SESSION_STORE, "readwrite");
    const store = tx.objectStore(CHAT_SESSION_STORE);
    await reqToPromise(store.clear());
    for (const record of records) {
      await reqToPromise(store.put(record));
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
