import { deleteField, doc, onSnapshot, runTransaction, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  decryptBytes,
  deriveKey,
  encryptBytes,
  fromBase64,
  importDataKey,
  PBKDF2_ITERATIONS,
  randomBytes,
  seal,
  sha256Hex,
  toBase64,
  unseal,
} from '../lib/crypto';
import { getState, setState } from '../store';
import type { Item, ItemDoc, Sealed, Secrets } from '../types';

/**
 * Hidden section, encrypted on the device.
 *
 * A random 256-bit data key (DEK) encrypts every hidden item. The DEK is stored
 * in users/{uid}.vault wrapped with a key derived from the user's password
 * (PBKDF2-SHA256). Firestore only ever sees ciphertext, and changing the
 * password re-wraps the DEK without touching the items.
 */
interface VaultDoc {
  v: 1;
  salt: string;
  iter: number;
  wrapped: Sealed;
}

export class VaultError extends Error {
  constructor(readonly reason: 'wrong-password' | 'legacy-mismatch' | 'locked' | 'exists') {
    super(reason);
  }
}

const AUTO_LOCK_MS = 5 * 60_000;

let uid: string | null = null;
let key: CryptoKey | null = null;
let vaultDoc: VaultDoc | null = null;
let unsubscribe: (() => void) | null = null;
let hiddenSince = 0;
let settingUp = false;
let unreachableTimer = 0;
/** IV of the sealed payload each revealed item was decrypted from, to notice edits. */
const revealedFrom = new Map<string, string>();
/** Decryptions in flight (id to iv), so a slow old one never lands over a newer one. */
const revealing = new Map<string, string>();
const migrating = new Set<string>();
/** Legacy items whose migration failed: id to the earliest time to try again. */
const migrationRetryAt = new Map<string, { at: number; attempts: number }>();

const legacyKey = (id: string) => `vault_secret_${id}`;

function dropLegacyHash(id: string) {
  try {
    localStorage.removeItem(legacyKey(id));
  } catch {
    // Storage unavailable: nothing to clean.
  }
}

export function watchVault(userId: string) {
  stopVault();
  uid = userId;
  // Without an answer from the server we cannot tell "no vault" from "offline"; say so.
  unreachableTimer = window.setTimeout(() => {
    if (getState().vault === 'loading') setState({ vault: 'unreachable' });
  }, 8000);
  unsubscribe = onSnapshot(
    doc(db, 'users', userId),
    { includeMetadataChanges: true },
    (snap) => {
      vaultDoc = (snap.get('vault') as VaultDoc | undefined) ?? null;
      // Once a vault exists, v1's unsalted password hash in this browser is only a liability.
      if (vaultDoc) dropLegacyHash(userId);
      if (key || settingUp) return;
      // "No vault yet" is only trusted from the server: offering to create one from a
      // stale cache would replace the real wrapped key and orphan every hidden item.
      if (vaultDoc) setState({ vault: 'locked' });
      else if (!snap.metadata.fromCache) setState({ vault: 'absent' });
    },
    (err) => console.error('Vault listener failed', err),
  );
}

export function stopVault() {
  unsubscribe?.();
  unsubscribe = null;
  clearTimeout(unreachableTimer);
  uid = null;
  key = null;
  vaultDoc = null;
  revealedFrom.clear();
  revealing.clear();
  setState({ vault: 'loading', revealed: new Map() });
}

export const vaultKey = () => key;

async function unwrap(password: string, v: VaultDoc): Promise<Uint8Array<ArrayBuffer>> {
  const kek = await deriveKey(password, fromBase64(v.salt), v.iter);
  try {
    return new Uint8Array(await decryptBytes(kek, fromBase64(v.wrapped.iv), fromBase64(v.wrapped.data)));
  } catch {
    throw new VaultError('wrong-password');
  }
}

async function wrap(password: string, dek: Uint8Array<ArrayBuffer>): Promise<VaultDoc> {
  const salt = randomBytes(16);
  const kek = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const { iv, data } = await encryptBytes(kek, dek);
  return { v: 1, salt: toBase64(salt), iter: PBKDF2_ITERATIONS, wrapped: { iv: toBase64(iv), data: toBase64(data) } };
}

export async function setupVault(password: string) {
  if (!uid) throw new VaultError('locked');
  // v1 kept a SHA-256 of the password in this browser's localStorage. If it is
  // there, insist on the same password so the user keeps the one they know.
  const legacy = localStorage.getItem(legacyKey(uid));
  if (legacy && legacy !== (await sha256Hex(password))) throw new VaultError('legacy-mismatch');

  const dek = randomBytes(32);
  const next = await wrap(password, dek);
  const dataKey = await importDataKey(dek);
  dek.fill(0);
  const ref = doc(db, 'users', uid);
  const found: { vault: VaultDoc | null } = { vault: null };
  settingUp = true;
  try {
    // A transaction reads the server copy, so two devices (or a stale offline cache)
    // can never both create a vault: the second one fails instead of overwriting.
    await runTransaction(db, async (tx) => {
      const current = await tx.get(ref);
      found.vault = (current.get('vault') as VaultDoc | undefined) ?? null;
      if (found.vault) throw new VaultError('exists');
      tx.set(ref, { vault: next }, { merge: true });
    });
  } catch (err) {
    // Someone created it first: switch the UI to the unlock form for that vault.
    if (found.vault) {
      vaultDoc = found.vault;
      setState({ vault: 'locked' });
    }
    throw err;
  } finally {
    settingUp = false;
  }
  vaultDoc = next;
  key = dataKey;
  dropLegacyHash(uid);
  afterUnlock();
}

