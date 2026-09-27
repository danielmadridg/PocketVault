import { UNDO_WINDOW_MS } from '../config';
import { formatBytes } from '../lib/format';
import { icon } from '../lib/icons';
import { copyItem, downloadItem, forgetBlob, viewOf, type CopyResult } from '../services/content';
import { createNote, markDeleting, removeItemData, setPinned } from '../services/items';
import { enqueueFiles, nameForPasted } from '../services/upload';
import { getState, setState } from '../store';
import type { Item } from '../types';
import { RESUME_MS, toast, toastError, type ToastHandle } from './toast';

/** Swap a button's icon for a check for a moment: feedback where the click happened. */
export function flashDone(button: HTMLElement | null | undefined, label?: string) {
  if (!button || button.dataset.busy) return;
  const original = button.innerHTML;
  button.dataset.busy = '1';
  button.classList.add('is-done');
  const svg = button.querySelector('svg');
  if (svg) svg.outerHTML = icon('check', Number(svg.getAttribute('width')) || 16).value;
  const text = button.querySelector('.btn-label');
  if (text && label) text.textContent = label;
  setTimeout(() => {
    button.innerHTML = original;
    button.classList.remove('is-done');
    delete button.dataset.busy;
  }, 1400);
}

const COPIED: Record<CopyResult, string> = {
  text: 'Texto copiado',
  image: 'Imagen copiada',
  link: 'Copiado el enlace de descarga',
};

export async function copy(item: Item, button?: HTMLElement | null) {
  try {
    const result = await copyItem(item);
    flashDone(button, 'Copiado');
    // A link is not what people expect when they copy a file, so say it out loud.
    if (!button || result === 'link') toast(COPIED[result]);
  } catch (err) {
    console.error('Copy failed', err);
    toastError(item.isSecret ? 'No se pudo copiar. Los archivos ocultos solo se pueden descargar.' : 'No se pudo copiar. Prueba a descargarlo.');
  }
}

export async function download(item: Item, button?: HTMLElement | null) {
  const { name } = viewOf(item);
  if (item.size > 8 * 1024 * 1024) toast(`Descargando «${name}» (${formatBytes(item.size)})…`, { key: `dl-${item.id}` });
  try {
    await downloadItem(item);
    flashDone(button);
  } catch (err) {
    console.error('Download failed', err);
    toastError(`No se pudo descargar «${name}».`);
  }
}

export function togglePin(item: Item) {
  const uid = getState().user?.uid;
  if (uid) setPinned(uid, item, !item.isFavorite);
}

interface PendingDelete {
  item: Item;
  uid: string;
  timer: number;
  toast: ToastHandle;
}

const pendingDeletes = new Map<string, PendingDelete>();

function clearPending(id: string) {
  const next = new Set(getState().pendingDelete);
  next.delete(id);
  setState({ pendingDelete: next });
}

function commitDelete(id: string) {
  const pending = pendingDeletes.get(id);
  if (!pending) return;
  pendingDeletes.delete(id);
  clearTimeout(pending.timer);
  pending.toast.dismiss();
  forgetBlob(id);
  removeItemData(pending.uid, pending.item)
    .catch((err) => {
      // The item is already marked: it stays hidden and any device finishes the delete later.
      console.warn('Delete will be retried', err);
    })
    .finally(() => clearPending(id));
}

