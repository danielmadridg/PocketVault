import { DAY_MS } from '../config';
import { extensionOf, kindOf } from '../lib/category';
import { html, setHTML, type Raw } from '../lib/dom';
import { ageShort, expiryText, formatBytes, fullDate, lifeLeft, timeLeftShort } from '../lib/format';
import { icon } from '../lib/icons';
import { singleUrl } from '../lib/links';
import type { View } from '../services/content';
import type { Item, Upload } from '../types';

function body(item: Item, view: View): Raw {
  if (view.sealed) {
    return html`<div class="card-glyph">${icon('lock', 28)}<span class="card-glyph-label">Cifrado</span></div>`;
  }
  if (item.category === 'note') {
    const url = singleUrl(view.content);
    if (url) {
      const path = `${url.pathname === '/' ? '' : url.pathname}${url.search}`;
      return html`<div class="card-link"><span class="card-link-host">${url.hostname.replace(/^www\./, '')}</span>${path ? html`<span class="card-link-path">${path}</span>` : ''}</div>`;
    }
    return html`<p class="card-clip">${view.content.slice(0, 700)}</p>`;
  }
  if (view.thumbnail) {
    return html`<img src="${view.thumbnail}" alt="" decoding="async" loading="lazy" draggable="false">${
      item.category === 'video' ? html`<span class="card-badge">${icon('video', 14)}</span>` : ''
    }`;
  }
  const kind = kindOf(item.category, view.name);
  const ext = extensionOf(view.name);
  return html`<div class="card-glyph">${icon(kind.icon, 28)}${ext && ext.length <= 5 ? html`<span class="card-glyph-label">.${ext}</span>` : ''}</div>`;
}

/** Files show name and size. A plain note already shows its text, so the foot gives its length instead. */
function foot(item: Item, view: View, isLink: boolean): Raw {
  if (item.category !== 'note') {
    return html`<span class="card-name" title="${view.name}">${view.name}</span><span class="card-size">${formatBytes(item.size)}</span>`;
  }
  if (isLink || view.sealed) return html`<span class="card-name" title="${view.content || view.name}">${view.content || view.name}</span>`;
  const chars = view.content.length;
  return html`<span class="card-size">${chars.toLocaleString('es-ES')} ${chars === 1 ? 'carácter' : 'caracteres'}</span>`;
}

/** Everything that changes the card's markup. Age and fuse are patched separately. */
export function itemSignature(item: Item, view: View): string {
  return [
    view.name,
    view.sealed,
    item.isFavorite,
    item.category,
    item.size,
    view.thumbnail?.length ?? 0,
    item.category === 'note' ? view.content.slice(0, 700) : '',
    view.content.length,
  ].join('\u0001');
}

export function renderItemCard(el: HTMLElement, item: Item, view: View) {
  const isLink = item.category === 'note' && !view.sealed && singleUrl(view.content) !== null;
  // The head names the category; the file extension, when there is one, sits on the glyph.
  const kind = view.sealed ? { label: 'Oculto', icon: 'lock' as const } : kindOf(item.category, '', isLink);
  const pinned = item.isFavorite;
  const uploaded = item.uploadedAt.toMillis();
  const hasFile = item.category !== 'note';

  el.className = 'card';
  el.classList.toggle('is-sealed', view.sealed);
  el.dataset.id = item.id;
  el.tabIndex = 0;
  el.setAttribute('aria-label', `${kind.label}: ${view.name}`);

  setHTML(
    el,
    html`<div class="card-head">
        <span class="card-kind">${icon(kind.icon, 14)}${kind.label}</span>
        ${pinned ? html`<span class="card-pin" title="Fijado: no caduca">${icon('pin', 13)}</span>` : ''}
        <time class="card-age" datetime="${new Date(uploaded).toISOString()}" title="Subido el ${fullDate(uploaded)}"></time>
      </div>
      <div class="card-body">${body(item, view)}</div>
      <div class="card-foot">${foot(item, view, isLink)}</div>
      <div class="card-actions" role="group" aria-label="Acciones">
        ${view.sealed ? '' : html`<button type="button" class="card-action" data-action="copy" title="Copiar" aria-label="Copiar">${icon('copy', 15)}</button>`}
        ${hasFile && !view.sealed ? html`<button type="button" class="card-action" data-action="download" title="Descargar" aria-label="Descargar">${icon('download', 15)}</button>` : ''}
        <button type="button" class="card-action${pinned ? ' is-on' : ''}" data-action="pin" aria-pressed="${pinned}" title="${pinned ? 'Soltar: volverá a caducar en 7 días' : 'Fijar: no caducará'}" aria-label="${pinned ? 'Soltar' : 'Fijar'}">${icon('pin', 15)}</button>
        <button type="button" class="card-action is-danger" data-action="delete" title="Borrar" aria-label="Borrar">${icon('trash', 15)}</button>
      </div>
      ${pinned ? '' : html`<span class="card-fuse" aria-hidden="true"></span>`}`,
  );
  updateItemTime(el, item);
}

