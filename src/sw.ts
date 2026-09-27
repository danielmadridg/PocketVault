/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { putShared } from './lib/share-inbox';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

const MAX_SHARE_BYTES = 300 * 1024 * 1024;

self.skipWaiting();
clientsClaim();

// App shell (hashed JS/CSS, fonts, icons) served from cache: instant start, works offline.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// /__/ is reserved by Firebase Hosting (auth handler, SDK config): never shadow it.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/__\//, /^\/share/] }));

// Web Share Target: Android's share sheet POSTs files/text here.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.origin !== self.location.origin || url.pathname !== '/share') return;
  event.respondWith(
    (async () => {
      try {
        // Defence in depth only: a site can hide its referrer, which is why the page
        // still asks before saving anything shared.
        const referrer = event.request.referrer;
        if (/^https?:/.test(referrer) && new URL(referrer).origin !== self.location.origin) {
          return Response.redirect('/', 303);
        }
        const form = await event.request.formData();
        const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
        if (files.reduce((sum, f) => sum + f.size, 0) > MAX_SHARE_BYTES) return Response.redirect('/?shared=too-large', 303);
        const text = ['title', 'text', 'url']
          .map((k) => form.get(k))
          .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
          .filter((v, i, all) => all.indexOf(v) === i)
          .join('\n');
        if (files.length || text) await putShared({ id: crypto.randomUUID(), files, text, receivedAt: Date.now() });
      } catch (err) {
        console.error('Share target failed', err);
      }
      return Response.redirect('/?shared=1', 303);
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) await existing.focus();
      else await self.clients.openWindow('/');
    })(),
  );
});
