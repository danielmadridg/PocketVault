import { setDoc, Timestamp } from 'firebase/firestore';
import type { StorageReference } from 'firebase/storage';
import { EXPIRY_MS, MAX_FILE_BYTES, UPLOAD_CONCURRENCY } from '../config';
import { loadStorage } from '../firebase';
import { categoryOf } from '../lib/category';
import { DEVICE_ID } from '../lib/device';
import { formatBytes, pastedFileName } from '../lib/format';
import { makeThumbnail } from '../lib/media';
import { getState, removeUpload, setState, updateUpload } from '../store';
import type { ItemDoc, Upload } from '../types';
import { deleteStorageObject, itemRef, newItemId } from './items';
import { encryptFile, sealSecrets } from './vault';

export interface UploadNotice {
  message: string;
  kind: 'error' | 'info';
}

const queue: string[] = [];
const running = new Map<string, () => void>();
const cancelled = new Set<string>();
let active = 0;

/** Clipboard images arrive as "image.png"; give them a name worth reading later. */
export function nameForPasted(file: File): File {
  const generic = !file.name || /^(image|blob|unknown)\.\w+$/i.test(file.name);
  return generic ? new File([file], pastedFileName(file.type || 'application/octet-stream'), { type: file.type }) : file;
}

export function usedBytes(): number {
  const { items, uploads } = getState();
  return items.reduce((sum, i) => sum + (i.size || 0), 0) + uploads.reduce((sum, u) => sum + u.file.size, 0);
}

/**
 * Queue files for upload. Returns problems to surface; accepted files show up
 * immediately as placeholder cards with progress.
 */
export function enqueueFiles(files: File[], secret: boolean): UploadNotice[] {
  const { user, quotaBytes, uploads } = getState();
  if (!user) return [];
  const notices: UploadNotice[] = [];
  let used = usedBytes();
  const added: Upload[] = [];

  for (const file of files) {
    if (file.size === 0 && !file.type) {
      notices.push({ kind: 'error', message: `«${file.name}» parece una carpeta. Comprímela y súbela como .zip.` });
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      notices.push({ kind: 'error', message: `«${file.name}» pesa ${formatBytes(file.size)}. El máximo por archivo es 100 MB.` });
      continue;
    }
    if (used + file.size > quotaBytes) {
      const left = Math.max(0, quotaBytes - used);
      notices.push({ kind: 'error', message: `No queda espacio para «${file.name}». Libres: ${formatBytes(left)}. Borra algo o espera a que caduque.` });
      break;
    }
    used += file.size;
    added.push({
      id: newItemId(user.uid),
      file,
      name: file.name,
      category: categoryOf(file.type, file.name),
      secret,
      progress: 0,
      state: 'queued',
      createdAt: Date.now(),
    });
  }

  if (added.length) {
    setState({ uploads: [...added.reverse(), ...uploads] });
    queue.push(...added.map((u) => u.id).reverse());
    pump();
  }
  return notices;
}

function pump() {
  while (active < UPLOAD_CONCURRENCY && queue.length) {
    const id = queue.shift()!;
    active++;
    void run(id).finally(() => {
      active--;
      pump();
    });
  }
}

function friendlyError(err: unknown): string {
  const code = (err as { code?: string }).code ?? '';
  if (code === 'storage/unauthorized') return 'Sin permiso para subir este archivo.';
  if (code === 'storage/quota-exceeded') return 'El almacenamiento del proyecto está lleno.';
  if (code === 'storage/retry-limit-exceeded' || !navigator.onLine) return 'Sin conexión. Reintenta cuando vuelva.';
  if ((err as Error).message === 'locked') return 'La sección oculta se ha bloqueado. Ábrela y reintenta.';
  return 'La subida ha fallado.';
}

class Cancelled extends Error {}

