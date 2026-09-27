import { esc, raw, type Raw } from './dom';

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/gi;

/** A note whose whole content is one URL is shown as a link. */
export function singleUrl(text: string): URL | null {
  const trimmed = text.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

/** Escape text and turn http(s) URLs into links that open in a new tab. */
export function linkify(text: string): Raw {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const index = match.index ?? 0;
    out += esc(text.slice(last, index));
    const url = match[0];
    out += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>`;
    last = index + url.length;
  }
  return raw(out + esc(text.slice(last)));
}
