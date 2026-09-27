import type { Sealed } from '../types';

type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** OWASP 2023 recommendation for PBKDF2-HMAC-SHA256. */
export const PBKDF2_ITERATIONS = 600_000;

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function toBase64(data: ArrayBuffer | Bytes): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Bytes {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Key-encryption key derived from the user's password. Never leaves memory. */
export async function deriveKey(password: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Import the data key as non-extractable: script can use it but never read it back. */
export function importDataKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptBytes(key: CryptoKey, data: BufferSource): Promise<{ iv: Bytes; data: ArrayBuffer }> {
  const iv = randomBytes(12);
  return { iv, data: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data) };
}

/** Throws if the key is wrong or the ciphertext was tampered with (GCM tag check). */
export function decryptBytes(key: CryptoKey, iv: Bytes, data: BufferSource): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
}

export async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const { iv, data } = await encryptBytes(key, encoder.encode(JSON.stringify(value)));
  return { iv: toBase64(iv), data: toBase64(data) };
}

export async function unseal<T>(key: CryptoKey, sealed: Sealed): Promise<T> {
  const plain = await decryptBytes(key, fromBase64(sealed.iv), fromBase64(sealed.data));
  return JSON.parse(decoder.decode(plain)) as T;
}
