import { $, html, IS_APPLE, MOD_LABEL, setHTML, type Raw } from '../lib/dom';
import { icon } from '../lib/icons';
import { viewOf } from '../services/content';
import { cancelUpload, retryUpload } from '../services/upload';
import { changeVaultPassword, lockVault, setupVault, unlockVault, VaultError } from '../services/vault';
import { getState, subscribe, type State, type StateKey } from '../store';
import type { Item, Tab, Upload } from '../types';
import { copy, deleteWithUndo, download, togglePin } from './actions';
import { itemSignature, renderItemCard, renderUploadCard, skeletonCard, updateItemTime, updateUploadProgress, uploadSignature } from './card';
import { openPreview } from './preview';
import { visibleItems, visibleUploads } from './selectors';
import { toast } from './toast';

const RELEVANT: StateKey[] = ['items', 'itemsLoaded', 'uploads', 'tab', 'query', 'vault', 'revealed', 'pendingDelete', 'online'];

const root = () => $('#library');

/** Card elements are kept across renders and tab switches; only changed ones are rebuilt. */
const itemCards = new Map<string, { el: HTMLElement; sig: string }>();
const uploadCards = new Map<string, { el: HTMLElement; sig: string; preview: string | null }>();
const blocks = new Map<string, HTMLElement>();
let knownIds: Set<string> | null = null;
let vaultMode: 'default' | 'change' = 'default';
let lastScreen = '';

/** Make `parent`'s children exactly `wanted`, moving only nodes that are out of place (keeps focus). */
function reconcile(parent: Element, wanted: Element[]) {
  wanted.forEach((el, i) => {
    if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] ?? null);
  });
  while (parent.children.length > wanted.length) parent.lastElementChild!.remove();
}

function block(key: string, create: () => HTMLElement): HTMLElement {
  let el = blocks.get(key);
  if (!el) {
    el = create();
    blocks.set(key, el);
  }
  return el;
}

function group(key: string, title: string | null, count: number): { el: HTMLElement; grid: HTMLElement } {
  const el = block(`group:${key}`, () => {
    const g = document.createElement('section');
    g.className = 'group';
    g.innerHTML = '<h2 class="group-head"></h2><div class="grid"></div>';
    return g;
  });
  const head = el.querySelector<HTMLElement>('.group-head')!;
  head.hidden = title === null;
  if (title !== null) setHTML(head, html`${title}<span class="group-count">${count}</span>`);
  return { el, grid: el.querySelector<HTMLElement>('.grid')! };
}

function itemCard(item: Item, state: State): HTMLElement {
  const view = viewOf(item, state.revealed);
  const sig = itemSignature(item, view);
  let entry = itemCards.get(item.id);
  if (!entry) {
    const el = document.createElement('article');
    entry = { el, sig: '' };
    itemCards.set(item.id, entry);
    // Anything that appears after the first render is a fresh deposit.
    if (knownIds && !knownIds.has(item.id)) {
      el.classList.add('is-new');
      el.addEventListener('animationend', (e) => e.animationName === 'glow-out' && el.classList.remove('is-new'));
    }
  }
  if (entry.sig !== sig) {
    const isNew = entry.el.classList.contains('is-new');
    renderItemCard(entry.el, item, view);
    if (isNew) entry.el.classList.add('is-new');
    entry.sig = sig;
  } else {
    updateItemTime(entry.el, item);
  }
  return entry.el;
}

function uploadCard(upload: Upload): HTMLElement {
  let entry = uploadCards.get(upload.id);
  if (!entry) {
    const previewable = upload.file.type.startsWith('image/') && upload.file.size < 25 * 1024 * 1024;
    entry = { el: document.createElement('article'), sig: '', preview: previewable ? URL.createObjectURL(upload.file) : null };
    uploadCards.set(upload.id, entry);
  }
  const sig = uploadSignature(upload);
  if (entry.sig !== sig) {
    renderUploadCard(entry.el, upload, entry.preview);
    entry.sig = sig;
  } else {
    updateUploadProgress(entry.el, upload);
  }
  return entry.el;
}

