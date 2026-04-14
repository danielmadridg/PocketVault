// ============================================================
//  FIREBASE CONFIG — Copia esto a app.js y reemplaza con tus datos
//  (Firebase Console > Configuración del proyecto > Tus apps)
// ============================================================
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY_HERE",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
// ============================================================

const EXPIRY_DAYS = 7;        // días antes de borrado automático
const MAX_FILE_MB = 100;      // tamaño máximo por archivo
const OWNER_EMAIL  = 'your-email@example.com';
const OWNER_QUOTA_MB = 4500;  // ~4.4 GB para el propietario
const GUEST_QUOTA_MB = 200;   // 200 MB para el resto
