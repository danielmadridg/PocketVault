import './styles/index.css';
import { onAuthStateChanged } from 'firebase/auth';
import { QUOTA_GUEST_BYTES } from './config';
import { auth, loadStorage } from './firebase';
import { $, IS_APPLE, MOD_LABEL, modalOpen } from './lib/dom';
import { icon, type IconName } from './lib/icons';
import { quotaFor } from './services/auth';
import { stopItems, watchItems } from './services/items';
import { initNotifications } from './services/notify';
import { migrateLegacyItems, revealItems, stopVault, watchVault } from './services/vault';
import { getState, setState, subscribe } from './store';
import { initAuthScreen, resetAuthScreen } from './ui/auth-screen';
import { initComposer } from './ui/composer';
import { initLibrary } from './ui/library';
import { initPreview } from './ui/preview';
import { reviewSharedInbox } from './ui/share';
import { initTabs } from './ui/tabs';
import { initTopbar } from './ui/topbar';
import { toastError } from './ui/toast';

/** Set while signed in, so a returning user sees the app shell at once instead of the sign-in form. */
const SESSION_HINT = 'pv:session';

function hint(on?: boolean): boolean {
  try {
    if (on === true) localStorage.setItem(SESSION_HINT, '1');
    if (on === false) localStorage.removeItem(SESSION_HINT);
    return localStorage.getItem(SESSION_HINT) === '1';
  } catch {
    return false;
  }
}

function hydrateStatic() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-icon]')) {
    el.innerHTML = icon(el.dataset.icon as IconName, Number(el.dataset.size) || 16).value;
  }
  if (IS_APPLE) for (const el of document.querySelectorAll('.kbd-mod')) el.textContent = MOD_LABEL;
}

function show(screen: 'app' | 'auth') {
  $('#app').hidden = screen !== 'app';
  $('#auth').hidden = screen !== 'auth';
}

/** Nothing in flight that a reload would lose. */
function idle(): boolean {
  const { uploads, pendingDelete, vault } = getState();
  const typingSignIn = !$('#auth').hidden && !!$<HTMLInputElement>('#auth-email').value;
  return (
    !uploads.length &&
    !pendingDelete.size &&
    vault !== 'unlocked' &&
    !typingSignIn &&
    !modalOpen() &&
    !$<HTMLTextAreaElement>('#note-input').value.trim()
  );
}

/**
 * The service worker activates new versions immediately, but the page is only reloaded
 * onto them while it is in the background and idle: never in the middle of an upload,
 * an undo window, a half-written note or an open dialog.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let hadController = !!navigator.serviceWorker.controller;
  let updateReady = false;
  let hiddenTimer = 0;
  // A short app switch (file picker, camera, Google popup) must not trigger it: wait a minute.
  const scheduleReload = () => {
    clearTimeout(hiddenTimer);
    if (!updateReady || !document.hidden) return;
    hiddenTimer = window.setTimeout(() => {
      if (document.hidden && idle()) location.reload();
    }, 60_000);
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first controller of a page opened without one is the install, not an update.
    if (!hadController) {
      hadController = true;
      return;
    }
    updateReady = true;
    scheduleReload();
  });
  document.addEventListener('visibilitychange', scheduleReload);
  navigator.serviceWorker
    .register('/sw.js')
    .then((registration) => {
      let lastCheck = Date.now();
      document.addEventListener('visibilitychange', () => {
        if (document.hidden || Date.now() - lastCheck < 30 * 60_000) return;
        lastCheck = Date.now();
        void registration.update();
      });
    })
    .catch((err) => console.warn('Service worker registration failed', err));
}

/**
 * Load the Storage chunk while idle: the first upload starts faster, and a tab left open
 * across a deploy never has to fetch a chunk the new release no longer serves.
 */
function preloadStorage() {
  const load = () => void loadStorage();
  if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 5000 });
  else setTimeout(load, 2000);
}

function boot() {
  hydrateStatic();
  initAuthScreen();
  initTopbar();
  initComposer();
  initTabs();
  initLibrary();
  initPreview();
  initNotifications();

  document.addEventListener('pv:error', (event) => toastError((event as CustomEvent<string>).detail));

  // While the vault is open: decrypt hidden items as they arrive, and seal any v1 plaintext ones.
  subscribe((state, changed) => {
    if (changed.has('items') && state.vault === 'unlocked') {
      void revealItems(state.items);
      void migrateLegacyItems(state.items);
    }
  });

  if (hint()) show('app');

  onAuthStateChanged(auth, (user) => {
    if (user) {
      hint(true);
      if (getState().user?.uid !== user.uid) {
        setState({ user, quotaBytes: QUOTA_GUEST_BYTES });
        watchItems(user.uid);
        watchVault(user.uid);
        void quotaFor(user).then((quotaBytes) => setState({ quotaBytes }));
        void reviewSharedInbox();
        preloadStorage();
      }
      show('app');
    } else {
      hint(false);
      stopItems();
      stopVault();
      setState({ user: null, items: [], itemsLoaded: false, uploads: [], tab: 'all', query: '' });
      resetAuthScreen();
      show('auth');
    }
  });

  if (import.meta.env.PROD) registerServiceWorker();
}

boot();