function prune(state: State) {
  // With the vault closed, decrypted hidden cards are dropped, not just hidden: no plaintext left in the DOM.
  const keep = new Set(state.items.filter((i) => state.vault === 'unlocked' || !i.isSecret).map((i) => i.id));
  for (const [id, entry] of itemCards) if (!keep.has(id)) (entry.el.remove(), itemCards.delete(id));
  const uploadIds = new Set(state.uploads.map((u) => u.id));
  for (const [id, entry] of uploadCards) {
    if (uploadIds.has(id)) continue;
    entry.el.remove();
    if (entry.preview) URL.revokeObjectURL(entry.preview);
    uploadCards.delete(id);
  }
}

// ─── Empty states and panels ─────────────────────────────────

const coarse = matchMedia('(pointer: coarse)');

const EMPTY: Record<Exclude<Tab, 'all'>, [string, string]> = {
  pinned: ['Nada fijado', 'Lo fijado no caduca. Usa la chincheta de cualquier elemento para conservarlo.'],
  images: ['Sin imágenes', 'Haz una captura, pulsa Ctrl+V aquí y aparecerá en esta pestaña.'],
  documents: ['Sin documentos', 'Arrastra un PDF, un Word o una hoja de cálculo a la ventana.'],
  videos: ['Sin vídeos', 'Caben vídeos de hasta 100 MB. Arrástralos a la ventana.'],
  notes: ['Sin notas', 'Escribe arriba o pega texto fuera del cuadro para guardarlo como nota.'],
  other: ['Nada más por aquí', 'Audios, comprimidos y cualquier otro tipo de archivo aparecen en esta pestaña.'],
  secret: ['La sección oculta está vacía', 'Con esta pestaña abierta, lo que pegues, sueltes o escribas se cifra antes de salir del dispositivo.'],
};

function emptyState(state: State): Raw {
  const query = state.query.trim();
  if (query) {
    return html`<div class="empty"><h2 class="empty-title">Nada coincide con «${query}»</h2><p class="empty-text">La búsqueda mira el nombre de los archivos y el texto de las notas.</p></div>`;
  }
  if (state.tab === 'all') {
    const how = coarse.matches
      ? html`Toca <strong>Pegar</strong> para guardar lo que tengas copiado, sube archivos o escribe una nota arriba.`
      : html`Pulsa <kbd>${MOD_LABEL}</kbd><kbd>V</kbd> en cualquier parte de esta página para guardar lo que tengas copiado, arrastra archivos a la ventana o escribe una nota arriba.`;
    return html`<div class="empty empty-lg"><h2 class="empty-title">Tu bóveda está vacía</h2><p class="empty-text">${how} Lo verás al momento en tus otros dispositivos, y se borrará solo en 7 días si no lo fijas.</p></div>`;
  }
  const [title, text] = EMPTY[state.tab];
  return html`<div class="empty"><h2 class="empty-title">${title}</h2><p class="empty-text">${IS_APPLE ? text.replace('Ctrl+V', '⌘V') : text}</p></div>`;
}

function hasLegacyPassword(state: State): boolean {
  try {
    return !!state.user && localStorage.getItem(`vault_secret_${state.user.uid}`) !== null;
  } catch {
    return false;
  }
}

