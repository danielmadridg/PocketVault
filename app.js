// ============================================================
//  FIREBASE CONFIG — Pega aquí tu configuración de Firebase
//  (Firebase Console > Configuración del proyecto > Tus apps)
// ============================================================
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyA9m8TDbh7RWj86BPJtGW64S117IAnkT-8",
  authDomain:        "vault-b76d1.firebaseapp.com",
  projectId:         "vault-b76d1",
  storageBucket:     "vault-b76d1.firebasestorage.app",
  messagingSenderId: "730367163719",
  appId:             "1:730367163719:web:eccc44c5f5a401104fe062"
};
// ============================================================

const EXPIRY_DAYS = 7;        // días antes de borrado automático
const MAX_FILE_MB = 100;      // tamaño máximo por archivo
const OWNER_EMAIL  = 'danielmadrridgarrabe@gmail.com';
const OWNER_QUOTA_MB = 4500;  // ~4.4 GB para el propietario
const GUEST_QUOTA_MB = 200;   // 200 MB para el resto

// ─── Estado global ───
let db, auth, storage, currentUser;
let unsubscribeFiles = null;
let activeTab = 'all';
let allFiles  = [];

// ─── Init ───────────────────────────────────────────────────
(function init() {
  firebase.initializeApp(FIREBASE_CONFIG);
  auth    = firebase.auth();
  db      = firebase.firestore();
  storage = firebase.storage();

  // Handle Google redirect result
  auth.getRedirectResult().catch(e => {
    if (e.code) showAuthError(friendlyAuthError(e.code));
  });

  auth.onAuthStateChanged(user => {
    if (user) {
      currentUser = user;
      showApp(user);
    } else {
      currentUser = null;
      showAuth();
    }
  });

  bindAuthEvents();
  bindAppEvents();
})();

// ─── AUTH ────────────────────────────────────────────────────
function bindAuthEvents() {
  document.getElementById('signin-btn').addEventListener('click', () => {
    const email = document.getElementById('email-input').value.trim();
    const pass  = document.getElementById('password-input').value;
    if (!email || !pass) return showAuthError('Introduce email y contraseña.');
    setAuthLoading(true);
    auth.signInWithEmailAndPassword(email, pass)
      .catch(e => { setAuthLoading(false); showAuthError(friendlyAuthError(e.code)); });
  });

  document.getElementById('signup-btn').addEventListener('click', () => {
    const email = document.getElementById('email-input').value.trim();
    const pass  = document.getElementById('password-input').value;
    if (!email || !pass) return showAuthError('Introduce email y contraseña.');
    if (pass.length < 6) return showAuthError('La contraseña debe tener al menos 6 caracteres.');
    setAuthLoading(true);
    auth.createUserWithEmailAndPassword(email, pass)
      .catch(e => { setAuthLoading(false); showAuthError(friendlyAuthError(e.code)); });
  });

  document.getElementById('google-btn').addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(e => showAuthError(friendlyAuthError(e.code)));
  });

  // Submit on Enter
  document.getElementById('password-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('signin-btn').click();
  });
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function setAuthLoading(on) {
  const btns = ['signin-btn', 'signup-btn', 'google-btn'];
  btns.forEach(id => document.getElementById(id).disabled = on);
}

function friendlyAuthError(code) {
  const map = {
    'auth/user-not-found':        'No existe una cuenta con ese email.',
    'auth/wrong-password':        'Contraseña incorrecta.',
    'auth/invalid-credential':    'Email o contraseña incorrectos.',
    'auth/email-already-in-use':  'Ya existe una cuenta con ese email.',
    'auth/weak-password':         'La contraseña es demasiado corta.',
    'auth/invalid-email':         'El email no tiene un formato válido.',
    'auth/too-many-requests':     'Demasiados intentos. Espera un momento.',
    'auth/popup-closed-by-user':  'Popup cerrado. Inténtalo de nuevo.',
  };
  return map[code] || 'Error de autenticación. Inténtalo de nuevo.';
}

// ─── SHOW / HIDE SCREENS ─────────────────────────────────────
function showAuth() {
  if (unsubscribeFiles) { unsubscribeFiles(); unsubscribeFiles = null; }
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display  = 'none';
  document.getElementById('auth-error').style.display  = 'none';
  setAuthLoading(false);
}