async function run(id: string) {
  const upload = getState().uploads.find((u) => u.id === id);
  const user = getState().user;
  if (!upload || !user) return;
  updateUpload(id, { state: 'uploading', progress: 0, error: undefined });

  // Cancel can arrive between any two awaits, not only while bytes are moving.
  const check = () => {
    if (cancelled.has(id)) throw new Cancelled();
  };
  let storageModule: Awaited<ReturnType<typeof loadStorage>>['mod'] | null = null;
  let stored: StorageReference | null = null;

  try {
    const { mod, storage } = await loadStorage();
    storageModule = mod;
    check();
    const thumbnail = makeThumbnail(upload.file);

    let body: Blob = upload.file;
    let path = `files/${user.uid}/${id}/${upload.name.replace(/[\\/]/g, '_')}`;
    let hidden: Pick<ItemDoc, 'fileIv' | 'sealed'> | null = null;
    if (upload.secret) {
      // Seal everything before any byte leaves: if the vault locks mid-upload, nothing is stranded.
      const [encrypted, thumb] = await Promise.all([encryptFile(upload.file), thumbnail]);
      hidden = { fileIv: encrypted.iv, sealed: await sealSecrets({ name: upload.name, type: upload.file.type, thumbnail: thumb }) };
      body = encrypted.blob;
      path = `files/${user.uid}/${id}/sealed`;
    }
    check();

    const ref = mod.ref(storage, path);
    const task = mod.uploadBytesResumable(ref, body, {
      contentType: upload.secret ? 'application/octet-stream' : upload.file.type || 'application/octet-stream',
      // Every object path is unique, so browsers may cache it forever.
      cacheControl: 'private, max-age=31536000, immutable',
    });
    running.set(id, () => task.cancel());

    let frame = 0;
    await new Promise<void>((resolve, reject) => {
      task.on(
        'state_changed',
        (snap) => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => updateUpload(id, { progress: snap.bytesTransferred / (snap.totalBytes || 1) }));
        },
        reject,
        resolve,
      );
    });
    cancelAnimationFrame(frame);
    stored = ref;
    check();
    updateUpload(id, { state: 'saving', progress: 1 });

    const [downloadURL, thumb] = await Promise.all([mod.getDownloadURL(ref), hidden ? null : thumbnail]);
    check();
    const now = Timestamp.now();
    const base = {
      size: upload.file.size,
      category: upload.category,
      storagePath: path,
      downloadURL,
      isFavorite: false,
      isSecret: upload.secret,
      uploadedAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + EXPIRY_MS),
      device: DEVICE_ID,
    };
    const data: ItemDoc = hidden
      ? { ...base, ...hidden, name: 'Archivo oculto', type: 'application/octet-stream', thumbnail: null }
      : { ...base, name: upload.name, type: upload.file.type, thumbnail: thumb };

    // The item listener removes the placeholder once the document lands in the cache.
    await setDoc(itemRef(user.uid, id), data);
  } catch (err) {
    if (err instanceof Cancelled || (err as { code?: string }).code === 'storage/canceled') {
      // Cancelled after bytes landed (this attempt or an earlier failed one): no orphan left behind.
      if (stored && storageModule) storageModule.deleteObject(stored).catch(() => {});
      else if (upload.landedPath) deleteStorageObject(upload.landedPath).catch(() => {});
      removeUpload(id);
      return;
    }
    console.error('Upload failed', err);
    updateUpload(id, { state: 'error', error: friendlyError(err), landedPath: stored?.fullPath ?? upload.landedPath });
  } finally {
    running.delete(id);
    cancelled.delete(id);
  }
}

export function cancelUpload(id: string) {
  // A running upload cleans up after itself in run(); here only an idle one (failed or queued).
  const landed = getState().uploads.find((u) => u.id === id)?.landedPath;
  if (landed && !running.has(id)) void deleteStorageObject(landed).catch(() => {});
  const queued = queue.indexOf(id);
  if (queued >= 0) queue.splice(queued, 1);
  else if (getState().uploads.find((u) => u.id === id)?.state !== 'error') cancelled.add(id);
  running.get(id)?.();
  // The card goes at once; run() cleans up at its next checkpoint.
  removeUpload(id);
}

export function retryUpload(id: string) {
  updateUpload(id, { state: 'queued', progress: 0, error: undefined });
  queue.push(id);
  pump();
}