function vaultPanel(state: State): Raw {
  if (state.vault === 'unreachable') {
    return html`<div class="empty"><h2 class="empty-title">No se pudo comprobar la sección oculta</h2><p class="empty-text">El servidor no responde. Se vuelve a intentar sola; si sigue así, revisa la conexión y recarga.</p></div>`;
  }
  if (state.vault === 'loading') {
    if (!state.online) {
      return html`<div class="empty"><h2 class="empty-title">Sin conexión</h2><p class="empty-text">La sección oculta necesita conectarse para saber si ya tiene contraseña. Vuelve a intentarlo cuando haya red.</p></div>`;
    }
    return html`<div class="grid">${skeletonCard()}${skeletonCard()}</div>`;
  }
  if (state.vault === 'absent') {
    // v1 allowed any length; a legacy password is accepted as is and can be changed later.
    const legacy = hasLegacyPassword(state);
    const min = legacy ? '' : html` minlength="8"`;
    return html`<form class="vault-panel" data-form="setup"${legacy ? html` data-legacy="1"` : ''}>
      <input type="text" class="sr-only" name="username" autocomplete="username" value="PocketVault: sección oculta" tabindex="-1" aria-hidden="true" readonly>
      <span class="vault-panel-icon">${icon('lock', 20)}</span>
      <h2>Protege la sección oculta</h2>
      <p>Elige una contraseña. Lo que guardes aquí se cifra en tu dispositivo antes de subirse: el servidor solo ve datos ilegibles. Si la olvidas, no hay forma de recuperarlo.</p>
      ${hasLegacyPassword(state) ? html`<p>Usa la misma contraseña que ya tenías para esta sección en este navegador.</p>` : ''}
      <label class="field"><span class="field-label">Contraseña</span><input type="password" name="password" autocomplete="new-password"${min} required></label>
      <label class="field"><span class="field-label">Repite la contraseña</span><input type="password" name="confirm" autocomplete="new-password"${min} required></label>
      <p class="form-message" role="alert" hidden></p>
      <div class="actions"><button type="submit" class="btn btn-primary">Crear y abrir</button></div>
    </form>`;
  }
  return html`<form class="vault-panel" data-form="unlock">
      <input type="text" class="sr-only" name="username" autocomplete="username" value="PocketVault: sección oculta" tabindex="-1" aria-hidden="true" readonly>
    <span class="vault-panel-icon">${icon('lock', 20)}</span>
    <h2>Sección oculta</h2>
    <p>Escribe la contraseña para descifrar lo que hay dentro. Se vuelve a cerrar si dejas la página 5 minutos en segundo plano.</p>
    <label class="field"><span class="field-label">Contraseña</span><input type="password" name="password" autocomplete="current-password" required></label>
    <p class="form-message" role="alert" hidden></p>
    <div class="actions"><button type="submit" class="btn btn-primary">Abrir</button></div>
  </form>`;
}

function changePasswordPanel(): Raw {
  return html`<form class="vault-panel" data-form="change">
      <input type="text" class="sr-only" name="username" autocomplete="username" value="PocketVault: sección oculta" tabindex="-1" aria-hidden="true" readonly>
    <span class="vault-panel-icon">${icon('key', 20)}</span>
    <h2>Cambiar contraseña</h2>
    <p>Lo que ya está guardado no se vuelve a cifrar: solo cambia la llave que lo abre.</p>
    <label class="field"><span class="field-label">Contraseña actual</span><input type="password" name="current" autocomplete="current-password" required></label>
    <label class="field"><span class="field-label">Nueva contraseña</span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
    <label class="field"><span class="field-label">Repite la nueva</span><input type="password" name="confirm" autocomplete="new-password" minlength="8" required></label>
    <p class="form-message" role="alert" hidden></p>
    <div class="actions"><button type="submit" class="btn btn-primary">Guardar contraseña</button><button type="button" class="btn btn-ghost" data-action="vault-cancel">Cancelar</button></div>
  </form>`;
}

function vaultBar(): HTMLElement {
  return block('vault-bar', () => {
    const el = document.createElement('div');
    el.className = 'vault-bar';
    setHTML(
      el,
      html`${icon('unlock', 16)}<p>Sección oculta abierta. Lo que pegues, sueltes o escribas ahora se cifra en este dispositivo.</p>
        <button type="button" class="btn btn-ghost" data-action="vault-change">Cambiar contraseña</button>
        <button type="button" class="btn btn-ghost" data-action="vault-lock">${icon('lock', 15)}Cerrar</button>`,
    );
    return el;
  });
}

let focusAfterRender: HTMLElement | null = null;