function showApp(user) {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').style.display  = 'block';

  // User avatar/name
  const avatar = document.getElementById('user-avatar');
  const placeholder = document.getElementById('user-avatar-placeholder');
  const nameEl = document.getElementById('user-name');

  const displayName = user.displayName || user.email.split('@')[0];
  nameEl.textContent = displayName;

  if (user.photoURL) {
    avatar.src = user.photoURL;
    avatar.style.display = 'block';
    placeholder.style.display = 'none';
  } else {
    placeholder.textContent = displayName[0].toUpperCase();
    placeholder.style.display = 'flex';
    avatar.style.display = 'none';
  }

  renderSkeletons();
  subscribeToFiles(user.uid);
}

// ─── APP EVENTS ──────────────────────────────────────────────
function bindAppEvents() {
  // Sign out
  document.getElementById('signout-btn').addEventListener('click', () => {
    auth.signOut();
  });

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      renderGrid(activeTab);
    });
  });

  // Note send
  const noteInput = document.getElementById('note-input');
  const noteBtn   = document.getElementById('note-send');

  const sendNote = () => {
    const text = noteInput.value.trim();
    if (!text) return;
    submitNote(text);
    noteInput.value = '';
    noteInput.style.height = 'auto';
  };

  noteBtn.addEventListener('click', sendNote);
  noteInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendNote(); }
  });
  noteInput.addEventListener('input', () => {
    noteInput.style.height = 'auto';
    noteInput.style.height = Math.min(noteInput.scrollHeight, 140) + 'px';
  });

  // Drop zone click
  const dropZone  = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => handleFiles(e.target.files));

  // Drag & drop
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop',     e => e.preventDefault());

  dropZone.addEventListener('dragenter', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', e => {
    if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('dragover');
  });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });

  // File grid actions — event delegation (survives grid re-renders)
  document.getElementById('file-grid').addEventListener('click', e => {
    const btn = e.target.closest('.action-btn');
    if (!btn) return;
    const card = btn.closest('.file-card');
    if (!card) return;
    const f = allFiles.find(x => x.id === card.dataset.id);
    if (!f) return;
    e.stopPropagation();
    if (btn.classList.contains('action-download')) downloadFile(f);
    else if (btn.classList.contains('action-favorite')) toggleFavorite(f);
    else if (btn.classList.contains('action-copy')) copyLink(f);
    else if (btn.classList.contains('action-delete')) confirmDelete(f);
  });
}

// ─── NOTE SUBMIT ─────────────────────────────────────────────
async function submitNote(text) {
  const uid     = currentUser.uid;
  const noteRef = db.collection('users').doc(uid).collection('files').doc();
  const now     = firebase.firestore.Timestamp.now();
  const expiry  = new Date(now.toDate().getTime() + EXPIRY_DAYS * 86400000);

  await noteRef.set({
    name:        text.slice(0, 60) + (text.length > 60 ? '…' : ''),
    content:     text,
    size:        0,
    type:        'text/plain',
    category:    'note',
    storagePath: null,
    downloadURL: null,
    thumbnail:   null,
    isFavorite:  false,
    uploadedAt:  now,
    expiresAt:   firebase.firestore.Timestamp.fromDate(expiry),
  });

  showToast('Nota guardada', 'success');
}

// ─── FILE UPLOAD ─────────────────────────────────────────────
async function handleFiles(fileList) {
  const files = Array.from(fileList);
  const quotaMB = currentUser.email === OWNER_EMAIL ? OWNER_QUOTA_MB : GUEST_QUOTA_MB;
  const usedBytes = allFiles.reduce((sum, f) => sum + (f.size || 0), 0);
  const usedMB = usedBytes / (1024 * 1024);

  for (const file of files) {
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      showToast(`"${truncateName(file.name, 20)}" supera los ${MAX_FILE_MB} MB`, 'error');
      continue;
    }
    if (usedMB + file.size / (1024 * 1024) > quotaMB) {
      showToast(`Sin espacio disponible (límite: ${quotaMB} MB)`, 'error');
      break;
    }
    uploadFile(file);
  }
  document.getElementById('file-input').value = '';
}

