/**
 * Motion primitives shared by the UI: one timing family (read once from the CSS tokens),
 * FLIP for layout changes, slides for screen changes, and one reduced-motion switch.
 * Everything runs on the Web Animations API, which never blocks input (View Transitions
 * would make the page ignore clicks while they play). Only intent animates: callers
 * decide when something moved. A motion failure must never break the caller.
 */

const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
export const reducedMotion = () => reduceQuery.matches;

const FALLBACK_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const easingCache = new Map<string, string>();

/** A CSS easing token, or a safe fallback where the browser lacks linear() (Safari < 17.2). */
function easing(name: string): string {
  let value = easingCache.get(name);
  if (value === undefined) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    value = raw && CSS.supports('transition-timing-function', raw) ? raw : FALLBACK_EASE;
    easingCache.set(name, value);
  }
  return value;
}

const durationCache = new Map<string, number>();

function duration(name: string, fallback: number): number {
  if (reducedMotion()) return 1;
  let value = durationCache.get(name);
  if (value === undefined) {
    value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback;
    durationCache.set(name, value);
  }
  return value;
}

export const timing = {
  get ease() {
    return easing('--ease-glide');
  },
  get easeIn() {
    return easing('--ease-in');
  },
  get spring() {
    return easing('--ease-spring');
  },
  get move() {
    return duration('--dur-move', 440);
  },
  get enter() {
    return duration('--dur-enter', 300);
  },
  get exit() {
    return duration('--dur-exit', 160);
  },
  get slide() {
    return duration('--dur-slide', 320);
  },
};

/** Run an animation; if the browser rejects it, skip the motion instead of throwing. */
function animate(el: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  try {
    return el.animate(keyframes, options);
  } catch {
    return null;
  }
}

export type SlideDirection = 'forward' | 'back' | 'up';

function offset(direction: SlideDirection, distance: number): string {
  return direction === 'up' ? `translateY(${distance / 3}px)` : `translateX(${direction === 'forward' ? distance : -distance}px)`;
}

/** New content slides in from the side it comes from. */
export function slideIn(el: Element, direction: SlideDirection, distance = 40, delay = 40) {
  if (reducedMotion()) return;
  animate(el, [{ opacity: 0, transform: offset(direction, distance) }, { opacity: 1, transform: 'none' }], {
    duration: timing.slide,
    easing: timing.ease,
    delay,
    fill: 'backwards',
  });
}

const moving = new WeakMap<Element, Animation>();

/** A new deposit drops in from above (from the composer); everything else rises into place. */
export function enter(el: Element, index = 0, mode: 'rise' | 'drop' | 'fade' = 'rise') {
  if (reducedMotion()) return;
  const delay = mode === 'fade' ? 0 : Math.min(index, 10) * 24;
  if (mode !== 'fade') {
    const from = mode === 'drop' ? 'translateY(-14px) scale(0.96)' : 'translateY(10px) scale(0.985)';
    const move = animate(el, [{ transform: from }, { transform: 'none' }], { duration: timing.move, easing: timing.spring, delay, fill: 'backwards' });
    if (move) moving.set(el, move);
  }
  animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: mode === 'fade' ? 160 : timing.enter, easing: 'ease-out', delay, fill: 'backwards' });
}

// ─── Measuring and ghosts ─────────────────────────────────────

export type Rects = Map<Element, DOMRect>;

export function measure(elements: Iterable<Element>): Rects {
  const rects: Rects = new Map();
  for (const el of elements) if (el.isConnected) rects.set(el, el.getBoundingClientRect());
  return rects;
}

function onScreen(rect: DOMRect, margin = 0.25): boolean {
  const extra = innerHeight * margin;
  return rect.bottom > -extra && rect.top < innerHeight + extra && rect.width > 0;
}