/** Refresh the age label and the fuse without rebuilding the card. */
export function updateItemTime(el: HTMLElement, item: Item, now = Date.now()) {
  const age = el.querySelector('.card-age');
  const expires = item.expiresAt.toMillis();
  const urgent = !item.isFavorite && expires - now < DAY_MS;
  // On its last day a card stops saying how old it is and says how long it has left.
  if (age) age.textContent = urgent ? timeLeftShort(expires, now) : ageShort(item.uploadedAt.toMillis(), now);
  el.classList.toggle('is-urgent', urgent);
  if (item.isFavorite) return;
  el.style.setProperty('--life', lifeLeft(expires, now).toFixed(4));
  el.querySelector('.card-fuse')?.setAttribute('title', expiryText(expires, now));
}

const STATUS: Record<Upload['state'], string> = {
  queued: 'En cola',
  uploading: 'Subiendo',
  saving: 'Guardando',
  error: 'Error',
};

export function uploadSignature(upload: Upload): string {
  return [upload.state, upload.error ?? ''].join('\u0001');
}

export function renderUploadCard(el: HTMLElement, upload: Upload, previewURL: string | null) {
  const kind = kindOf(upload.category, '');
  const failed = upload.state === 'error';
  el.className = `card is-upload${failed ? ' is-failed' : ''}`;
  el.dataset.upload = upload.id;
  el.removeAttribute('tabindex');

  setHTML(
    el,
    html`<div class="card-head">
        <span class="card-kind">${icon(upload.secret ? 'lock' : kind.icon, 14)}${kind.label}</span>
        <span class="card-age">${STATUS[upload.state]}</span>
      </div>
      <div class="card-body">
        ${previewURL ? html`<img src="${previewURL}" alt="" decoding="async" draggable="false">` : html`<div class="card-glyph">${icon(kind.icon, 28)}</div>`}
        <span class="card-status">${failed ? upload.error : ''}</span>
      </div>
      <div class="card-foot">
        <span class="card-name" title="${upload.name}">${upload.name}</span>
        <span class="card-size">${formatBytes(upload.file.size)}</span>
      </div>
      <div class="card-actions" role="group" aria-label="Acciones de la subida">
        ${failed ? html`<button type="button" class="card-action" data-action="retry" title="Reintentar" aria-label="Reintentar">${icon('retry', 15)}</button>` : ''}
        <button type="button" class="card-action is-danger" data-action="cancel" title="${failed ? 'Descartar' : 'Cancelar'}" aria-label="${failed ? 'Descartar' : 'Cancelar'}">${icon('x', 15)}</button>
      </div>
      <span class="card-fuse" aria-hidden="true"></span>`,
  );
  updateUploadProgress(el, upload);
}

export function updateUploadProgress(el: HTMLElement, upload: Upload) {
  el.style.setProperty('--progress', upload.progress.toFixed(3));
  if (upload.state === 'uploading') {
    const status = el.querySelector('.card-status');
    if (status) status.textContent = `${Math.round(upload.progress * 100)} %`;
  }
}

export function skeletonCard(): Raw {
  return html`<div class="card is-skeleton" aria-hidden="true">
    <div class="card-head"><span class="skeleton-line is-short"></span></div>
    <div class="card-body"></div>
    <div class="card-foot"><span class="skeleton-line is-long"></span></div>
  </div>`;
}