async function uploadFile(file) {
  const uid     = currentUser.uid;
  const fileRef = db.collection('users').doc(uid).collection('files').doc();
  const fileId  = fileRef.id;
  const storagePath = `files/${uid}/${fileId}/${file.name}`;
  const storageRef  = storage.ref(storagePath);

  // Progress UI
  const progressEl = createProgressItem(fileId, file.name);
  document.getElementById('upload-progress-container').appendChild(progressEl);

  // Thumbnail (images only)
  let thumbnail = null;
  if (file.type.startsWith('image/')) {
    thumbnail = await generateThumbnail(file).catch(() => null);
  }

  const uploadTask = storageRef.put(file);

  uploadTask.on('state_changed',
    snapshot => {
      const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
      updateProgress(fileId, pct);
    },
    error => {
      removeProgress(fileId);
      showToast(`Error al subir "${truncateName(file.name, 20)}"`, 'error');
      console.error(error);
    },
    async () => {
      const downloadURL = await uploadTask.snapshot.ref.getDownloadURL();
      const now    = firebase.firestore.Timestamp.now();
      const expiry = new Date(now.toDate().getTime() + EXPIRY_DAYS * 86400000);

      await fileRef.set({
        name:        file.name,
        size:        file.size,
        type:        file.type,
        category:    getCategory(file.type),
        storagePath: storagePath,
        downloadURL: downloadURL,
        thumbnail:   thumbnail,
        isFavorite:  false,
        uploadedAt:  now,
        expiresAt:   firebase.firestore.Timestamp.fromDate(expiry),
      });

      removeProgress(fileId);
      showToast(`"${truncateName(file.name, 24)}" subido`, 'success');
    }
  );
}

// ─── THUMBNAIL ───────────────────────────────────────────────
function generateThumbnail(file) {
  return new Promise((resolve, reject) => {
    const img  = new Image();
    const url  = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 220;
      let w = img.width, h = img.height;
      if (w > h) { if (w > MAX) { h = h * MAX / w; w = MAX; } }
      else        { if (h > MAX) { w = w * MAX / h; h = MAX; } }
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(); };
    img.src = url;
  });
}

// ─── FIRESTORE LISTENER ──────────────────────────────────────
function subscribeToFiles(uid) {
  if (unsubscribeFiles) unsubscribeFiles();

  unsubscribeFiles = db
    .collection('users').doc(uid).collection('files')
    .orderBy('uploadedAt', 'desc')
    .onSnapshot(snapshot => {
      const now = Date.now();
      const toDelete = [];
      allFiles = [];

      snapshot.forEach(doc => {
        const f = { id: doc.id, ...doc.data() };
        if (!f.isFavorite && f.expiresAt && f.expiresAt.toMillis() < now) {
          toDelete.push(f);
        } else {
          allFiles.push(f);
        }
      });

      // Auto-delete expired files (fire & forget)
      toDelete.forEach(f => deleteFileRecord(f).catch(console.error));

      renderGrid(activeTab);
      updateTabBadges();
    }, error => {
      console.error('Firestore error:', error);
      showToast('Error de conexión', 'error');
    });
}

// ─── RENDER GRID ─────────────────────────────────────────────
function renderGrid(tab) {
  const grid = document.getElementById('file-grid');
  const filtered = filterByTab(allFiles, tab);

  if (filtered.length === 0) {
    grid.innerHTML = emptyStateHTML(tab);
    return;
  }

  grid.innerHTML = filtered.map(f => fileCardHTML(f)).join('');
}

// ─── FILTER ──────────────────────────────────────────────────
const TAB_FILTERS = {
  all:       ()  => true,
  favorites: f   => f.isFavorite,
  images:    f   => f.category === 'image',
  documents: f   => f.category === 'document',
  videos:    f   => f.category === 'video',
  notes:     f   => f.category === 'note',
  other:     f   => ['audio','archive','other'].includes(f.category),
};

function filterByTab(files, tab) {
  return files.filter(TAB_FILTERS[tab] || (() => true));
}

// ─── CARD HTML ───────────────────────────────────────────────
function fileCardHTML(f) {
  if (f.category === 'note') return noteCardHTML(f);

  const thumb = f.thumbnail
    ? `<img src="${f.thumbnail}" alt="${escapeHTML(f.name)}" loading="lazy">`
    : `<div class="file-type-icon ${iconClass(f.category)}">${categoryEmoji(f.category)}</div>`;

  const expiryBadge = f.isFavorite
    ? `<span class="file-expiry expiry-fav">★ Favorito</span>`
    : expiryBadgeHTML(f.expiresAt);

  const favClass = f.isFavorite ? 'action-btn action-favorite active' : 'action-btn action-favorite';
  const favTitle = f.isFavorite ? 'Quitar de favoritos' : 'Marcar como favorito';

  const cardClass = f.isFavorite ? 'file-card favorite' : 'file-card';

  return `
  <div class="${cardClass}" data-id="${f.id}">
    <div class="file-thumb">
      ${thumb}
      ${f.isFavorite ? '<div class="fav-overlay">★</div>' : ''}
    </div>
    <div class="file-info">
      <div class="file-name" title="${escapeHTML(f.name)}">${escapeHTML(truncateName(f.name, 22))}</div>
      <div class="file-meta">
        <span>${formatBytes(f.size)}</span>
        <span>${timeAgo(f.uploadedAt)}</span>
      </div>
      ${expiryBadge}
      <div class="file-actions">
        <button class="action-btn action-download" title="Descargar">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </button>
        <button class="${favClass}" title="${favTitle}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="${f.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </button>
        <button class="action-btn action-copy" title="Copiar enlace">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
        <button class="action-btn action-delete delete" title="Eliminar">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      </div>
    </div>
  </div>`;
}

