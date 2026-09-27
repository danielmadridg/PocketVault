import { $, html, setHTML } from '../lib/dom';
import { formatBytes } from '../lib/format';
import { icon } from '../lib/icons';
import { deleteShared, peekShared, type SharedPayload } from '../lib/share-inbox';
import { saveNote, uploadFiles } from './actions';
import { toastError } from './toast';

/** A share older than this was not just sent from this device's share sheet. */
const MAX_AGE_MS = 10 * 60_000;

function ask(payloads: SharedPayload[]): Promise<boolean> {
  const dialog = $<HTMLDialogElement>('#share-dialog');
  const rows = payloads.flatMap((p) => [
    ...p.files.map((f) => html`<li>${icon('file', 16)}<span class="share-name" title="${f.name}">${f.name}</span><span class="share-size">${formatBytes(f.size)}</span></li>`),
    ...(p.text ? [html`<li>${icon('note', 16)}<span class="share-text">${p.text}</span></li>`] : []),
  ]);
  setHTML($('#share-list'), html`${rows}`);
  dialog.returnValue = '';
  // Keys held down on the page that navigated here must not be able to confirm the save.
  const save = dialog.querySelector<HTMLButtonElement>('button[value="save"]')!;
  save.disabled = true;
  dialog.showModal();
  setTimeout(() => (save.disabled = false), 700);
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'save'), { once: true }));
}

/**
 * Files and text shared from Android's share sheet, parked by the service worker.
 * Nothing is saved without an explicit "Guardar": any website can POST to /share,
 * so the inbox must never write into the vault on its own.
 */
export async function reviewSharedInbox() {
  const params = new URLSearchParams(location.search);
  const arrived = params.has('shared');
  if (arrived) history.replaceState(null, '', '/');
  if (params.get('shared') === 'too-large') {
    toastError('Lo que compartiste pesa más de 300 MB y no se ha guardado.');
    return;
  }
  try {
    const all = await peekShared();
    const now = Date.now();
    const stale = all.filter((p) => now - p.receivedAt > MAX_AGE_MS);
    const fresh = all.filter((p) => !stale.includes(p));
    if (stale.length) await deleteShared(stale.map((p) => p.id));
    if (!fresh.length) return;

    const save = await ask(fresh);
    // Removed only after the decision, so a reload while the dialog is open loses nothing.
    await deleteShared(fresh.map((p) => p.id));
    if (!save) return;
    for (const payload of fresh) {
      if (payload.files.length) uploadFiles(payload.files, false);
      if (payload.text) await saveNote(payload.text, false, { undo: true });
    }
  } catch (err) {
    console.error('Share inbox failed', err);
    // Only worth telling the user when they actually came from the share sheet.
    if (arrived) toastError('No se pudo recoger lo compartido. Vuelve a compartirlo.');
  }
}
