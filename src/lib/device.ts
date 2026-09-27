const KEY = 'pv:device';

function read(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/** Stable per-browser id, stored on each item so other devices can tell who uploaded it. */
export const DEVICE_ID = read();
