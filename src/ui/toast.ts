import { $, html, setHTML } from '../lib/dom';
import { icon } from '../lib/icons';

interface ToastOptions {
  kind?: 'info' | 'error';
  action?: { label: string; run: () => void };
  duration?: number;
  /** Replaces an existing toast with the same key instead of stacking. */
  key?: string;
  /** Called with true while the pointer rests on the toast, false when it leaves. */
  onHold?: (held: boolean) => void;
}

const MAX_VISIBLE = 3;
/** Time left after the pointer leaves a paused toast. */
export const RESUME_MS = 1500;
const live = new Map<string, HTMLElement>();

const holds = new Map<HTMLElement, (held: boolean) => void>();

function dismiss(el: HTMLElement) {
  if (el.classList.contains('is-leaving')) return;
  // A toast leaving while the pointer rests on it must not leave its owner paused forever.
  holds.get(el)?.(false);
  holds.delete(el);
  el.classList.add('is-leaving');
  el.addEventListener('transitionend', () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 400);
}

export interface ToastHandle {
  dismiss(): void;
}

export function toast(message: string, options: ToastOptions = {}): ToastHandle {
  const container = $('#toasts');
  const { kind = 'info', action, duration = kind === 'error' ? 6000 : 3200, key, onHold } = options;

  if (key) live.get(key)?.remove();

  const el = document.createElement('div');
  el.className = `toast${kind === 'error' ? ' is-error' : ''}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  setHTML(
    el,
    html`<span class="toast-icon">${icon(kind === 'error' ? 'x' : 'check', 16)}</span>
      <span class="toast-text">${message}</span>
      ${action ? html`<button type="button" class="toast-action">${action.label}</button>` : ''}`,
  );

  let timer = window.setTimeout(() => dismiss(el), duration);
  // Pause while the pointer is over it, so an undo can be reached.
  el.addEventListener('pointerenter', () => {
    if (el.classList.contains('is-leaving')) return;
    clearTimeout(timer);
    if (onHold) {
      holds.set(el, onHold);
      onHold(true);
    }
  });
  el.addEventListener('pointerleave', () => {
    if (el.classList.contains('is-leaving')) return;
    timer = window.setTimeout(() => dismiss(el), RESUME_MS);
    holds.delete(el);
    onHold?.(false);
  });

  if (action) {
    el.querySelector('.toast-action')!.addEventListener('click', () => {
      clearTimeout(timer);
      action.run();
      dismiss(el);
    });
  }

  container.append(el);
  if (key) live.set(key, el);
  const visible = container.querySelectorAll<HTMLElement>('.toast:not(.is-leaving)');
  if (visible.length > MAX_VISIBLE) dismiss(visible[0]);
  return {
    dismiss: () => {
      clearTimeout(timer);
      dismiss(el);
    },
  };
}

export const toastError = (message: string): ToastHandle => toast(message, { kind: 'error' });