function noteCardHTML(f) {
  const favClass = f.isFavorite ? 'action-btn action-favorite active' : 'action-btn action-favorite';
  const cardClass = f.isFavorite ? 'file-card note-card favorite' : 'file-card note-card';
  const expiryBadge = f.isFavorite
    ? `<span class="file-expiry expiry-fav">★ Favorito</span>`
    : expiryBadgeHTML(f.expiresAt);

  return `
  <div class="${cardClass}" data-id="${f.id}">
    <div class="note-content">${escapeHTML(f.content || f.name)}</div>
    <div class="file-info">
      <div class="file-meta">
        <span>${timeAgo(f.uploadedAt)}</span>
      </div>
      ${expiryBadge}
      <div class="file-actions">
        <button class="action-btn action-copy" title="Copiar texto">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
        <button class="${favClass}" title="${f.isFavorite ? 'Quitar favorito' : 'Favorito'}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="${f.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </button>
        <button class="action-btn action-delete delete" title="Eliminar">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      </div>
    </div>
  </div>`;
}

function emptyStateHTML(tab) {
  const msgs = {
    all:       ['Sin archivos aún', 'Arrastra o sube tu primer archivo'],
    favorites: ['Sin favoritos', 'Marca archivos con ★ para que no expiren'],
    images:    ['Sin imágenes', 'Sube fotos o capturas de pantalla'],
    documents: ['Sin documentos', 'Sube PDFs, Word, Excel…'],
    videos:    ['Sin vídeos', 'Sube tus vídeos aquí'],
    other:     ['Sin otros archivos', 'Aquí verás audios, archivos y más'],
  };
  const [title, sub] = msgs[tab] || msgs.all;
  return `
  <div class="empty-state">
    <div class="empty-state-icon">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>
      </svg>
    </div>
    <h3>${title}</h3>
    <p>${sub}</p>
  </div>`;
}

// ─── FILE ACTIONS ────────────────────────────────────────────
function downloadFile(f) {
  const a = document.createElement('a');
  a.href = f.downloadURL;
  a.download = f.name;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.click();
}

async function toggleFavorite(f) {
  const uid = currentUser.uid;
  const newFav = !f.isFavorite;

  // If becoming favorite, push expiry far into the future
  // If unfavoriting, reset 7-day countdown from now
  const newExpiry = newFav
    ? new Date('9999-12-31')
    : new Date(Date.now() + EXPIRY_DAYS * 86400000);

  await db.collection('users').doc(uid).collection('files').doc(f.id).update({
    isFavorite: newFav,
    expiresAt:  firebase.firestore.Timestamp.fromDate(newExpiry),
  });

  // Trigger star pop animation
  const card = document.querySelector(`.file-card[data-id="${f.id}"] .action-favorite`);
  if (card && newFav) {
    card.classList.remove('pop');
    void card.offsetWidth;
    card.classList.add('pop');
    card.addEventListener('animationend', () => card.classList.remove('pop'), { once: true });
  }

  showToast(newFav ? 'Guardado en favoritos ★' : 'Eliminado de favoritos', newFav ? 'success' : 'info');
}

function copyLink(f) {
  const text = f.category === 'note' ? (f.content || f.name) : f.downloadURL;
  navigator.clipboard.writeText(text).then(() => {
    showToast(f.category === 'note' ? 'Texto copiado' : 'Enlace copiado', 'success');
  }).catch(() => {
    showToast('No se pudo copiar', 'error');
  });
}

function confirmDelete(f) {
  const name = truncateName(f.name, 28);
  if (!confirm(`¿Eliminar "${name}"?`)) return;
  deleteFileRecord(f)
    .then(() => showToast('Archivo eliminado', 'info'))
    .catch(() => showToast('Error al eliminar', 'error'));
}

