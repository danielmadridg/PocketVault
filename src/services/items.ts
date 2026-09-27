import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  Timestamp,
  updateDoc,
  type DocumentData,
} from 'firebase/firestore';
import { EXPIRY_MS, NEVER_EXPIRES } from '../config';
import { db, loadStorage } from '../firebase';
import { DEVICE_ID } from '../lib/device';
import { noteTitle } from '../lib/format';
import { getState, setState } from '../store';
import type { Category, Item, ItemDoc } from '../types';
import { sealSecrets } from './vault';

export const filesCollection = (uid: string) => collection(db, 'users', uid, 'files');
export const itemRef = (uid: string, id: string) => doc(db, 'users', uid, 'files', id);
export const newItemId = (uid: string) => doc(filesCollection(uid)).id;

export const expiryFromNow = () => Timestamp.fromMillis(Date.now() + EXPIRY_MS);

/** Fired for items that arrive from another device while this session is open. */
export const remoteItems = new EventTarget();

let unsubscribe: (() => void) | null = null;
let sweepTimer = 0;
const expiring = new Set<string>();

function normalize(id: string, data: DocumentData): Item {
  const d = data as Partial<ItemDoc>;
  return {
    id,
    name: d.name ?? 'Sin nombre',
    content: d.content ?? null,
    size: d.size ?? 0,
    type: d.type ?? '',
    category: (d.category ?? 'other') as Category,
    storagePath: d.storagePath ?? null,
    downloadURL: d.downloadURL ?? null,
    thumbnail: d.thumbnail ?? null,
    isFavorite: d.isFavorite === true,
    isSecret: d.isSecret === true,
    uploadedAt: d.uploadedAt ?? Timestamp.now(),
    expiresAt: d.expiresAt ?? Timestamp.fromDate(NEVER_EXPIRES),
    device: d.device,
    sealed: d.sealed ?? null,
    fileIv: d.fileIv ?? null,
  };
}

const isExpired = (item: Item, now: number) => !item.isFavorite && item.expiresAt.toMillis() <= now;

/**
 * Deleting is a three-step, restartable sequence:
 *   1. mark the document `deleting: true` (a Firestore write: queued at once, even offline
 *      or while the page unloads, and synced later);
 *   2. delete the Storage object, which also revokes its download link;
 *   3. delete the document.
 * Marked documents are hidden everywhere, and any device finishes them on its next
 * server-confirmed snapshot, so an interrupted delete never leaves an orphaned file
 * nor brings the item back.
 */
const finishing = new Set<string>();

export function markDeleting(uid: string, id: string): Promise<void> {
  return updateDoc(itemRef(uid, id), { deleting: true });
}

async function finishDelete(uid: string, id: string, storagePath: string | null) {
  if (finishing.has(id)) return;
  finishing.add(id);
  try {
    if (storagePath) await deleteStorageObject(storagePath);
    await deleteDoc(itemRef(uid, id));
  } finally {
    finishing.delete(id);
  }
}

/** Delete an item for good (the user's own delete, after the undo window). */
export async function removeItemData(uid: string, item: Pick<Item, 'id' | 'storagePath'>) {
  // Not awaited: it is queued locally right away; awaiting would wait for the server ack.
  markDeleting(uid, item.id).catch(() => {});
  await finishDelete(uid, item.id, item.storagePath);
}

/**
 * Items expire client-side: whichever device opens the vault first deletes them.
 * The decision is made on the server copy inside a transaction, never on local state:
 * a page that slept or froze may still believe an item is unpinned after another
 * device pinned it. Transactions fail offline, so a stale cache can never delete.
 */
async function expire(uid: string, item: Item) {
  if (expiring.has(item.id)) return;
  expiring.add(item.id);
  try {
    const ref = itemRef(uid, item.id);
    const doomed = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return null;
      const data = snap.data() as Partial<ItemDoc>;
      const expiresAt = data.expiresAt?.toMillis() ?? Number.POSITIVE_INFINITY;
      if (!data.deleting && (data.isFavorite === true || expiresAt > Date.now())) return null;
      if (!data.deleting) tx.update(ref, { deleting: true });
      return { storagePath: data.storagePath ?? null };
    });
    if (doomed) await finishDelete(uid, item.id, doomed.storagePath);
  } catch (err) {
    console.warn('Could not expire item; will retry', item.id, err);
  } finally {
    expiring.delete(item.id);
  }
}

/** Delete a Storage object; one that is already gone counts as deleted. */
export async function deleteStorageObject(path: string) {
  const { mod, storage } = await loadStorage();
  try {
    await mod.deleteObject(mod.ref(storage, path));
  } catch (err) {
    if ((err as { code?: string }).code !== 'storage/object-not-found') throw err;
  }
}

