# PocketVault

Pega en un dispositivo y recógelo en otro. Todo lo que guardas se borra solo a los 7 días, salvo lo que fijes.

https://pocketvault.space

## Qué hace

- **Ctrl+V en cualquier parte de la página.** Una captura o un archivo copiado se sube; el texto se guarda como nota. Dentro de un cuadro de texto, el texto se pega con normalidad, pero los archivos se siguen capturando.
- **Soltar archivos en toda la ventana**, sin tener que apuntar a una zona concreta.
- **Tiempo real entre dispositivos**, con caché local persistente: la biblioteca sale de IndexedDB antes de que responda la red y funciona sin conexión.
- **Caducidad visible.** El borde inferior de cada tarjeta es una mecha que se consume en 7 días; el último día se pone en rojo y muestra la cuenta atrás. Lo fijado no caduca.
- **Sección oculta con cifrado real en el dispositivo** (ver [Seguridad](#seguridad)).
- **Vista previa** de imágenes a resolución completa, vídeo, audio, texto y notas con enlaces. Las notas se pueden editar. Navegación con ← →.
- **Copiar** la imagen misma (se convierte a PNG, el único formato que acepta el portapapeles), el texto de una nota o el enlace de descarga de otros archivos.
- **Borrar con deshacer:** los elementos se ocultan al instante y se borran de verdad a los 5 s.
- **PWA instalable** con *share target*: en Android, el menú Compartir de cualquier app envía archivos o texto a PocketVault, que pide confirmación antes de guardarlo.
- **Avisos opcionales** cuando llega algo desde otro dispositivo mientras la pestaña está en segundo plano.

### Atajos

| Tecla | Acción |
| --- | --- |
| `Ctrl`/`⌘` + `V` | Guardar lo que haya en el portapapeles |
| `/` o `Ctrl` + `K` | Buscar |
| `Ctrl` + `Enter` | Guardar la nota que estás escribiendo |
| `Enter` sobre una tarjeta | Abrir la vista previa |
| `Supr` | Borrar (con deshacer) |
| `Ctrl` + `C` sobre una tarjeta o en la vista previa | Copiar |
| En la vista previa: `←` `→`, `D`, `P`, `E`, `Esc` | Moverse, descargar, fijar, editar, cerrar |

## Desarrollo

Requisitos: Node 22+ y, para los emuladores, Firebase CLI y Java 21+.

```bash
npm install
npm run dev          # contra el proyecto real de Firebase
```

Sin tocar producción:

```bash
npm run emulators    # Auth, Firestore y Storage en local (proyecto demo-pocketvault)
npm run dev:emu      # la app conectada a los emuladores
```

```bash
npm run typecheck
npm run build        # typecheck + build en dist/
npm run preview
```

## Despliegue

Cada push a `main` ejecuta `.github/workflows/deploy.yml`, que instala, compila y publica `dist/` en Firebase Hosting.

Las reglas no se publican solas. Si cambias `firestore.rules` o `storage.rules`:

```bash
firebase deploy --only firestore:rules,storage
```

Para copiar imágenes, el bucket necesita CORS (está en `cors.json`):

```bash
gsutil cors set cors.json gs://vault-b76d1.firebasestorage.app
```

## Estructura

```
src/
  main.ts            arranque: auth, suscripciones, registro del service worker
  config.ts          constantes (caducidad, cuotas, límites) y config de Firebase
  firebase.ts        App, Auth y Firestore con caché persistente; Storage bajo demanda
  store.ts           estado global mínimo con notificaciones agrupadas por microtarea
  services/          items (Firestore), upload (cola con concurrencia), vault (cifrado),
                     content (descargar/copiar/descifrar), auth, notify
  ui/                library (reconciliación por clave), card, preview, composer
                     (Ctrl+V global y soltar archivos), tabs, topbar, toast, actions
  lib/               crypto, media (miniaturas), dom (plantillas con escape), formatos
  sw.ts              service worker: precache del shell y share target
  styles/            tokens OKLCH y hojas por zona
```

Los valores ajustables están en `src/config.ts`: días de caducidad, tamaño máximo por archivo y cuotas. La cuota del propietario se decide comparando el SHA-256 del email, así que la dirección no aparece en el repositorio.

## Seguridad

- **Reglas:** cada usuario solo puede leer y escribir `users/{uid}/…` en Firestore y `files/{uid}/…` en Storage. Storage rechaza objetos de 100 MB o más.
- **Sección oculta:** una clave de datos AES-256 aleatoria cifra cada elemento oculto (texto, nombre, miniatura y el propio archivo). Esa clave se guarda envuelta con otra derivada de tu contraseña mediante PBKDF2-SHA256 con 600 000 iteraciones. Firestore y Storage solo ven texto cifrado. Cambiar la contraseña vuelve a envolver la clave sin recifrar nada. **Si olvidas la contraseña, lo oculto no se puede recuperar.**
- **Migración desde la v1:** las notas ocultas que la v1 guardaba en claro se cifran la primera vez que se abre la sección oculta, leyendo la copia del servidor dentro de una transacción. En el navegador donde se usaba la v1 se exige la misma contraseña de siempre, y después se borra el hash antiguo.
- **Caducidad segura:** antes de borrar algo caducado se relee la copia del servidor dentro de una transacción, así que un dispositivo con datos viejos nunca borra algo que se haya fijado desde otro.
- **Compartir** (`POST /share`) nunca guarda nada sin un "Guardar" explícito, porque cualquier web podría enviar un formulario a esa ruta.
- **Cerrar sesión** borra la caché local de Firestore, así que en un ordenador compartido no queda copia de la bóveda. Si quedan cambios sin sincronizar, avisa antes de hacerlo.
- **CSP** estricta en `firebase.json`: sin scripts de terceros salvo `apis.google.com`, necesario para el inicio de sesión con Google.
- La configuración web de Firebase va en el código a propósito: identifica el proyecto, no da acceso. El acceso lo controlan las reglas.

## Limitaciones conocidas

- La caducidad se aplica desde el cliente: lo caducado se borra la próxima vez que abres la app en cualquier dispositivo. Para borrarlo aunque nadie la abra haría falta una Cloud Function programada (plan Blaze).
- La cuota se comprueba en el cliente. Las reglas de Storage limitan el tamaño por archivo, pero no el total por usuario.
- Los avisos solo funcionan con la pestaña abierta. Las notificaciones push reales requieren FCM y un backend.
- El registro está abierto a cualquiera, como en la v1. Si la app es solo para ti, desactiva la creación de cuentas en Firebase Authentication y quita el enlace de "Crear cuenta".
- De los archivos ocultos, el servidor ve la categoría (imagen, documento…) y el tamaño; el nombre, el tipo, la miniatura y el contenido van cifrados.
- `public/app.js` solo recarga a la versión nueva a los navegadores que aún tengan la v1 en caché. Se puede borrar a partir de noviembre de 2026.
