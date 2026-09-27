import { TAB_FILTER } from '../lib/category';
import { viewOf } from '../services/content';
import type { State } from '../store';
import type { Item, Tab, Upload } from '../types';

export function matchesQuery(item: Item, query: string, state: State): boolean {
  if (!query) return true;
  const view = viewOf(item, state.revealed);
  if (view.sealed) return false;
  const haystack = `${view.name}\n${item.category === 'note' ? view.content : ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function inTab(item: Item, tab: Tab): boolean {
  if (tab === 'secret') return item.isSecret;
  if (item.isSecret) return false;
  if (tab === 'pinned') return item.isFavorite;
  return TAB_FILTER[tab](item.category);
}

/** Items on screen for the current tab and search, in display order. */
export function visibleItems(state: State): Item[] {
  const query = state.query.trim();
  return state.items.filter(
    (item) => !state.pendingDelete.has(item.id) && inTab(item, state.tab) && matchesQuery(item, query, state),
  );
}

export function visibleUploads(state: State): Upload[] {
  if (state.query.trim()) return [];
  return state.uploads.filter((u) => {
    if (state.tab === 'secret') return u.secret;
    if (u.secret || state.tab === 'pinned') return false;
    return TAB_FILTER[state.tab](u.category);
  });
}

export function tabCounts(state: State): Record<Tab, number | null> {
  const counts: Record<Tab, number | null> = { all: 0, pinned: 0, images: 0, documents: 0, videos: 0, notes: 0, other: 0, secret: 0 };
  for (const item of state.items) {
    if (state.pendingDelete.has(item.id)) continue;
    if (item.isSecret) {
      counts.secret!++;
      continue;
    }
    counts.all!++;
    if (item.isFavorite) counts.pinned!++;
    for (const tab of ['images', 'documents', 'videos', 'notes', 'other'] as const) {
      if (TAB_FILTER[tab](item.category)) counts[tab]!++;
    }
  }
  if (state.vault !== 'unlocked') counts.secret = null;
  return counts;
}
