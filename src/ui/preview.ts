import { DAY_MS } from '../config';
import { isTextPreviewable, kindOf } from '../lib/category';
import { DEVICE_ID } from '../lib/device';
import { $, html, MOD_LABEL, setHTML, type Raw } from '../lib/dom';
import { expiryText, formatBytes, fullDate } from '../lib/format';
import { icon } from '../lib/icons';
import { linkify, singleUrl } from '../lib/links';
import { itemBlob, viewOf, type View } from '../services/content';
import { updateNote } from '../services/items';
import { getState, subscribe } from '../store';
import type { Item } from '../types';
import { copy, deleteWithUndo, download, togglePin } from './actions';
import { reducedMotion, slideIn } from './motion';
import { visibleItems } from './selectors';
import { toastError } from './toast';

const dialog = () => $<HTMLDialogElement>('#preview');

let currentId: string | null = null;
let editing = false;
let objectURL: string | null = null;
let renderToken = 0;
let pushedHistory = false;
let unsubscribe: (() => void) | null = null;
let lastStageKey = '';
let lastSideKey = '';

function current(): Item | undefined {
  return currentId ? getState().items.find((i) => i.id === currentId) : undefined;
}

function navList(): Item[] {
  const state = getState();
  return visibleItems(state).filter((i) => !viewOf(i, state.revealed).sealed);
}

function releaseObjectURL() {
  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = null;
}

function copyLabel(item: Item): string {
  if (item.category === 'note') return 'Copiar texto';
  if (item.category === 'image') return 'Copiar imagen';
  return 'Copiar enlace';
}

function actions(item: Item, view: View): Raw {
  if (editing) {
    return html`<div class="preview-actions">
      <button type="button" class="btn btn-primary" data-act="save">${icon('check')}<span class="btn-label">Guardar cambios</span><kbd class="kbd-on-accent">${MOD_LABEL} ↵</kbd></button>
      <button type="button" class="btn btn-secondary" data-act="cancel-edit">${icon('x')}<span class="btn-label">Descartar cambios</span><kbd>Esc</kbd></button>
    </div>`;
  }
  const isFile = item.category !== 'note';
  const canCopy = !(item.isSecret && isFile && item.category !== 'image');
  const url = item.category === 'note' ? singleUrl(view.content) : null;
  return html`<div class="preview-actions">
    ${canCopy ? html`<button type="button" class="btn btn-primary" data-act="copy">${icon('copy')}<span class="btn-label">${copyLabel(item)}</span><kbd class="kbd-on-accent">${MOD_LABEL} C</kbd></button>` : ''}
    ${isFile ? html`<button type="button" class="btn ${canCopy ? 'btn-secondary' : 'btn-primary'}" data-act="download">${icon('download')}<span class="btn-label">Descargar</span><kbd${canCopy ? '' : html` class="kbd-on-accent"`}>D</kbd></button>` : ''}
    ${isFile && !item.isSecret && item.downloadURL ? html`<a class="btn btn-secondary" href="${item.downloadURL}" target="_blank" rel="noopener noreferrer">${icon('external')}<span class="btn-label">Abrir en otra pestaña</span></a>` : ''}
    ${url ? html`<a class="btn btn-secondary" href="${url.href}" target="_blank" rel="noopener noreferrer">${icon('external')}<span class="btn-label">Abrir enlace</span></a>` : ''}
    ${item.category === 'note' ? html`<button type="button" class="btn btn-secondary" data-act="edit">${icon('pencil')}<span class="btn-label">Editar</span><kbd>E</kbd></button>` : ''}
    <button type="button" class="btn btn-secondary" data-act="pin" aria-pressed="${item.isFavorite}">${icon('pin')}<span class="btn-label">${item.isFavorite ? 'Soltar' : 'Fijar'}</span><kbd>P</kbd></button>
    <button type="button" class="btn btn-danger" data-act="delete">${icon('trash')}<span class="btn-label">Borrar</span><kbd>Supr</kbd></button>
  </div>`;
}

