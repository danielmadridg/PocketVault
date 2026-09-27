/** Long edge of stored thumbnails: sharp on a 2x screen at card size, ~20 KB as WebP. */
const THUMB_EDGE = 480;
const MAX_DECODE_BYTES = 60 * 1024 * 1024;

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

async function draw(source: CanvasImageSource, width: number, height: number): Promise<string | null> {
  if (!width || !height) return null;
  const scale = Math.min(1, THUMB_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  let blob = await canvasToBlob(canvas, 'image/webp', 0.8);
  // Safari cannot encode WebP and silently falls back to PNG, which is 10x larger.
  if (!blob || blob.type !== 'image/webp') blob = await canvasToBlob(canvas, 'image/jpeg', 0.82);
  return blob ? blobToDataURL(blob) : null;
}

async function imageThumbnail(file: Blob): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await draw(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function once(target: EventTarget, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    target.addEventListener(event, () => resolve(), { once: true });
    target.addEventListener('error', () => reject(new Error(`${event} failed`)), { once: true });
  });
}

async function videoThumbnail(file: Blob): Promise<string | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await once(video, 'loadeddata');
    const seek = once(video, 'seeked');
    video.currentTime = Math.min(1, (video.duration || 0) * 0.1);
    await seek;
    return await draw(video, video.videoWidth, video.videoHeight);
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Data-URL thumbnail for images and videos, or null. Never throws. */
export async function makeThumbnail(file: Blob): Promise<string | null> {
  try {
    if (file.type.startsWith('image/') && file.size <= MAX_DECODE_BYTES) return await withTimeout(imageThumbnail(file), 8000);
    if (file.type.startsWith('video/')) return await withTimeout(videoThumbnail(file), 8000);
  } catch {
    // Formats the browser cannot decode (HEIC on Chrome, some codecs) just get an icon.
  }
  return null;
}

/** The async clipboard only accepts PNG images. */
export async function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const png = await canvasToBlob(canvas, 'image/png');
  if (!png) throw new Error('PNG encoding failed');
  return png;
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