/** Static screens (panels, empty states) are rebuilt only when their content changes. */
function staticScreen(key: string, content: Raw) {
  const el = block('static', () => document.createElement('div'));
  if (lastScreen !== key) {
    setHTML(el, content);
    lastScreen = key;
    // Focus only once the panel is in the document (after reconcile), or it silently fails.
    focusAfterRender = el.querySelector<HTMLInputElement>('input[type="password"]');
  }
  return el;
}

function commit(lib: HTMLElement, out: HTMLElement[]) {
  reconcile(lib, out);
  focusAfterRender?.focus({ preventScroll: true });
  focusAfterRender = null;
}

// ─── Render ──────────────────────────────────────────────────

function render(state: State) {
  const lib = root();
  lib.setAttribute('aria-busy', String(!state.itemsLoaded));
  prune(state);

  if (!state.itemsLoaded) {
    lastScreen = '';
    const el = block('skeleton', () => {
      const s = document.createElement('div');
      s.className = 'grid';
      setHTML(s, html`${Array.from({ length: 8 }, skeletonCard)}`);
      return s;
    });
    reconcile(lib, [el]);
    return;
  }

  // First real render: everything already stored is "known", not new.
  knownIds ??= new Set(state.items.map((i) => i.id));

  const out: HTMLElement[] = [];
  if (state.tab === 'secret') {
    if (state.vault !== 'unlocked') {
      vaultMode = 'default';
      out.push(staticScreen(`vault:${state.vault}${state.vault === 'loading' ? `:${state.online}` : ''}`, vaultPanel(state)));
      commit(lib, out);
      return;
    }
    if (vaultMode === 'change') {
      out.push(staticScreen('vault:change', changePasswordPanel()));
      commit(lib, out);
      return;
    }
    out.push(vaultBar());
  }

  const items = visibleItems(state);
  const uploads = visibleUploads(state);

  if (!items.length && !uploads.length) {
    out.push(staticScreen(`empty:${state.tab}:${state.query.trim()}`, emptyState(state)));
  } else {
    lastScreen = '';
    const uploadEls = uploads.map(uploadCard);
    const searching = state.query.trim() !== '';
    const pinned = state.tab === 'all' && !searching ? items.filter((i) => i.isFavorite) : [];

    if (pinned.length) {
      const rest = items.filter((i) => !i.isFavorite);
      const g1 = group('pinned', 'Fijados', pinned.length);
      reconcile(g1.grid, pinned.map((i) => itemCard(i, state)));
      out.push(g1.el);
      const g2 = group('recent', 'Recientes', rest.length + uploads.length);
      reconcile(g2.grid, [...uploadEls, ...rest.map((i) => itemCard(i, state))]);
      if (rest.length || uploads.length) out.push(g2.el);
    } else {
      const g = group('main', searching ? 'Resultados' : null, items.length);
      reconcile(g.grid, [...uploadEls, ...items.map((i) => itemCard(i, state))]);
      out.push(g.el);
    }
  }

  commit(lib, out);
  for (const item of state.items) knownIds.add(item.id);
}

// ─── Events ──────────────────────────────────────────────────

function itemById(id: string | undefined): Item | undefined {
  return id ? getState().items.find((i) => i.id === id) : undefined;
}

function formMessage(form: HTMLFormElement, text: string) {
  const msg = form.querySelector<HTMLElement>('.form-message')!;
  msg.textContent = text;
  msg.hidden = !text;
}