function facts(item: Item, view: View): Raw {
  const kind = kindOf(item.category, view.name, item.category === 'note' && singleUrl(view.content) !== null);
  const expires = item.expiresAt.toMillis();
  const urgent = !item.isFavorite && expires - Date.now() < DAY_MS;
  return html`<dl class="facts">
    <dt>Tipo</dt><dd>${kind.label}${view.type && item.category !== 'note' ? html` <span class="facts-mime">(${view.type})</span>` : ''}</dd>
    ${item.category !== 'note' ? html`<dt>Tamaño</dt><dd>${formatBytes(item.size)}</dd>` : html`<dt>Longitud</dt><dd>${view.content.length.toLocaleString('es-ES')} caracteres</dd>`}
    <dt>Guardado</dt><dd>${fullDate(item.uploadedAt.toMillis())}</dd>
    <dt>Caduca</dt><dd class="${urgent ? 'is-urgent' : ''}">${item.isFavorite ? 'Nunca: está fijado' : expiryText(expires)}</dd>
    ${item.device ? html`<dt>Desde</dt><dd>${item.device === DEVICE_ID ? 'Este dispositivo' : 'Otro dispositivo'}</dd>` : ''}
    ${item.isSecret && item.sealed ? html`<dt>Cifrado</dt><dd>AES-256 en tu dispositivo</dd>` : ''}
  </dl>`;
}

async function fillStage(stage: HTMLElement, item: Item, view: View, token: number) {
  const stale = () => token !== renderToken;
  const loading = (text = 'Cargando…') => setHTML(stage, html`<p class="preview-loading">${text}</p>`);

  if (item.category === 'note') {
    if (editing) {
      setHTML(stage, html`<textarea class="preview-editor" aria-label="Texto de la nota" spellcheck="false">${view.content}</textarea>`);
      const area = stage.querySelector('textarea')!;
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    } else {
      setHTML(stage, html`<div class="preview-text">${linkify(view.content)}</div>`);
    }
    return;
  }

  // Public files stream straight from Storage; hidden ones must be fetched and decrypted first.
  const sourceURL = async (): Promise<string | null> => {
    if (!item.isSecret || !item.fileIv) return item.downloadURL!;
    const blob = await itemBlob(item);
    // A late answer for an item the user already left must not touch the current one.
    if (stale()) return null;
    releaseObjectURL();
    objectURL = URL.createObjectURL(blob);
    return objectURL;
  };

  try {
    if (item.category === 'image') {
      if (view.thumbnail) setHTML(stage, html`<img src="${view.thumbnail}" alt="${view.name}">`);
      else loading();
      const src = await sourceURL();
      if (!src) return;
      const full = new Image();
      full.src = src;
      full.alt = view.name;
      await full.decode();
      if (!stale()) stage.replaceChildren(full);
    } else if (item.category === 'video') {
      if (item.isSecret) loading('Descifrando…');
      const src = await sourceURL();
      if (!src || stale()) return;
      setHTML(stage, html`<video src="${src}" controls playsinline preload="metadata" ${view.thumbnail ? html`poster="${view.thumbnail}"` : ''}></video>`);
    } else if (item.category === 'audio') {
      const src = await sourceURL();
      if (!src || stale()) return;
      setHTML(stage, html`<audio src="${src}" controls preload="metadata"></audio>`);
    } else if (isTextPreviewable(view.type, view.name, item.size)) {
      loading();
      const text = await (await itemBlob(item)).text();
      if (!stale()) setHTML(stage, html`<div class="preview-text">${text}</div>`);
    } else {
      const kind = kindOf(item.category, view.name);
      setHTML(
        stage,
        html`<div class="preview-file">${icon(kind.icon, 48)}<p>No hay vista previa para este tipo de archivo. Descárgalo${item.isSecret ? '' : ' o ábrelo en otra pestaña'}.</p></div>`,
      );
    }
  } catch (err) {
    console.error('Preview failed', err);
    if (!stale()) setHTML(stage, html`<div class="preview-file">${icon('x', 32)}<p>No se pudo cargar. Comprueba la conexión y vuelve a probar.</p></div>`);
  }
}

