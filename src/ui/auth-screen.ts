import { $ } from '../lib/dom';
import { authMessage, completeRedirect, resetPassword, signIn, signInWithGoogle, signUp } from '../services/auth';

let mode: 'signin' | 'signup' = 'signin';

function message(text: string, info = false) {
  const el = $('#auth-message');
  el.textContent = text;
  el.classList.toggle('is-info', info);
  el.hidden = !text;
}

function setMode(next: typeof mode) {
  mode = next;
  const signup = mode === 'signup';
  $('#auth-title').textContent = signup ? 'Crear cuenta' : 'Entrar';
  $('#auth-submit').textContent = signup ? 'Crear cuenta' : 'Entrar';
  $('#auth-mode').textContent = signup ? '¿Ya tienes cuenta? Entra' : '¿Primera vez? Crea una cuenta';
  $('#auth-forgot').hidden = signup;
  $<HTMLInputElement>('#auth-password').autocomplete = signup ? 'new-password' : 'current-password';
  message('');
}

function busy(on: boolean) {
  for (const id of ['#auth-submit', '#google-btn']) {
    const btn = $<HTMLButtonElement>(id);
    btn.disabled = on;
    btn.setAttribute('aria-busy', String(on));
  }
}

export function initAuthScreen() {
  const form = $<HTMLFormElement>('#auth-form');
  const email = $<HTMLInputElement>('#auth-email');
  const password = $<HTMLInputElement>('#auth-password');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!email.value.trim()) return message('Escribe tu correo.'), email.focus();
    if (password.value.length < 6) return message('La contraseña necesita al menos 6 caracteres.'), password.focus();
    busy(true);
    message('');
    try {
      await (mode === 'signup' ? signUp : signIn)(email.value.trim(), password.value);
      // onAuthStateChanged takes it from here.
    } catch (err) {
      message(authMessage(err) ?? '');
      busy(false);
    }
  });

  $('#google-btn').addEventListener('click', async () => {
    busy(true);
    message('');
    try {
      await signInWithGoogle();
    } catch (err) {
      message(authMessage(err) ?? '');
    } finally {
      busy(false);
    }
  });

  $('#auth-mode').addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));

  $('#auth-forgot').addEventListener('click', async () => {
    const address = email.value.trim();
    if (!address) {
      message('Escribe tu correo arriba y vuelve a pulsar aquí.');
      email.focus();
      return;
    }
    try {
      await resetPassword(address);
      message(`Si existe una cuenta con ${address}, te llegará un enlace para elegir otra contraseña.`, true);
    } catch (err) {
      message(authMessage(err) ?? '');
    }
  });

  completeRedirect().catch((err) => message(authMessage(err) ?? ''));
}

export function resetAuthScreen() {
  busy(false);
  $<HTMLInputElement>('#auth-password').value = '';
}