async function onVaultSubmit(form: HTMLFormElement) {
  const data = new FormData(form);
  const password = String(data.get('password') ?? '');
  const confirm = String(data.get('confirm') ?? '');
  const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const kind = form.dataset.form;

  const legacySetup = kind === 'setup' && form.dataset.legacy === '1';
  if (kind !== 'unlock' && !legacySetup && password.length < 8) return formMessage(form, 'Usa al menos 8 caracteres.');
  if (kind !== 'unlock' && password !== confirm) return formMessage(form, 'Las dos contraseñas no coinciden.');

  const label = button.textContent;
  button.disabled = true;
  button.textContent = kind === 'unlock' ? 'Abriendo…' : 'Cifrando…';
  formMessage(form, '');
  try {
    if (kind === 'setup') {
      await setupVault(password);
      if (password.length < 8) toast('Tu contraseña de siempre es corta. Cámbiala por una de 8 caracteres o más desde la barra de la sección oculta.');
    }
    else if (kind === 'unlock') await unlockVault(password);
    else {
      await changeVaultPassword(String(data.get('current') ?? ''), password);
      vaultMode = 'default';
      lastScreen = '';
      render(getState() as State);
      toast('Contraseña cambiada');
    }
  } catch (err) {
    const reason = err instanceof VaultError ? err.reason : null;
    // The panel has already switched to the unlock form, so say it where it will be seen.
    if (reason === 'exists') return void toast('Ya se había creado una contraseña desde otro dispositivo. Ábrela con esa.');
    formMessage(
      form,
      reason === 'wrong-password'
        ? 'Contraseña incorrecta.'
        : reason === 'legacy-mismatch'
          ? 'No coincide con la contraseña que usabas en este navegador.'
          : 'No se pudo completar. Comprueba la conexión.',
    );
    form.querySelector<HTMLInputElement>('input[type="password"]')?.select();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

function onClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  const action = target.closest<HTMLElement>('[data-action]');
  const card = target.closest<HTMLElement>('.card');

  if (action) {
    const name = action.dataset.action;
    if (name === 'vault-lock') return lockVault();
    if (name === 'vault-change' || name === 'vault-cancel') {
      vaultMode = name === 'vault-change' ? 'change' : 'default';
      lastScreen = '';
      return render(getState() as State);
    }
    if (name === 'cancel') return cancelUpload(card?.dataset.upload ?? '');
    if (name === 'retry') return retryUpload(card?.dataset.upload ?? '');
    const item = itemById(card?.dataset.id);
    if (!item) return;
    if (name === 'copy') void copy(item, action);
    else if (name === 'download') void download(item, action);
    else if (name === 'pin') togglePin(item);
    else if (name === 'delete') deleteWithUndo(item);
    return;
  }

  if (card?.dataset.id && !card.classList.contains('is-sealed')) openPreview(card.dataset.id);
}

function focusSibling(card: HTMLElement, step: number) {
  const cards = Array.from(root().querySelectorAll<HTMLElement>('.card[data-id]'));
  cards[cards.indexOf(card) + step]?.focus();
}

function onKeydown(event: KeyboardEvent) {
  const card = (event.target as HTMLElement).closest<HTMLElement>('.card[data-id]');
  if (!card || event.target !== card) return;
  const item = itemById(card.dataset.id);
  if (!item) return;
  const mod = event.ctrlKey || event.metaKey;

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!card.classList.contains('is-sealed')) openPreview(item.id);
  } else if (event.key === 'Delete' || (event.key === 'Backspace' && mod)) {
    event.preventDefault();
    focusSibling(card, 1);
    deleteWithUndo(item);
  } else if (mod && event.key.toLowerCase() === 'c' && !getSelection()?.toString()) {
    event.preventDefault();
    void copy(item, card.querySelector<HTMLElement>('[data-action="copy"]'));
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    focusSibling(card, 1);
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    focusSibling(card, -1);
  }
}

function tick() {
  const now = Date.now();
  for (const [id, { el }] of itemCards) {
    const item = itemById(id);
    if (item) updateItemTime(el, item, now);
  }
}

export function initLibrary() {
  const lib = root();
  lib.addEventListener('click', onClick);
  lib.addEventListener('keydown', onKeydown);
  lib.addEventListener('submit', (event) => {
    event.preventDefault();
    void onVaultSubmit(event.target as HTMLFormElement);
  });
  subscribe((state, changed) => {
    if (RELEVANT.some((key) => changed.has(key))) render(state);
  });
  render(getState() as State);
  setInterval(tick, 30_000);
  document.addEventListener('visibilitychange', () => !document.hidden && tick());
}