async function deleteFileRecord(f) {
  // Delete from Storage (may already be gone, ignore error)
  try {
    await storage.ref(f.storagePath).delete();
  } catch (_) {}
  // Delete Firestore doc
  await db.collection('users').doc(currentUser.uid).collection('files').doc(f.id).delete();
}

// ─── BADGE COUNTS ────────────────────────────────────────────
function updateTabBadges() {
  const counts = {
    all:       allFiles.length,
    favorites: allFiles.filter(f => f.isFavorite).length,
    images:    allFiles.filter(f => f.category === 'image').length,
    documents: allFiles.filter(f => f.category === 'document').length,
    videos:    allFiles.filter(f => f.category === 'video').length,
    notes:     allFiles.filter(f => f.category === 'note').length,
    other:     allFiles.filter(f => ['audio','archive','other'].includes(f.category)).length,
  };
  Object.entries(counts).forEach(([tab, count]) => {
    const el = document.getElementById(`badge-${tab}`);
    if (el) el.textContent = count > 0 ? count : '';
  });
}

// ─── PROGRESS UI ─────────────────────────────────────────────
function createProgressItem(id, name) {
  const el = document.createElement('div');
  el.className = 'upload-item';
  el.id = `progress-${id}`;
  el.innerHTML = `
    <span class="upload-item-name">${escapeHTML(truncateName(name, 30))}</span>
    <span class="upload-item-pct" id="pct-${id}">0%</span>
    <div class="progress-track"><div class="progress-fill" id="fill-${id}" style="--pct:0%"></div></div>`;
  return el;
}

function updateProgress(id, pct) {
  const pctEl  = document.getElementById(`pct-${id}`);
  const fillEl = document.getElementById(`fill-${id}`);
  if (pctEl)  pctEl.textContent = `${pct}%`;
  if (fillEl) fillEl.style.setProperty('--pct', `${pct}%`);
}

function removeProgress(id) {
  const el = document.getElementById(`progress-${id}`);
  if (el) el.remove();
}

// ─── SKELETON ────────────────────────────────────────────────
function renderSkeletons() {
  const grid = document.getElementById('file-grid');
  grid.innerHTML = Array.from({length: 6}).map(() => `
    <div class="file-card">
      <div class="file-thumb"><div class="skeleton" style="width:100%;height:100%"></div></div>
      <div class="file-info">
        <div class="skeleton" style="height:14px;width:70%;margin-bottom:8px"></div>
        <div class="skeleton" style="height:11px;width:90%;margin-bottom:14px"></div>
        <div class="skeleton" style="height:30px;width:100%"></div>
      </div>
    </div>`).join('');
}

// ─── TOAST ───────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${icons[type] || ''}</span> ${escapeHTML(msg)}`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.classList.add('toast-exit'), 3000);
  setTimeout(() => el.remove(), 3400);
}

// ─── HELPERS ─────────────────────────────────────────────────
function getCategory(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  const docTypes = ['pdf','msword','vnd.openxmlformats','vnd.ms-','text/','application/json','application/xml'];
  if (docTypes.some(t => mime.includes(t))) return 'document';
  const archiveTypes = ['zip','x-rar','x-tar','gzip','x-7z','x-bzip'];
  if (archiveTypes.some(t => mime.includes(t))) return 'archive';
  return 'other';
}

function iconClass(category) {
  const map = { document: 'icon-document', video: 'icon-video', audio: 'icon-audio', archive: 'icon-archive' };
  return map[category] || 'icon-other';
}

function categoryEmoji(category) {
  const map = { document: '📄', video: '🎬', audio: '🎵', archive: '📦', other: '📎' };
  return map[category] || '📎';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts.toMillis();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'ahora';
  if (mins < 60)  return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  return `${days}d`;
}

function expiryBadgeHTML(expiresAt) {
  if (!expiresAt) return '';
  const diff = expiresAt.toMillis() - Date.now();
  const days = Math.ceil(diff / 86400000);
  if (days <= 0) return `<span class="file-expiry expiry-urgent">Expirado</span>`;
  if (days <= 2) return `<span class="file-expiry expiry-urgent">Expira en ${days}d</span>`;
  if (days <= 4) return `<span class="file-expiry expiry-soon">Expira en ${days}d</span>`;
  return `<span class="file-expiry expiry-ok">Expira en ${days}d</span>`;
}

function truncateName(name, max) {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? '.' + name.split('.').pop() : '';
  const base = name.substring(0, max - ext.length - 1);
  return base + '…' + ext;
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
