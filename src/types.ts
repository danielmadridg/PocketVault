import type { Timestamp } from 'firebase/firestore';

export type Category = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other' | 'note';

export type Tab = 'all' | 'pinned' | 'images' | 'documents' | 'videos' | 'notes' | 'other' | 'secret';

/** AES-GCM ciphertext, both parts base64. */
export interface Sealed {
  iv: string;
  data: string;
}

/** Fields that live inside `sealed` for items in the hidden section. */
export interface Secrets {
  name: string;
  type?: string;
  content?: string;
  thumbnail?: string | null;
}

/**
 * Firestore document at users/{uid}/files/{id}.
 * Shape is backwards compatible with v1 documents (which lack device/sealed/fileIv).
 */
export interface ItemDoc {
  name: string;
  content?: string | null;
  size: number;
  type: string;
  category: Category;
  storagePath: string | null;
  downloadURL: string | null;
  thumbnail: string | null;
  isFavorite: boolean;
  isSecret: boolean;
  uploadedAt: Timestamp;
  expiresAt: Timestamp;
  device?: string;
  /** Hidden-section items: encrypted {@link Secrets}. Plain fields are placeholders. */
  sealed?: Sealed | null;
  /** Hidden-section files: IV used to encrypt the Storage object. */
  fileIv?: string | null;
  /** Tombstone: deletion started; the file and then the document are being removed. */
  deleting?: boolean;
}

export interface Item extends ItemDoc {
  id: string;
}

export type UploadState = 'queued' | 'uploading' | 'saving' | 'error';

export interface Upload {
  id: string;
  file: File;
  name: string;
  category: Category;
  secret: boolean;
  progress: number;
  state: UploadState;
  error?: string;
  /** Storage path of bytes that were uploaded before the upload failed. */
  landedPath?: string;
  createdAt: number;
}

export type VaultStatus = 'loading' | 'unreachable' | 'absent' | 'locked' | 'unlocked';