function render(force = false) {
  const item = current();
  const el = dialog();
  const view = item ? viewOf(item) : null;
  // Still decrypting a note that is being edited (e.g. just re-encrypted): keep the editor as is.
  if (item && view?.sealed && editing && getState().vault === 'unlocked') return;
  // Gone (deleted elsewhere) or sealed again (the vault locked): nothing left to show.
  if (!item || !view || view.sealed) {
    if (el.open) el.close();
    return;
  }
  // The stage (media, text) is only rebuilt when what it shows changes; pinning just refreshes the side panel.
  // While editing, a change from another device must not rebuild the textarea and wipe the edit.
  const stageKey = editing
    ? `${item.id}\u0001editing`
    : [item.id, view.name, item.category === 'note' ? view.content : '', view.thumbnail?.length ?? 0].join('\u0001');
  const sideKey = `${stageKey}\u0001${item.isFavorite}\u0001${item.expiresAt.toMillis()}`;
  if (!force && sideKey === lastSideKey) return;
  const stageChanged = force || stageKey !== lastStageKey || !el.querySelector('.preview-stage');
  lastStageKey = stageKey;
  lastSideKey = sideKey;

  const kind = kindOf(item.category, view.name, item.category === 'note' && singleUrl(view.content) !== null);
  const list = navList();
  const index = list.findIndex((i) => i.id === item.id);

  const side = html`<aside class="preview-side">
    ${actions(item, view)}
    ${facts(item, view)}
    <p class="preview-hint">← → para moverte. Esc para cerrar.</p>
  </aside>`;

  if (!stageChanged && el.querySelector('.preview-stage')) {
    el.querySelector('.preview-side')!.outerHTML = side.value;
    if (el.open && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    return;
  }

  renderToken++;
  releaseObjectURL();
  el.classList.toggle('is-note', item.category === 'note');
  setHTML(
    el,
    html`<header class="preview-head">
      <span class="preview-kind">${icon(kind.icon, 14)}${kind.label}</span>
      <h2 class="preview-title" id="preview-title" title="${view.name}">${view.name}</h2>
      <div class="preview-nav">
        <button type="button" class="btn btn-ghost btn-icon" data-nav="-1" aria-label="Anterior" title="Anterior" ${index <= 0 ? 'disabled' : ''}>${icon('chevronLeft')}</button>
        <button type="button" class="btn btn-ghost btn-icon" data-nav="1" aria-label="Siguiente" title="Siguiente" ${index < 0 || index >= list.length - 1 ? 'disabled' : ''}>${icon('chevronRight')}</button>
        <button type="button" class="btn btn-ghost btn-icon" data-act="close" aria-label="Cerrar" title="Cerrar">${icon('x')}</button>
      </div>
    </header>
    <div class="preview-stage"></div>
    ${side}`,
  );
  void fillStage(el.querySelector<HTMLElement>('.preview-stage')!, item, view, renderToken);
  // Rebuilding the content drops focus to <body>; keep it in the dialog so shortcuts keep working.
  if (el.open && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
}

function go(step: number) {
  const list = navList();
  const index = list.findIndex((i) => i.id === currentId);
  const next = list[index + step];
  const el = dialog();
  if (!next) {
    if (reducedMotion()) return;
    // At either end: a small rubber-band nudge instead of nothing.
    el.querySelector('.preview-stage')?.animate(
      [{ transform: 'none' }, { transform: `translateX(${-step * 14}px)` }, { transform: 'none' }],
      { duration: 280, easing: 'ease-out' },
    );
    return;
  }
  currentId = next.id;
  editing = false;
  render(true);
  const direction = step > 0 ? 'forward' : 'back';
  const stage = el.querySelector('.preview-stage');
  if (stage) slideIn(stage, direction, 48);
  const title = el.querySelector('.preview-title');
  if (title) slideIn(title, direction, 10);
}

async function saveEdit() {
  const item = current();
  const area = dialog().querySelector<HTMLTextAreaElement>('.preview-editor');
  const uid = getState().user?.uid;
  if (!item || !area || !uid) return;
  const text = area.value;
  if (!text.trim()) return toastError('Una nota no puede quedarse vacía. Bórrala si ya no la quieres.');
  try {
    await updateNote(uid, item, text);
    editing = false;
    render(true);
  } catch (err) {
    console.error('Edit failed', err);
    toastError('No se pudo guardar la nota.');
  }
}

function act(name: string, button: HTMLElement | null) {
  const item = current();
  if (name === 'close') return dialog().close();
  if (!item) return;
  if (name === 'copy') void copy(item, button);
  else if (name === 'download') void download(item, button);
  else if (name === 'pin') togglePin(item);
  else if (name === 'edit') {
    editing = true;
    render(true);
  } else if (name === 'save') void saveEdit();
  else if (name === 'cancel-edit') {
    editing = false;
    render(true);
  } else if (name === 'delete') {
    const list = navList();
    const neighbour = list[list.findIndex((i) => i.id === item.id) + 1] ?? list[list.findIndex((i) => i.id === item.id) - 1];
    deleteWithUndo(item);
    if (neighbour) {
      currentId = neighbour.id;
      render(true);
    } else {
      dialog().close();
    }
  }
}

function onKeydown(event: KeyboardEvent) {
  const mod = event.ctrlKey || event.metaKey;
  if (editing) {
    if (mod && event.key === 'Enter') {
      event.preventDefault();
      void saveEdit();
    }
    return;
  }
  if ((event.target as HTMLElement).closest('video, audio')) return;
  const key = event.key.toLowerCase();
  const button = (name: string) => dialog().querySelector<HTMLElement>(`[data-act="${name}"]`);
  if (event.key === 'ArrowLeft') go(-1);
  else if (event.key === 'ArrowRight') go(1);
  else if (mod && key === 'c' && !getSelection()?.toString()) {
    event.preventDefault();
    if (button('copy')) act('copy', button('copy'));
  } else if (mod || event.altKey) return;
  else if (key === 'd' && button('download')) act('download', button('download'));
  else if (key === 'p') act('pin', null);
  else if (key === 'e' && button('edit')) act('edit', null);
  else if (event.key === 'Delete') act('delete', null);
  else return;
  event.preventDefault();
}

/** Make the dialog grow out of the card that opened it (transform-origin at the card's centre). */
function aimAt(el: HTMLDialogElement, id: string) {
  const card = document.querySelector<HTMLElement>(`#library .card[data-id="${CSS.escape(id)}"]`);
  if (!card) {
    el.style.removeProperty('--origin-x');
    el.style.removeProperty('--origin-y');
    return;
  }
  const r = card.getBoundingClientRect();
  const w = Math.min(1120, innerWidth - 48);
  const h = Math.min(760, innerHeight - 48);
  el.style.setProperty('--origin-x', `${r.left + r.width / 2 - (innerWidth - w) / 2}px`);
  el.style.setProperty('--origin-y', `${r.top + r.height / 2 - (innerHeight - h) / 2}px`);
}

export function openPreview(id: string) {
  const el = dialog();
  currentId = id;
  editing = false;
  lastStageKey = '';
  lastSideKey = '';
  render(true);
  if (!el.open) {
    aimAt(el, id);
    // Deal the side panel in once: only the panel built by this opening render animates.
    el.querySelector('.preview-side')?.classList.add('is-dealt');
    el.showModal();
    if (!pushedHistory) {
      history.pushState({ pvPreview: true }, '');
      pushedHistory = true;
    }
  }
  unsubscribe ??= subscribe((_, changed) => {
    if (changed.has('items') || changed.has('revealed') || changed.has('pendingDelete')) {
      if (current() && getState().pendingDelete.has(currentId!)) return;
      render();
    }
  });
}

export function initPreview() {
  const el = dialog();
  el.addEventListener('click', (event) => {
    if (event.target === el) return el.close();
    const target = event.target as HTMLElement;
    const nav = target.closest<HTMLElement>('[data-nav]');
    if (nav) return go(Number(nav.dataset.nav));
    const button = target.closest<HTMLElement>('[data-act]');
    if (button) act(button.dataset.act!, button);
  });
  el.addEventListener('keydown', onKeydown);
  el.addEventListener('cancel', (event) => {
    // Esc while editing discards the edit instead of closing everything.
    if (editing) {
      event.preventDefault();
      editing = false;
      render(true);
    }
  });
  el.addEventListener('close', () => {
    renderToken++;
    el.querySelectorAll('video, audio').forEach((m) => (m as HTMLMediaElement).pause());
    // The exit transition still shows the content: clear it (and free the blob) afterwards.
    const leftover = objectURL;
    objectURL = null;
    setTimeout(() => {
      if (leftover) URL.revokeObjectURL(leftover);
      if (!el.open) el.replaceChildren();
    }, 320);
    unsubscribe?.();
    unsubscribe = null;
    const id = currentId;
    currentId = null;
    lastStageKey = '';
    lastSideKey = '';
    if (pushedHistory) {
      pushedHistory = false;
      history.back();
    }
    // Return focus to the card that opened the preview.
    if (id) document.querySelector<HTMLElement>(`#library .card[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: false });
  });
  // Android back button / browser back closes the preview instead of leaving the app.
  window.addEventListener('popstate', () => {
    if (el.open) {
      pushedHistory = false;
      el.close();
    }
  });
}
