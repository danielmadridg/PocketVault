import { $, isEditable, modalOpen } from '../lib/dom';
import { getState, setState, subscribe, type State } from '../store';
import { handlePasteData, pasteFromClipboard, saveNote, uploadFiles, wantsSecret } from './actions';

function flash() {
  const composer = $('#composer');
  composer.classList.remove('is-flash');
  void composer.offsetWidth;
  composer.classList.add('is-flash');
}

/** The composer shows where things will go: the hidden tab or an armed toggle means encrypted. */
function renderDestination(state: State) {
  const onSecretTab = state.tab === 'secret';
  const secret = state.composeSecret || onSecretTab;
  const button = $<HTMLButtonElement>('#secret-btn');
  button.setAttribute('aria-pressed', String(secret));
  // On the hidden tab everything is encrypted anyway, so the toggle has nothing to switch.
  button.disabled = onSecretTab;
  $('#composer').classList.toggle('is-secret', secret);
  $<HTMLTextAreaElement>('#note-input').placeholder = secret
    ? 'Nota para la sección oculta: se cifra antes de enviarse…'
    : 'Escribe una nota o pega un enlace…';
}

function initNote() {
  const input = $<HTMLTextAreaElement>('#note-input');
  const send = $<HTMLButtonElement>('#send-btn');
  const autosize = !CSS.supports('field-sizing', 'content');

  const sync = () => {
    send.disabled = !input.value.trim();
    if (autosize) {
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight}px`;
    }
  };

  const submit = async () => {
    const text = input.value;
    if (!text.trim()) return;
    // If the hidden section is locked this refuses and keeps the text in the box.
    const saved = await saveNote(text, wantsSecret());
    if (!saved) return;
    input.value = '';
    sync();
    flash();
  };

  input.addEventListener('input', sync);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit();
    } else if (event.key === 'Escape') {
      input.blur();
    }
  });
  send.addEventListener('click', () => void submit());

  $('#secret-btn').addEventListener('click', () => {
    const next = !getState().composeSecret;
    setState({ composeSecret: next });
    // Arming it while the vault is locked goes straight to the unlock form.
    if (next && getState().vault !== 'unlocked') setState({ tab: 'secret' });
    else input.focus();
  });

  // The toggle stays armed across auto-lock: saving then asks to unlock instead of going out in the clear.
  subscribe((state, changed) => {
    if (changed.has('composeSecret') || changed.has('tab')) renderDestination(state);
  });
  renderDestination(getState() as State);
}

function initFiles() {
  const input = $<HTMLInputElement>('#file-input');
  $('#attach-btn').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files?.length && uploadFiles(Array.from(input.files))) flash();
    input.value = '';
  });
  $('#paste-btn').addEventListener('click', () => void pasteFromClipboard().then((saved) => saved && flash()));
}

/** Files can be dropped anywhere in the window, not just on a target. */
function initDrop() {
  const overlay = $('#drop-overlay');
  let depth = 0;
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  const hide = () => {
    depth = 0;
    overlay.hidden = true;
  };

  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event) || $('#app').hidden || modalOpen()) return;
    event.preventDefault();
    depth++;
    $('#drop-overlay-text').textContent = wantsSecret() ? 'Suelta para cifrar y guardar en la sección oculta' : 'Suelta para guardar';
    overlay.hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = $('#app').hidden ? 'none' : 'copy';
  });
  window.addEventListener('dragleave', () => {
    if (--depth <= 0) hide();
  });
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    hide();
    if ($('#app').hidden || modalOpen()) return;
    if (uploadFiles(Array.from(event.dataTransfer?.files ?? []))) flash();
  });
}

/**
 * Ctrl+V anywhere on the page: images and files upload, text becomes a note.
 * Inside a text field, text pastes normally but files are still captured.
 */
function initGlobalPaste() {
  document.addEventListener('paste', (event) => {
    if ($('#app').hidden || !getState().user || !event.clipboardData || modalOpen()) return;
    const result = handlePasteData(event.clipboardData, isEditable(event.target));
    if (result === 'ignored') return;
    event.preventDefault();
    if (result === 'saved') flash();
  });
}

export function initComposer() {
  initNote();
  initFiles();
  initDrop();
  initGlobalPaste();
}
