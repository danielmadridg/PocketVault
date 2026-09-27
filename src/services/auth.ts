import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { clearIndexedDbPersistence, terminate, waitForPendingWrites } from 'firebase/firestore';
import { OWNER_EMAIL_SHA256, QUOTA_GUEST_BYTES, QUOTA_OWNER_BYTES } from '../config';
import { auth, db } from '../firebase';
import { sha256Hex } from '../lib/crypto';

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'El correo o la contraseña no son correctos.',
  'auth/wrong-password': 'El correo o la contraseña no son correctos.',
  'auth/user-not-found': 'No hay ninguna cuenta con ese correo.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Entra en lugar de crearla.',
  'auth/weak-password': 'La contraseña necesita al menos 6 caracteres.',
  'auth/invalid-email': 'Ese correo no tiene un formato válido.',
  'auth/missing-password': 'Escribe la contraseña.',
  'auth/too-many-requests': 'Demasiados intentos seguidos. Espera un minuto y vuelve a probar.',
  'auth/network-request-failed': 'Sin conexión. Comprueba la red y vuelve a probar.',
  'auth/popup-blocked': 'El navegador bloqueó la ventana de Google.',
  'auth/user-disabled': 'Esta cuenta está desactivada.',
};

/** Codes that mean the user changed their mind — no message needed. */
const SILENT = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);

export function authMessage(err: unknown): string | null {
  const code = (err as { code?: string }).code ?? '';
  if (SILENT.has(code)) return null;
  return MESSAGES[code] ?? 'No se pudo completar el acceso. Vuelve a intentarlo.';
}

export const signIn = (email: string, password: string) => signInWithEmailAndPassword(auth, email, password);
export const signUp = (email: string, password: string) => createUserWithEmailAndPassword(auth, email, password);
export const resetPassword = (email: string) => sendPasswordResetEmail(auth, email);

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/popup-blocked') {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw err;
  }
}

/** Surfaces errors from a redirect sign-in (the popup fallback). */
export function completeRedirect(): Promise<unknown> {
  return getRedirectResult(auth);
}

/** True once every local write has reached the server (false if still pending after `ms`). */
export function writesSynced(ms: number): Promise<boolean> {
  return Promise.race([
    waitForPendingWrites(db).then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

/**
 * Sign out and wipe the local Firestore cache, so a shared computer keeps no
 * copy of the vault. The page reloads because a terminated Firestore instance
 * cannot be reused.
 */
export async function signOut() {
  await fbSignOut(auth);
  try {
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (err) {
    console.warn('Could not clear offline cache', err);
  }
  location.replace('/');
}

export async function quotaFor(user: User): Promise<number> {
  if (!user.email) return QUOTA_GUEST_BYTES;
  const hash = await sha256Hex(user.email.trim().toLowerCase());
  return hash === OWNER_EMAIL_SHA256 ? QUOTA_OWNER_BYTES : QUOTA_GUEST_BYTES;
}
