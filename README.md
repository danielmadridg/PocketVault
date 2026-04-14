# PocketVault

Una aplicación web moderna para gestionar y compartir archivos con Firebase.

## 🚀 Características

- Autenticación con Google
- Almacenamiento seguro de archivos
- Cuotas diferenciadas por usuario
- Eliminación automática de archivos expirados
- Interfaz moderna con cursor personalizado

## ⚙️ Configuración

### Requisitos previos

- Cuenta de Firebase
- Node.js (para desarrollo local)

### Pasos de instalación

1. **Clonar el repositorio**
   ```bash
   git clone https://github.com/danielmadridg/PocketVault.git
   cd PocketVault
   ```

2. **Configurar Firebase**
   - Copia `app.config.example.js` a `app.js`
   - Edita `app.js` con tus credenciales de Firebase:
     - Ve a [Firebase Console](https://console.firebase.google.com)
     - Selecciona tu proyecto
     - Ve a **Configuración del proyecto** > **Tus apps**
     - Copia la configuración en el objeto `FIREBASE_CONFIG`
     - También reemplaza `OWNER_EMAIL` con tu correo

3. **Crear `.firebaserc`**
   ```json
   {
     "projects": {
       "default": "tu-project-id"
     }
   }
   ```

4. **Desplegar con Firebase**
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase deploy
   ```

## 📝 Configuración personalizable

En `app.js`, puedes ajustar:

- `EXPIRY_DAYS`: Días antes de que los archivos se eliminen automáticamente (default: 7)
- `MAX_FILE_MB`: Tamaño máximo por archivo en MB (default: 100)
- `OWNER_EMAIL`: Email del propietario (para cuota especial)
- `OWNER_QUOTA_MB`: Cuota del propietario en MB (default: 4500)
- `GUEST_QUOTA_MB`: Cuota de otros usuarios en MB (default: 200)

## 🔒 Seguridad

- Las credenciales de Firebase (`app.js` y `.firebaserc`) están excluidas del repositorio
- Crea estos archivos localmente con tus credenciales
- **Nunca hagas commit de datos sensibles**

## 📄 Licencia

Proyecto personal.
