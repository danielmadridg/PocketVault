import { $ } from '../lib/dom';
import { icon } from '../lib/icons';
import { getState, setState, subscribe, type State } from '../store';
import type { Tab } from '../types';
import { tabCounts } from './selectors';

const TAB_KEY = 'pv:tab';

function tabs(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('#tabs [role="tab"]'));
}

function render(state: State) {
  const counts = tabCounts(state);
  for (const tab of tabs()) {
    const key = tab.dataset.tab as Tab;
    const selected = key === state.tab;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const count = counts[key];
    tab.querySelector('.tab-count')!.textContent = count ? String(count) : '';
  }
  const secret = $('#tabs [data-tab="secret"]');
  const open = state.vault === 'unlocked';
  if (secret.classList.contains('is-open') !== open || !secret.querySelector('.tab-lock svg')) {
    secret.classList.toggle('is-open', open);
    secret.querySelector('.tab-lock')!.innerHTML = icon(open ? 'unlock' : 'lock', 13).value;
  }
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
      tabs().find((t) => t.dataset.tab === state.tab)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    if (changed.has('tab') || changed.has('items') || changed.has('vault') || changed.has('pendingDelete')) render(state);
  });

  try {
    const saved = sessionStorage.getItem(TAB_KEY) as Tab | null;
    if (saved && tabs().some((t) => t.dataset.tab === saved)) setState({ tab: saved });
  } catch {
    // Ignore.
  }
  render(getState());
}

function select(tab: Tab) {
  if (getState().tab !== tab) setState({ tab });
}
