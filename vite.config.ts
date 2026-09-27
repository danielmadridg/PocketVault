import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const THEME = '#100e0b';

export default defineConfig({
  resolve: {
    alias: {
      re2js: fileURLToPath(new URL('./src/lib/re2js-shim.ts', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
  plugins: [
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      registerType: 'autoUpdate',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,webmanifest}'],
        // app.js is only the v1 → v2 reload bridge, never part of the new shell.
        globIgnores: ['404.html', 'app.js'],
      },
      manifest: {
        id: '/',
        name: 'PocketVault',
        short_name: 'PocketVault',
        description: 'Pega en un dispositivo, recógelo en otro. Todo caduca en 7 días salvo lo que fijes.',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: THEME,
        theme_color: THEME,
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        share_target: {
          action: '/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{ name: 'files', accept: ['*/*'] }],
          },
        },
      },
      devOptions: { enabled: false },
    }),
  ],
});
