type TtsCacheRecord = {
  key: string;
  audioBlob: Blob;
  updatedAt: number;
};

const TTS_CACHE_DB_NAME = "linguaflow-tts-cache";
const TTS_CACHE_STORE = "audio";
const TTS_CACHE_MAX_ENTRIES = 120;

export class KokoroAudioCache {
  private dbPromise: Promise<IDBDatabase> | null = null;

  async get(key: string): Promise<Blob | null> {
    try {
      const db = await this.openDb();
      const record = await this.readRecord(db, key);
      if (!record?.audioBlob) return null;
      void this.touch(db, key, record.audioBlob);
      return record.audioBlob;
    } catch {
      return null;
    }
  }

  async set(key: string, audioBlob: Blob): Promise<void> {
    try {
      const db = await this.openDb();
      await this.writeRecord(db, { key, audioBlob, updatedAt: Date.now() });
      await this.prune(db, TTS_CACHE_MAX_ENTRIES);
    } catch {
      // ignore cache failures
    }
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(TTS_CACHE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        const store = db.createObjectStore(TTS_CACHE_STORE, { keyPath: "key" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Failed to open tts cache db"));
    });
    return this.dbPromise;
  }

  private readRecord(db: IDBDatabase, key: string): Promise<TtsCacheRecord | null> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TTS_CACHE_STORE, "readonly");
      const store = tx.objectStore(TTS_CACHE_STORE);
      const request = store.get(key);
      request.onsuccess = () => resolve((request.result as TtsCacheRecord | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Failed to read tts cache"));
    });
  }

  private writeRecord(db: IDBDatabase, record: TtsCacheRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TTS_CACHE_STORE, "readwrite");
      const store = tx.objectStore(TTS_CACHE_STORE);
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to write tts cache"));
      tx.onabort = () => reject(tx.error ?? new Error("Aborted while writing tts cache"));
    });
  }

  private touch(db: IDBDatabase, key: string, audioBlob: Blob): Promise<void> {
    return this.writeRecord(db, { key, audioBlob, updatedAt: Date.now() });
  }

  private prune(db: IDBDatabase, maxEntries: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TTS_CACHE_STORE, "readwrite");
      const store = tx.objectStore(TTS_CACHE_STORE);
      const index = store.index("updatedAt");
      const cursorReq = index.openCursor();
      const keysToDelete: string[] = [];
      let count = 0;

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          const overflow = Math.max(0, count - maxEntries);
          for (let i = 0; i < overflow; i += 1) {
            store.delete(keysToDelete[i]);
          }
          return;
        }
        count += 1;
        keysToDelete.push(String((cursor.value as TtsCacheRecord).key));
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error ?? new Error("Failed to prune tts cache"));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to complete tts cache prune"));
      tx.onabort = () => reject(tx.error ?? new Error("Aborted while pruning tts cache"));
    });
  }
}