export function watchItems(uid: string) {
  stopItems();
  const sessionStart = Date.now();
  let first = true;
  // Only delete on data the server has confirmed. The first snapshot comes from the
  // offline cache, which may not know that another device pinned the item since.
  let confirmed = false;

  unsubscribe = onSnapshot(
    query(filesCollection(uid), orderBy('uploadedAt', 'desc')),
    // Metadata changes are needed to learn when the cache has caught up with the server.
    { includeMetadataChanges: true },
    (snap) => {
      const now = Date.now();
      confirmed = !snap.metadata.fromCache;
      const items: Item[] = [];
      for (const d of snap.docs) {
        const data = d.data();
        // A tombstone is never shown; once the server has confirmed it, finish the job.
        if (data.deleting === true) {
          if (confirmed) void finishDelete(uid, d.id, (data.storagePath as string | null) ?? null).catch(() => {});
          continue;
        }
        const item = normalize(d.id, data);
        if (!isExpired(item, now)) items.push(item);
        else if (confirmed) void expire(uid, item);
      }

      if (!first) {
        for (const change of snap.docChanges()) {
          if (change.type !== 'added' || change.doc.metadata.hasPendingWrites || change.doc.get('deleting') === true) continue;
          const item = normalize(change.doc.id, change.doc.data());
          if (item.device !== DEVICE_ID && item.uploadedAt.toMillis() > sessionStart) {
            remoteItems.dispatchEvent(new CustomEvent<Item>('item', { detail: item }));
          }
        }
      }
      first = false;

      // An upload placeholder is replaced by its real item as soon as the item exists.
      const ids = new Set(items.map((i) => i.id));
      const uploads = getState().uploads;
      const remaining = uploads.filter((u) => !ids.has(u.id));
      setState({ items, itemsLoaded: true, ...(remaining.length !== uploads.length && { uploads: remaining }) });
    },
    (err) => {
      console.error('Firestore listener failed', err);
      setState({ itemsLoaded: true });
      document.dispatchEvent(new CustomEvent('pv:error', { detail: 'No se pudo cargar tu bóveda. Revisa la conexión y recarga.' }));
    },
  );

  // Items can expire while the page stays open.
  sweepTimer = window.setInterval(() => {
    const now = Date.now();
    const { items } = getState();
    const alive = items.filter((i) => !isExpired(i, now));
    if (alive.length === items.length) return;
    // Hidden right away; the transaction in expire() decides on the server copy.
    if (confirmed) items.filter((i) => isExpired(i, now)).forEach((i) => void expire(uid, i));
    setState({ items: alive });
  }, 60_000);
}

export function stopItems() {
  unsubscribe?.();
  unsubscribe = null;
  clearInterval(sweepTimer);
  expiring.clear();
}

export async function createNote(uid: string, text: string, secret: boolean): Promise<string> {
  const ref = doc(filesCollection(uid));
  const now = Timestamp.now();
  const base = {
    size: 0,
    type: 'text/plain',
    category: 'note' as const,
    storagePath: null,
    downloadURL: null,
    thumbnail: null,
    isFavorite: false,
    isSecret: secret,
    uploadedAt: now,
    expiresAt: Timestamp.fromMillis(now.toMillis() + EXPIRY_MS),
    device: DEVICE_ID,
  };
  const data: ItemDoc = secret
    ? { ...base, name: 'Nota oculta', content: null, sealed: await sealSecrets({ name: noteTitle(text), content: text }) }
    : { ...base, name: noteTitle(text), content: text };
  // Not awaited: the local cache applies the write instantly and syncs in the background.
  setDoc(ref, data).catch(reportWriteError);
  return ref.id;
}

export async function updateNote(uid: string, item: Item, text: string) {
  // Hidden notes also drop any v1 plaintext fields, in case this one was never migrated.
  const patch = item.isSecret
    ? { sealed: await sealSecrets({ name: noteTitle(text), content: text }), name: 'Nota oculta', content: deleteField(), thumbnail: null }
    : { name: noteTitle(text), content: text };
  updateDoc(itemRef(uid, item.id), patch).catch(reportWriteError);
}

export function setPinned(uid: string, item: Item, pinned: boolean) {
  const expiresAt = pinned ? Timestamp.fromDate(NEVER_EXPIRES) : expiryFromNow();
  updateDoc(itemRef(uid, item.id), { isFavorite: pinned, expiresAt }).catch(reportWriteError);
}

function reportWriteError(err: unknown) {
  console.error('Write failed', err);
  document.dispatchEvent(new CustomEvent('pv:error', { detail: 'No se pudo guardar el cambio.' }));
}
