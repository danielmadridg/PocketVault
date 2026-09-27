import type { User } from 'firebase/auth';
import type { Item, Secrets, Tab, Upload, VaultStatus } from './types';

export interface State {
  user: User | null;
  items: Item[];
  itemsLoaded: boolean;
  uploads: Upload[];
  tab: Tab;
  query: string;
  vault: VaultStatus;
  /** Decrypted fields of hidden-section items, only while the vault is unlocked. */
  revealed: ReadonlyMap<string, Secrets>;
  /** Items deleted by the user that are still inside the undo window. */
  pendingDelete: ReadonlySet<string>;
  quotaBytes: number;
  online: boolean;
  /** The composer's "Oculto" toggle is armed. */
  composeSecret: boolean;
}

export type StateKey = keyof State;
type Listener = (state: State, changed: ReadonlySet<StateKey>) => void;

const state: State = {
  user: null,
  items: [],
  itemsLoaded: false,
  uploads: [],
  tab: 'all',
  query: '',
  vault: 'loading',
  revealed: new Map(),
  pendingDelete: new Set(),
  quotaBytes: 0,
  online: navigator.onLine,
  composeSecret: false,
};

const listeners = new Set<Listener>();
let changed = new Set<StateKey>();
let scheduled = false;

export function getState(): Readonly<State> {
  return state;
}

/** Shallow-merge a patch. Listeners run once per microtask, however many patches land. */
export function setState(patch: Partial<State>) {
  for (const key of Object.keys(patch) as StateKey[]) {
    if (state[key] === patch[key]) continue;
    (state as unknown as Record<StateKey, unknown>)[key] = patch[key];
    changed.add(key);
  }
  if (changed.size && !scheduled) {
    scheduled = true;
    queueMicrotask(flush);
  }
}

function flush() {
  scheduled = false;
  const batch = changed;
  changed = new Set();
  for (const listener of listeners) listener(state, batch);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateUpload(id: string, patch: Partial<Upload>) {
  setState({ uploads: state.uploads.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
}

export function removeUpload(id: string) {
  setState({ uploads: state.uploads.filter((u) => u.id !== id) });
}
