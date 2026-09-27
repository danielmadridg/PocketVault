import type { Category, Tab } from '../types';
import type { IconName } from './icons';

const EXT: Record<string, Category> = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', avif: 'image', heic: 'image', heif: 'image', svg: 'image', bmp: 'image',
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio', opus: 'audio',
  pdf: 'document', doc: 'document', docx: 'document', xls: 'document', xlsx: 'document', ppt: 'document', pptx: 'document',
  odt: 'document', ods: 'document', odp: 'document', txt: 'document', md: 'document', csv: 'document', json: 'document',
  xml: 'document', rtf: 'document', html: 'document', log: 'document', yml: 'document', yaml: 'document',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive', xz: 'archive',
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** MIME first, extension as fallback — Windows often reports an empty type. */
export function categoryOf(type: string, name: string): Category {
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (/pdf|msword|officedocument|ms-excel|ms-powerpoint|opendocument|^text\/|json|xml|rtf/.test(type)) return 'document';
  if (/zip|rar|tar|gzip|7z|bzip|compressed/.test(type)) return 'archive';
  return EXT[extensionOf(name)] ?? 'other';
}

export const TAB_FILTER: Record<Exclude<Tab, 'secret'>, (c: Category) => boolean> = {
  all: () => true,
  pinned: () => true,
  images: (c) => c === 'image',
  documents: (c) => c === 'document',
  videos: (c) => c === 'video',
  notes: (c) => c === 'note',
  other: (c) => c === 'audio' || c === 'archive' || c === 'other',
};

const LABEL: Record<Category, string> = {
  image: 'Imagen', video: 'Vídeo', audio: 'Audio', document: 'Documento', archive: 'Comprimido', other: 'Archivo', note: 'Nota',
};

const ICON: Record<Category, IconName> = {
  image: 'image', video: 'video', audio: 'music', document: 'fileText', archive: 'archive', other: 'file', note: 'note',
};

export function kindOf(category: Category, name: string, isLink = false): { label: string; icon: IconName } {
  if (category === 'note') return isLink ? { label: 'Enlace', icon: 'link' } : { label: 'Nota', icon: 'note' };
  const ext = extensionOf(name);
  if (category === 'document' && ext && ext.length <= 4) return { label: ext.toUpperCase(), icon: 'fileText' };
  return { label: LABEL[category], icon: ICON[category] };
}

/** Small text-like files are shown inline in the preview. */
export function isTextPreviewable(type: string, name: string, size: number): boolean {
  if (size > 512 * 1024) return false;
  if (/^text\/|json|xml|javascript|yaml/.test(type)) return true;
  return ['txt', 'md', 'csv', 'json', 'log', 'xml', 'yml', 'yaml', 'ini', 'env', 'ts', 'js', 'py', 'css', 'html', 'sh'].includes(extensionOf(name));
}