export async function unlockVault(password: string) {
  if (!uid || !vaultDoc) throw new VaultError('locked');
  const dek = await unwrap(password, vaultDoc);
  key = await importDataKey(dek);
  dek.fill(0);
  afterUnlock();
}

export async function changeVaultPassword(current: string, next: string) {
  if (!uid || !vaultDoc) throw new VaultError('locked');
  const dek = await unwrap(current, vaultDoc);
  const rewrapped = await wrap(next, dek);
  dek.fill(0);
  await setDoc(doc(db, 'users', uid), { vault: rewrapped }, { merge: true });
  vaultDoc = rewrapped;
}

export function lockVault() {
  if (!key) return;
  key = null;
  revealedFrom.clear();
  revealing.clear();
  setState({ vault: vaultDoc ? 'locked' : 'absent', revealed: new Map() });
}

function afterUnlock() {
  setState({ vault: 'unlocked' });
  void revealItems(getState().items);
  void migrateLegacyItems(getState().items);
}

export async function sealSecrets(secrets: Secrets): Promise<Sealed> {
  if (!key) throw new VaultError('locked');
  return seal(key, secrets);
}

export async function encryptFile(file: Blob): Promise<{ blob: Blob; iv: string }> {
  if (!key) throw new VaultError('locked');
  const { iv, data } = await encryptBytes(key, await file.arrayBuffer());
  return { blob: new Blob([data], { type: 'application/octet-stream' }), iv: toBase64(iv) };
}

export async function decryptFile(data: ArrayBuffer, iv: string): Promise<ArrayBuffer> {
  if (!key) throw new VaultError('locked');
  return decryptBytes(key, fromBase64(iv), data);
}

/** Decrypt hidden items that are new or whose sealed payload changed (an edit elsewhere). */
export async function revealItems(items: readonly Item[]) {
  const current = key;
  if (!current) return;
  const todo = items.filter((i) => i.isSecret && i.sealed && revealedFrom.get(i.id) !== i.sealed.iv && revealing.get(i.id) !== i.sealed.iv);
  if (!todo.length) return;
  for (const item of todo) revealing.set(item.id, item.sealed!.iv);
  const results = await Promise.all(
    todo.map(async (item) => {
      try {
        return { item, secrets: await unseal<Secrets>(current, item.sealed!) };
      } catch (err) {
        console.warn('Could not decrypt item', item.id, err);
        return null;
      } finally {
        if (revealing.get(item.id) === item.sealed!.iv) revealing.delete(item.id);
      }
    }),
  );
  if (key !== current) return;
  // Merge into the latest map, and only results that still match the item's current payload.
  const latest = new Map(getState().items.map((i) => [i.id, i.sealed?.iv]));
  const next = new Map(getState().revealed);
  for (const result of results) {
    if (!result || latest.get(result.item.id) !== result.item.sealed!.iv) continue;
    next.set(result.item.id, result.secrets);
    revealedFrom.set(result.item.id, result.item.sealed!.iv);
  }
  setState({ revealed: next });
}

/**
 * v1 stored hidden notes in plain text. Encrypt them in place while the vault is open.
 * Each item is sealed from the SERVER copy inside a transaction, so a stale local
 * snapshot can never revert a newer edit, and transactions simply fail offline.
 */
export async function migrateLegacyItems(items: readonly Item[]) {
  const userId = uid;
  if (!userId || !key) return;
  const now = Date.now();
  const todo = items.filter(
    (i) => i.isSecret && (!i.sealed || i.content != null) && !migrating.has(i.id) && (migrationRetryAt.get(i.id)?.at ?? 0) <= now,
  );
  await Promise.allSettled(
    todo.map(async (item) => {
      migrating.add(item.id);
      const ref = doc(db, 'users', userId, 'files', item.id);
      // What the committed attempt sealed (a transaction may run its body more than once).
      let written: { sealed: Sealed; secrets: Secrets } | null = null;
      try {
        await runTransaction(db, async (tx) => {
          written = null;
          const snap = await tx.get(ref);
          if (!snap.exists()) return;
          const data = snap.data() as Partial<ItemDoc>;
          if (!data.isSecret) return;
          if (data.sealed && data.content == null) return;
          const patch: Record<string, unknown> = { content: deleteField(), thumbnail: null };
          if (!data.sealed) {
            const secrets: Secrets = {
              name: data.name ?? '',
              content: data.content ?? undefined,
              type: data.type,
              thumbnail: data.thumbnail ?? null,
            };
            const sealed = await sealSecrets(secrets);
            patch.sealed = sealed;
            patch.name = data.category === 'note' ? 'Nota oculta' : 'Archivo oculto';
            written = { sealed, secrets };
          }
          tx.update(ref, patch);
        });
        migrationRetryAt.delete(item.id);
        // We already know the plaintext: publish it as revealed so the item never flashes
        // "sealed" (which would close an open preview) while it waits to be decrypted.
        const done = written as { sealed: Sealed; secrets: Secrets } | null;
        if (done && key) {
          revealedFrom.set(item.id, done.sealed.iv);
          setState({ revealed: new Map(getState().revealed).set(item.id, done.secrets) });
        }
      } catch (err) {
        const attempts = (migrationRetryAt.get(item.id)?.attempts ?? 0) + 1;
        migrationRetryAt.set(item.id, { attempts, at: Date.now() + Math.min(30 * 60_000, 15_000 * 2 ** attempts) });
        console.warn('Legacy migration failed; will retry', item.id, err);
      } finally {
        migrating.delete(item.id);
      }
    }),
  );
}

// Lock after the tab has been in the background for a while.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenSince = Date.now();
  } else if (key && hiddenSince && Date.now() - hiddenSince > AUTO_LOCK_MS) {
    lockVault();
  }
});
