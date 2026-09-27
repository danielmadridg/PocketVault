/**
 * Hand-off between the service worker (which receives Web Share Target POSTs)
 * and the page (which uploads them once the user is signed in).
 * Runs in both contexts, so it only uses IndexedDB.
 */
export interface SharedPayload {
  id: string;
  files: File[];
  text: string;
  receivedAt: number;
}

const DB_NAME = 'pocketvault-share';
const STORE = 'inbox';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

export const putShared = (payload: SharedPayload) => run('readwrite', (s) => s.put(payload));

export const peekShared = (): Promise<SharedPayload[]> => run('readonly', (s) => s.getAll() as IDBRequest<SharedPayload[]>);

/** Delete exactly these entries; a share that arrived meanwhile has another id and survives. */
export async function deleteShared(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await run('readwrite', (s) => {
    let last: IDBRequest = s.delete(ids[0]);
    for (const id of ids.slice(1)) last = s.delete(id);
    return last;
  });
}
