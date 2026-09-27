import { toPngBlob, saveBlob } from '../lib/media';
import { getState } from '../store';
import type { Item, Secrets } from '../types';
import { decryptFile } from './vault';

/** What the user sees for an item: decrypted fields for hidden items, plain fields otherwise. */
export interface View {
  name: string;
  type: string;
  content: string;
  thumbnail: string | null;
  /** Hidden item whose fields are not decrypted (vault locked or still decrypting). */
  sealed: boolean;
}

export function viewOf(item: Item, revealed: ReadonlyMap<string, Secrets> = getState().revealed): View {
  // Hidden items show nothing while the vault is closed, including v1 notes not yet re-encrypted.
  if (item.isSecret && getState().vault !== 'unlocked') {
    return { name: item.category === 'note' ? 'Nota oculta' : 'Archivo oculto', type: '', content: '', thumbnail: null, sealed: true };
  }
  if (item.isSecret && item.sealed) {
    const secrets = revealed.get(item.id);
    if (!secrets) return { name: item.name, type: item.type, content: '', thumbnail: null, sealed: true };
    return {
      name: secrets.name,
      type: secrets.type ?? item.type,
      content: secrets.content ?? '',
      thumbnail: secrets.thumbnail ?? null,
      sealed: false,
    };
  }
  return { name: item.name, type: item.type, content: item.content ?? item.name, thumbnail: item.thumbnail, sealed: false };
}

const blobCache = new Map<string, Promise<Blob>>();
const CACHE_MAX_ITEM = 20 * 1024 * 1024;

/** The item's bytes, decrypted if needed. Small files stay cached for the session (LRU of 12). */
export function itemBlob(item: Item): Promise<Blob> {
  const cached = blobCache.get(item.id);
  if (cached) return cached;
  const promise = (async () => {
    if (!item.downloadURL) throw new Error('No file');
    const res = await fetch(item.downloadURL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (item.isSecret && item.fileIv) {
      const plain = await decryptFile(await res.arrayBuffer(), item.fileIv);
      return new Blob([plain], { type: viewOf(item).type || 'application/octet-stream' });
    }
    return res.blob();
  })();
  // Decrypted bytes are never kept around: they must not outlive the vault being locked.
  if (item.size <= CACHE_MAX_ITEM && !item.isSecret) {
    blobCache.set(item.id, promise);
    promise.catch(() => blobCache.delete(item.id));
    if (blobCache.size > 12) blobCache.delete(blobCache.keys().next().value!);
  }
  return promise;
}

export function forgetBlob(id: string) {
  blobCache.delete(id);
}

export async function downloadItem(item: Item) {
  const view = viewOf(item);
  if (item.category === 'note') {
    saveBlob(new Blob([view.content], { type: 'text/plain;charset=utf-8' }), `${view.name.slice(0, 40) || 'nota'}.txt`);
    return;
  }
  saveBlob(await itemBlob(item), view.name);
}

export type CopyResult = 'text' | 'image' | 'link';

/**
 * Put the item on the clipboard: text for notes, the image itself for images,
 * a download link for other public files.
 */
export async function copyItem(item: Item): Promise<CopyResult> {
  const view = viewOf(item);
  if (item.category === 'note') {
    await navigator.clipboard.writeText(view.content);
    return 'text';
  }
  if (item.category === 'image' && 'ClipboardItem' in window) {
    // Safari needs the ClipboardItem built synchronously inside the click, with a promise for the data.
    const png = itemBlob(item).then(toPngBlob);
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      return 'image';
    } catch (err) {
      if (item.isSecret) throw err;
      // Formats the browser cannot re-encode (HEIC on Chrome) fall through to the link.
    }
  }
  if (item.isSecret) throw new Error('Hidden files have no shareable link');
  if (!item.downloadURL) throw new Error('No link');
  await navigator.clipboard.writeText(item.downloadURL);
  return 'link';
}