/** Hide at once, delete for real after the undo window. */
export function deleteWithUndo(item: Item) {
  const uid = getState().user?.uid;
  if (!uid || pendingDeletes.has(item.id)) return;
  setState({ pendingDelete: new Set(getState().pendingDelete).add(item.id) });
  const handle = toast(`Borrado «${viewOf(item).name}»`, {
    duration: UNDO_WINDOW_MS + 400,
    // Resting the pointer on the toast pauses the delete too, so "Deshacer" always means it.
    onHold: (held) => {
      const pending = pendingDeletes.get(item.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      if (!held) pending.timer = window.setTimeout(() => commitDelete(item.id), RESUME_MS);
    },
    action: {
      label: 'Deshacer',
      run: () => {
        const pending = pendingDeletes.get(item.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingDeletes.delete(item.id);
        clearPending(item.id);
      },
    },
  });
  // The delete timer is authoritative: when it fires, the toast (and its Undo) goes with it.
  pendingDeletes.set(item.id, { item, uid, timer: window.setTimeout(() => commitDelete(item.id), UNDO_WINDOW_MS), toast: handle });
}

/**
 * Commit every delete still inside its undo window (before signing out). The tombstones
 * are queued synchronously, so waitForPendingWrites() afterwards covers them.
 */
export async function flushPendingDeletes() {
  const all = [...pendingDeletes.values()];
  pendingDeletes.clear();
  for (const p of all) {
    clearTimeout(p.timer);
    p.toast.dismiss();
    markDeleting(p.uid, p.item.id).catch(() => {});
  }
  await Promise.allSettled(all.map((p) => removeItemData(p.uid, p.item).finally(() => clearPending(p.item.id))));
}

// Closing the tab inside the undo window still deletes: the tombstone write is queued in
// the offline cache and synced on the next visit, which then removes the file and the doc.
window.addEventListener('pagehide', () => {
  for (const p of pendingDeletes.values()) {
    clearTimeout(p.timer);
    markDeleting(p.uid, p.item.id).catch(() => {});
  }
  pendingDeletes.clear();
});

/** Content goes to the hidden section while its tab is open or the composer's "Oculto" is armed. */
export function wantsSecret(): boolean {
  const { tab, composeSecret } = getState();
  return composeSecret || tab === 'secret';
}

/** Meant for the hidden section but it is locked: refuse, never fall back to saving in the clear. */
function refusedWhileLocked(secret: boolean): boolean {
  if (!secret || getState().vault === 'unlocked') return false;
  setState({ tab: 'secret' });
  toast('La sección oculta está cerrada. Ábrela y vuelve a intentarlo.', { key: 'vault-locked' });
  return true;
}

/** Returns true if at least one file was queued. */
export function uploadFiles(files: File[], secret = wantsSecret()): boolean {
  if (!files.length || refusedWhileLocked(secret)) return false;
  const before = getState().uploads.length;
  for (const notice of enqueueFiles(files.map(nameForPasted), secret)) {
    toast(notice.message, { kind: notice.kind });
  }
  return getState().uploads.length > before;
}

/** Save a note. Returns false if nothing was saved (empty, or the hidden section is locked). */
export async function saveNote(text: string, secret = wantsSecret(), options: { undo?: boolean } = {}): Promise<boolean> {
  const { user } = getState();
  if (!user || !text.trim() || refusedWhileLocked(secret)) return false;
  try {
    const id = await createNote(user.uid, text, secret);
    if (options.undo) {
      toast(secret ? 'Nota guardada en la sección oculta' : 'Nota guardada', {
        action: {
          label: 'Deshacer',
          run: () => void removeItemData(user.uid, { id, storagePath: null }).catch(() => toastError('No se pudo deshacer.')),
        },
      });
    }
    return true;
  } catch (err) {
    console.error('Note failed', err);
    toastError('No se pudo guardar la nota.');
    return false;
  }
}

function filesFrom(data: DataTransfer): File[] {
  if (data.files.length) return Array.from(data.files);
  return Array.from(data.items)
    .filter((i) => i.kind === 'file')
    .map((i) => i.getAsFile())
    .filter((f): f is File => f !== null);
}

export type PasteResult = 'ignored' | 'refused' | 'saved';

/**
 * Global Ctrl+V: files and images upload, text becomes a note.
 * 'ignored' lets the browser paste normally (text into a field).
 */
export function handlePasteData(data: DataTransfer, intoField: boolean): PasteResult {
  const text = data.getData('text/plain');
  let files = filesFrom(data);
  // Office apps put a rendered picture ("image.png") next to the text of what you copied.
  // The text is what people mean; real files (from the file explorer) keep their names.
  if (text.trim() && files.length && files.every((f) => f.type.startsWith('image/') && /^image\.\w+$/i.test(f.name))) {
    files = [];
  }
  if (files.length) return uploadFiles(files) ? 'saved' : 'refused';
  if (intoField || !text.trim()) return 'ignored';
  const secret = wantsSecret();
  if (refusedWhileLocked(secret)) return 'refused';
  void saveNote(text, secret, { undo: true });
  return 'saved';
}

/** Touch devices have no Ctrl+V: read the clipboard through the async API instead. Returns true if something was saved. */
export async function pasteFromClipboard(): Promise<boolean> {
  if (!navigator.clipboard) {
    toastError('Este navegador no deja leer el portapapeles. Mantén pulsado el cuadro de texto y elige Pegar.');
    return false;
  }
  try {
    let text = '';
    const files: File[] = [];
    if (navigator.clipboard.read) {
      for (const entry of await navigator.clipboard.read()) {
        const imageType = entry.types.find((t) => t.startsWith('image/'));
        if (imageType) files.push(new File([await entry.getType(imageType)], '', { type: imageType }));
        else if (entry.types.includes('text/plain')) text += await (await entry.getType('text/plain')).text();
      }
    } else {
      text = await navigator.clipboard.readText();
    }
    if (files.length) return uploadFiles(files);
    if (text.trim()) return saveNote(text, wantsSecret(), { undo: true });
    toast('El portapapeles está vacío.');
    return false;
  } catch (err) {
    console.warn('Clipboard read failed', err);
    toastError('No hay permiso para leer el portapapeles. Pega dentro del cuadro de texto.');
    return false;
  }
}
