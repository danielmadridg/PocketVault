import type { FirebaseOptions } from 'firebase/app';

/** `vite --mode emulator` talks to the local Firebase Emulator Suite instead of production. */
export const USE_EMULATORS = import.meta.env.MODE === 'emulator';

// A Firebase web config is an identifier, not a secret: access is enforced by
// firestore.rules / storage.rules. Keep it inline — moving it to a gitignored
// file is what broke the production build once already.
const PRODUCTION: FirebaseOptions = {
  apiKey: 'AIzaSyA9m8TDbh7RWj86BPJtGW64S117IAnkT-8',
  authDomain: 'vault-b76d1.firebaseapp.com',
  projectId: 'vault-b76d1',
  storageBucket: 'vault-b76d1.firebasestorage.app',
  messagingSenderId: '730367163719',
  appId: '1:730367163719:web:eccc44c5f5a401104fe062',
};

// `demo-` project ids can never reach a real project, even by mistake.
const EMULATOR: FirebaseOptions = {
  apiKey: 'demo-key',
  authDomain: 'demo-pocketvault.firebaseapp.com',
  projectId: 'demo-pocketvault',
  storageBucket: 'demo-pocketvault.appspot.com',
  appId: 'demo-app',
};

export const FIREBASE_CONFIG = USE_EMULATORS ? EMULATOR : PRODUCTION;

export const EXPIRY_DAYS = 7;
export const DAY_MS = 86_400_000;
export const EXPIRY_MS = EXPIRY_DAYS * DAY_MS;

/** Storage rules reject objects >= 100 MB; leave headroom for the AES-GCM tag. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024 - 1024;

const MB = 1024 * 1024;
export const QUOTA_OWNER_BYTES = 4500 * MB;
export const QUOTA_GUEST_BYTES = 200 * MB;

/** SHA-256 of the owner's lower-cased email, so the address stays out of the repo. */
export const OWNER_EMAIL_SHA256 = '8a5a0f084ea93d9169e274d979e8ff2dbc0b92aae6527412c51eee026b5a8c8e';

/** Pinned items used to get this date; kept for compatibility with existing documents. */
export const NEVER_EXPIRES = new Date('9999-12-31T00:00:00Z');

export const UNDO_WINDOW_MS = 5000;
export const UPLOAD_CONCURRENCY = 3;
