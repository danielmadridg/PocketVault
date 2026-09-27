import type { User } from 'firebase/auth';
import { $, html, isEditable, modalOpen, setHTML } from '../lib/dom';
import { formatBytes } from '../lib/format';
import { notificationsEnabled, notificationsSupported, setNotifications } from '../services/notify';
import { signOut, writesSynced } from '../services/auth';
import { usedBytes } from '../services/upload';
import { getState, setState, subscribe } from '../store';
import { flushPendingDeletes } from './actions';
import { toast, toastError } from './toast';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installPrompt: InstallPrompt | null = null;

function renderUser(user: User | null) {
  const button = $('#account-btn');
  if (!user) return button.replaceChildren();
  const name = user.displayName || user.email?.split('@')[0] || 'Tú';
  if (user.photoURL) {
    setHTML(button, html`<img src="${user.photoURL}" alt="" referrerpolicy="no-referrer" width="32" height="32">`);
    button.querySelector('img')!.addEventListener('error', () => (button.textContent = name[0].toUpperCase()), { once: true });
  } else {
    button.textContent = name[0].toUpperCase();
  }
  $('#menu-name').textContent = name;
  $('#menu-email').textContent = user.email ?? '';
}

function renderMeter() {
  const { quotaBytes } = getState();
  if (!quotaBytes) return;
  const used = usedBytes();
  const ratio = Math.min(1, used / quotaBytes);
  const text = `${formatBytes(used)} de ${formatBytes(quotaBytes)}`;
  for (const meter of document.querySelectorAll<HTMLElement>('.meter')) {
    meter.hidden = false;
    meter.style.setProperty('--used', ratio.toFixed(4));
    meter.classList.toggle('is-full', ratio > 0.9);
    meter.querySelector('.meter-text')!.textContent = text;
    meter.title = `Espacio usado: ${text}`;
  }
}

function initSearch() {
  const input = $<HTMLInputElement>('#search');
  input.addEventListener('input', () => setState({ query: input.value }));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      input.value = '';
      setState({ query: '' });
      input.blur();
    }
  });
  // "/" or Ctrl+K focuses search from anywhere.
  document.addEventListener('keydown', (event) => {
    if (modalOpen() || $('#app').hidden) return;
    const slash = event.key === '/' && !isEditable(event.target);
    const ctrlK = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
    if (slash || ctrlK) {
      event.preventDefault();
      input.focus();
      input.select();
    }
  });
}

function initMenu() {
  const toggle = $<HTMLInputElement>('#notify-toggle');
  const row = $('#notify-row');
  row.hidden = !notificationsSupported();
  toggle.checked = notificationsEnabled();
  toggle.addEventListener('change', async () => {
    const wanted = toggle.checked;
    const on = await setNotifications(wanted);
    toggle.checked = on;
    if (wanted && !on) {
      toastError('El navegador tiene bloqueados los avisos de esta web. Actívalos en los ajustes del sitio.');
    } else if (on) {
      toast('Te avisaré de lo que llegue desde otros dispositivos mientras esta página siga abierta.');
    }
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event as InstallPrompt;
    $('#install-btn').hidden = false;
  });
  $('#install-btn').addEventListener('click', async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    installPrompt = null;
    $('#install-btn').hidden = true;
  });

  const signoutBtn = $<HTMLButtonElement>('#signout-btn');
  signoutBtn.addEventListener('click', async () => {
    signoutBtn.disabled = true;
    // Deletes still inside their undo window would otherwise be lost with the session.
    const flushed = await Promise.race([
      flushPendingDeletes().then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
    ]);
    // Signing out wipes the offline cache, and with it any change that has not synced yet.
    if (!flushed || !(await writesSynced(3000))) {
      signoutBtn.disabled = false;
      toast('Hay cambios sin sincronizar. Si cierras sesión ahora, se perderán.', {
        kind: 'error',
        duration: 10_000,
        action: { label: 'Salir igualmente', run: () => void signOut() },
      });
      return;
    }
    await signOut();
  });
}

function initOnline() {
  const update = () => setState({ online: navigator.onLine });
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
}

export function initTopbar() {
  initSearch();
  initMenu();
  initOnline();
  subscribe((state, changed) => {
    if (changed.has('user')) renderUser(state.user);
    if (changed.has('items') || changed.has('uploads') || changed.has('quotaBytes')) renderMeter();
    if (changed.has('online')) $('#offline').hidden = state.online;
    if (changed.has('query') && $<HTMLInputElement>('#search').value !== state.query) $<HTMLInputElement>('#search').value = state.query;
  });
  $('#offline').hidden = navigator.onLine;
}
