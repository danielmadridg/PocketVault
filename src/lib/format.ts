import { DAY_MS, EXPIRY_MS } from '../config';

const num1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${num1.format(bytes / 1024 ** i)} ${units[i]}`;
}

/** Compact age for cards: "ahora", "5 min", "3 h", "2 d". */
export function ageShort(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'ahora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** Compact countdown for the last day: "Caduca en 5 h", "Caduca en 20 min". */
export function timeLeftShort(expiresAt: number, now = Date.now()): string {
  const min = Math.max(1, Math.ceil((expiresAt - now) / 60_000));
  return min < 60 ? `Caduca en ${min} min` : `Caduca en ${Math.round(min / 60)} h`;
}

export function fullDate(ms: number): string {
  return dateTime.format(ms);
}

/** Remaining life in [0, 1] for the fuse; 1 = just deposited. */
export function lifeLeft(expiresAt: number, now = Date.now()): number {
  return Math.min(1, Math.max(0, (expiresAt - now) / EXPIRY_MS));
}

export function expiryText(expiresAt: number, now = Date.now()): string {
  const diff = expiresAt - now;
  if (diff <= 0) return 'Caducado';
  if (diff < 3_600_000) return 'Se borra en menos de 1 hora';
  if (diff < DAY_MS) {
    const h = Math.round(diff / 3_600_000);
    return `Se borra en ${h} ${h === 1 ? 'hora' : 'horas'}`;
  }
  const d = Math.ceil(diff / DAY_MS);
  return `Se borra en ${d} ${d === 1 ? 'día' : 'días'}`;
}

/** "captura-20260927-153012.png" — for clipboard images that arrive as "image.png". */
export function pastedFileName(type: string, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const ext = type.split('/')[1]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'bin';
  return `captura-${stamp}.${ext}`;
}

/** First line of a note, trimmed to fit a card title. */
export function noteTitle(text: string): string {
  const line = text.trim().split('\n')[0].trim();
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}
