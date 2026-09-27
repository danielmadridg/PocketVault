import { $, html, setHTML } from '../lib/dom';
import { icon } from '../lib/icons';
import { reducedMotion, timing } from './motion';

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

/** Apply a change to the stack and let the other toasts glide to their new rows. */
function reflow(container: HTMLElement, change: () => void) {
  const before = new Map(Array.from(container.children, (t) => [t, t.getBoundingClientRect()] as const));
  change();
  if (reducedMotion()) return;
  for (const t of container.children) {
    const from = before.get(t);
    if (!from) continue;
    const dy = from.top - t.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    t.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: timing.move, easing: timing.spring });
  }
}

function dismiss(el: HTMLElement) {
  if (el.classList.contains('is-leaving')) return;
  // A toast leaving while the pointer rests on it must not leave its owner paused forever.
  holds.get(el)?.(false);
  holds.delete(el);
  el.classList.add('is-leaving');
  const narrow = matchMedia('(max-width: 640px)').matches;
  // It slides toward the screen edge, then the rest of the stack closes the gap.
  el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: narrow ? 'translateY(8px)' : 'translateX(28px)' }], {
    duration: timing.exit,
    easing: timing.easeIn,
    fill: 'forwards',
  })
    .finished.then(() => el.isConnected && reflow(el.parentElement as HTMLElement, () => el.remove()))
    .catch(() => el.remove());
}

export interface ToastHandle {
  dismiss(): void;
}

export function toast(message: string, options: ToastOptions = {}): ToastHandle {
  const container = $('#toasts');
  const { kind = 'info', action, duration = kind === 'error' ? 6000 : 3200, key, onHold } = options;

  if (key) {
    const previous = live.get(key);
    if (previous) dismiss(previous);
  }

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

  reflow(container, () => container.append(el));
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