/** A frozen, inert copy of `el` drawn in `layer` exactly where `rect` was on screen. */
function ghostOf(el: Element, rect: DOMRect, layer: HTMLElement, layerRect: DOMRect): HTMLElement {
  const ghost = el.cloneNode(true) as HTMLElement;
  for (const node of [ghost, ...ghost.querySelectorAll('[id], [tabindex], [data-id], [data-upload]')]) {
    node.removeAttribute('id');
    node.removeAttribute('tabindex');
    node.removeAttribute('data-id');
    node.removeAttribute('data-upload');
  }
  ghost.classList.add('is-ghost');
  ghost.classList.remove('is-new');
  Object.assign(ghost.style, {
    position: 'absolute',
    left: `${rect.left - layerRect.left}px`,
    top: `${rect.top - layerRect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
  });
  layer.append(ghost);
  return ghost;
}

function retire(ghost: HTMLElement, keyframes: Keyframe[], ms: number) {
  const run = animate(ghost, keyframes, { duration: ms, easing: timing.easeIn, fill: 'forwards' });
  if (!run) return ghost.remove();
  run.finished.then(() => ghost.remove(), () => ghost.remove());
}

export interface FlipOptions {
  /** Short and quiet: for changes made while typing (search). */
  quick?: boolean;
  /** Removed elements that must vanish without a ghost (e.g. decrypted cards on lock). */
  noGhost?: (el: Element) => boolean;
}

/**
 * Animate from the measured `before` layout to the current one:
 * moved elements glide to their new place, new ones enter, and removed ones
 * leave as a ghost drawn in `ghostLayer` at their old position.
 */
export function flip(before: Rects, current: Iterable<Element>, ghostLayer: HTMLElement, options: FlipOptions = {}) {
  if (reducedMotion()) return;
  const elements = [...current];
  // `before` holds where things were SEEN (mid-flight included). Stop old moves, then read
  // every new position in one pass before writing any animation: no layout thrash.
  for (const el of elements) moving.get(el)?.cancel();
  const layerRect = ghostLayer.getBoundingClientRect();
  const after = elements.map((el) => el.getBoundingClientRect());
  const seen = new Set<Element>(elements);
  const moveDuration = options.quick ? 280 : timing.move;
  const moveEasing = timing.spring;
  let entering = 0;

  elements.forEach((el, i) => {
    const from = before.get(el);
    const to = after[i];
    if (!from) {
      if (onScreen(to)) enter(el, entering++, options.quick ? 'fade' : el.classList.contains('is-new') ? 'drop' : 'rise');
      return;
    }
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    // Nothing on screen before or after: no one would see it move.
    if (!onScreen(from) && !onScreen(to)) return;
    const animation = animate(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
      duration: moveDuration,
      easing: moveEasing,
    });
    if (!animation) return;
    moving.set(el, animation);
    // Anything changing row (or group) flies over the cards it crosses.
    const flying = Math.abs(dy) > to.height * 0.5 || Math.abs(dx) > to.width * 1.5;
    if (flying && el instanceof HTMLElement) {
      el.style.zIndex = '2';
      const release = () => {
        // Only the flight that currently owns the card may clear it.
        if (moving.get(el) === animation) el.style.removeProperty('z-index');
      };
      animation.finished.then(release, release);
    }
  });

  for (const [el, rect] of before) {
    if (seen.has(el) || el.isConnected || !onScreen(rect, 0) || options.noGhost?.(el)) continue;
    const ghost = ghostOf(el, rect, ghostLayer, layerRect);
    retire(
      ghost,
      options.quick
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'translateY(6px) scale(0.92)' },
          ],
      options.quick ? 120 : timing.exit + 20,
    );
  }
}

/**
 * Screen change (tab switch): what was on screen leaves as ghosts toward the opposite
 * side, while the caller slides the new content in. Plain animations: input keeps working.
 */
export function slideAway(before: Rects, ghostLayer: HTMLElement, direction: SlideDirection, noGhost?: (el: Element) => boolean) {
  if (reducedMotion()) return;
  const layerRect = ghostLayer.getBoundingClientRect();
  const away = direction === 'forward' ? 'back' : direction === 'back' ? 'forward' : 'up';
  for (const [el, rect] of before) {
    if (!onScreen(rect, 0) || noGhost?.(el)) continue;
    moving.get(el)?.cancel();
    const ghost = ghostOf(el, rect, ghostLayer, layerRect);
    retire(ghost, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: offset(away, 40) }], timing.exit);
  }
}

/** One short horizontal shake (wrong password, failed upload). */
export function shake(el: Element) {
  if (reducedMotion()) return;
  animate(
    el,
    [
      { transform: 'none' },
      { transform: 'translateX(-5px)' },
      { transform: 'translateX(5px)' },
      { transform: 'translateX(-3px)' },
      { transform: 'none' },
    ],
    { duration: 280, easing: 'ease-out' },
  );
}
