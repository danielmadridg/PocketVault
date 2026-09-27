/** Trusted HTML. Only {@link html} and {@link raw} create it. */
export class Raw {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

export const raw = (value: string) => new Raw(value);

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function render(value: unknown): string {
  if (value == null || value === false) return '';
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return esc(value);
}

/** Tagged template that escapes every interpolation unless it is {@link Raw}. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}

export function setHTML(el: Element, content: Raw) {
  el.innerHTML = content.value;
}

export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled;
  if (target instanceof HTMLInputElement) {
    const textual = ['text', 'search', 'email', 'password', 'url', 'tel', 'number'];
    return textual.includes(target.type) && !target.readOnly && !target.disabled;
  }
  return false;
}

export const IS_APPLE = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
export const MOD_LABEL = IS_APPLE ? '⌘' : 'Ctrl';

/** Any modal <dialog> currently open? Global shortcuts stand down while one is. */
export function modalOpen(): boolean {
  return document.querySelector('dialog[open]') !== null;
}

export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
