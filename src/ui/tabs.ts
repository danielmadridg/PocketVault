import { $ } from '../lib/dom';
import { icon } from '../lib/icons';
import { getState, setState, subscribe, type State } from '../store';
import type { Tab } from '../types';
import { tabCounts } from './selectors';

const TAB_KEY = 'pv:tab';

function tabs(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('#tabs [role="tab"]'));
}

function indicator(): HTMLElement {
  let el = document.querySelector<HTMLElement>('#tabs .tabs-indicator');
  if (!el) {
    el = document.createElement('span');
    el.className = 'tabs-indicator';
    el.setAttribute('aria-hidden', 'true');
    $('#tabs').append(el);
  }
  return el;
}

/** Glide the brass underline under the active tab. `instant` for resize and first paint. */
function placeIndicator(instant = false) {
  const active = tabs().find((t) => t.getAttribute('aria-selected') === 'true');
  const bar = indicator();
  if (!active) return;
  bar.classList.toggle('is-instant', instant);
  const inset = 12;
  bar.style.setProperty('--x', `${active.offsetLeft + inset}px`);
  bar.style.setProperty('--w', `${Math.max(12, active.offsetWidth - inset * 2)}px`);
  if (instant) void bar.offsetWidth;
}

/** Mark the selected tab and glide the underline to it. Called from the library render. */
let shownTab: Tab | null = null;

export function showSelectedTab(tab: Tab) {
  if (tab === shownTab) return;
  shownTab = tab;
  for (const el of tabs()) {
    const selected = el.dataset.tab === tab;
    el.setAttribute('aria-selected', String(selected));
    el.tabIndex = selected ? 0 : -1;
  }
  placeIndicator();
}

function renderCounts(state: State) {
  const counts = tabCounts(state);
  for (const tab of tabs()) {
    const count = counts[tab.dataset.tab as Tab];
    const label = tab.querySelector('.tab-count')!;
    const text = count ? String(count) : '';
    if (label.textContent !== text) label.textContent = text;
  }
  const secret = $('#tabs [data-tab="secret"]');
  const open = state.vault === 'unlocked';
  if (secret.classList.contains('is-open') !== open || !secret.querySelector('.tab-lock svg')) {
    secret.classList.toggle('is-open', open);
    secret.querySelector('.tab-lock')!.innerHTML = icon(open ? 'unlock' : 'lock', 13).value;
  }
  // Counts change tab widths.
  placeIndicator(true);
}

export function initTabs() {
  const list = $('#tabs');
  list.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (tab) select(tab.dataset.tab as Tab);
  });
  // Roving focus: arrows move between tabs, as the ARIA tabs pattern expects.
  list.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const all = tabs();
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = all[(index + (event.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
    next.focus();
    select(next.dataset.tab as Tab);
  });

  subscribe((state, changed) => {
    if (changed.has('tab')) {
      try {
        if (state.tab !== 'secret') sessionStorage.setItem(TAB_KEY, state.tab);
      } catch {
        // Storage can be unavailable; the tab just won't be remembered.
      }
      tabs().find((t) => t.dataset.tab === state.tab)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
    if (changed.has('items') || changed.has('vault') || changed.has('pendingDelete')) renderCounts(state);
  });

  new ResizeObserver(() => placeIndicator(true)).observe(list);

  // A zero-height marker right above the tabs tells when the strip is stuck under the top bar.
  const sentinel = document.createElement('div');
  sentinel.className = 'tabs-sentinel';
  sentinel.setAttribute('aria-hidden', 'true');
  $('#composer').append(sentinel);
  const stickTop = () => Number.parseFloat(getComputedStyle(list).top) || 0;
  let observer: IntersectionObserver | null = null;
  const observe = () => {
    observer?.disconnect();
    observer = new IntersectionObserver(([entry]) => list.classList.toggle('is-stuck', !entry.isIntersecting && entry.boundingClientRect.top < stickTop() + 1), {
      rootMargin: `-${stickTop() + 1}px 0px 0px 0px`,
    });
    observer.observe(sentinel);
  };
  observe();
  matchMedia('(max-width: 680px)').addEventListener('change', observe);
  void document.fonts?.ready.then(() => placeIndicator(true));

  try {
    const saved = sessionStorage.getItem(TAB_KEY) as Tab | null;
    if (saved && tabs().some((t) => t.dataset.tab === saved)) setState({ tab: saved });
  } catch {
    // Ignore.
  }
  showSelectedTab(getState().tab);
  renderCounts(getState());
}

function select(tab: Tab) {
  if (getState().tab !== tab) setState({ tab });
}
