import type { Item } from '../types';
import { remoteItems } from './items';

const PREF = 'pv:notify';

export const notificationsSupported = () => 'Notification' in window;

export function notificationsEnabled(): boolean {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false;
  try {
    return localStorage.getItem(PREF) === '1';
  } catch {
    return false;
  }
}

/** Returns the resulting on/off state. */
export async function setNotifications(on: boolean): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (on && Notification.permission !== 'granted') {
    if ((await Notification.requestPermission()) !== 'granted') return false;
  }
  try {
    localStorage.setItem(PREF, on ? '1' : '0');
  } catch {
    // Private mode: the preference just won't persist.
  }
  return on;
}

async function show(item: Item) {
  const title = item.isSecret ? 'Nuevo en la sección oculta' : 'Nuevo en PocketVault';
  const body = item.isSecret ? 'Ábrela para verlo.' : item.name;
  const options: NotificationOptions = { body, tag: `pv-${item.id}`, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' };
  // Android Chrome only allows notifications through the service worker.
  const registration = await navigator.serviceWorker?.getRegistration();
  if (registration) {
    await registration.showNotification(title, options);
  } else {
    new Notification(title, options);
  }
}

/** Notify about items uploaded from another device while this tab is in the background. */
export function initNotifications() {
  remoteItems.addEventListener('item', (event) => {
    if (!document.hidden || !notificationsEnabled()) return;
    show((event as CustomEvent<Item>).detail).catch((err) => console.warn('Notification failed', err));
  });
}
