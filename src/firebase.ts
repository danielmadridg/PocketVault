import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';
import { FIREBASE_CONFIG, USE_EMULATORS } from './config';

export const app = initializeApp(FIREBASE_CONFIG);

export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});

// Persistent cache: the library renders from IndexedDB before the network
// answers, and writes made offline are queued and synced later.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true,
});

if (USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

type StorageModule = typeof import('firebase/storage');
let storagePromise: Promise<{ mod: StorageModule; storage: FirebaseStorage }> | null = null;

/** Storage is only needed to upload, download or delete files, so it loads on first use. */
export function loadStorage() {
  storagePromise ??= import('firebase/storage').then((mod) => {
    const storage = mod.getStorage(app);
    if (USE_EMULATORS) mod.connectStorageEmulator(storage, '127.0.0.1', 9199);
    return { mod, storage };
  });
  return storagePromise;
}
