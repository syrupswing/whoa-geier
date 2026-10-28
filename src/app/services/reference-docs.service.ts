import { Injectable, inject, signal } from '@angular/core';
import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { deleteObject, getDownloadURL, getStorage, ref, uploadBytesResumable } from 'firebase/storage';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';

/** What the storage rules accept: keep in step with storage.rules. */
export const UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
const UPLOAD_TYPES: Record<string, string> = {
  pdf: 'application/pdf', txt: 'text/plain',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif'
};

export interface ReferenceDoc {
  id: string;
  title: string;
  summary: string;
  text: string;
  source: 'paste' | 'url' | 'file';
  url?: string | null;
  /** True when the text was cut at the per-document limit. */
  truncated?: boolean;
  fetchedAt?: string;
  createdAt?: string;
  /** For an uploaded file: where it's stored, its original name, type and size in bytes. */
  storagePath?: string;
  fileName?: string;
  contentType?: string;
  size?: number;
}

/**
 * The reference library — flyers, guides and notes the family chat can answer from. Reads
 * come straight from Firestore; adding and refreshing go through Cloud Functions because
 * they fetch links and summarize server-side.
 */
@Injectable({
  providedIn: 'root'
})
export class ReferenceDocsService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);
  private readonly COLLECTION = 'referenceDocs';

  docs = signal<ReferenceDoc[]>([]);

  constructor() {
    if (this.firestoreService.isInitialized()) {
      this.firestoreService.subscribeToCollection<ReferenceDoc>(
        this.COLLECTION,
        (items) => this.docs.set(items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')))
      );
    }
  }

  /** Adds a doc from pasted text or a public link; throws with the server's message if it can't be read. */
  async add(input: { title?: string; text?: string; url?: string }): Promise<void> {
    const call = httpsCallable(getFunctions(), 'addReferenceDoc');
    await call(input);
  }

  /** The MIME type to upload a file as, or null if it isn't a PDF, photo or text file. Some browsers leave `type` empty. */
  uploadTypeFor(file: File): string | null {
    const byExtension = UPLOAD_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''];
    const type = file.type && Object.values(UPLOAD_TYPES).includes(file.type) ? file.type : byExtension;
    return type ?? null;
  }

  /**
   * Uploads a file to Storage, then has the server read it into the library. Throws a readable message
   * when the file isn't allowed or can't be read (the server also removes an upload it can't use).
   */
  async upload(file: File, title: string | undefined, onProgress: (percent: number) => void): Promise<void> {
    const uid = this.authService.currentUser()?.uid;
    if (!uid) throw new Error('Sign in to upload documents');
    const contentType = this.uploadTypeFor(file);
    if (!contentType) throw new Error('Upload a PDF, a photo (JPEG, PNG, WebP) or a text file');
    if (file.size > UPLOAD_MAX_BYTES) throw new Error('That file is too large (15 MB at most)');

    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
    const path = `documents/${uid}/${Date.now()}-${safeName}`;
    const task = uploadBytesResumable(ref(getStorage(getApp()), path), file, {
      contentType,
      customMetadata: { originalName: file.name.slice(0, 200) }
    });
    await new Promise<void>((resolve, reject) => {
      task.on(
        'state_changed',
        snap => onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
        () => reject(new Error('The upload failed. Check your connection and try again')),
        () => resolve()
      );
    });
    const call = httpsCallable(getFunctions(), 'addReferenceFile');
    await call({ path, title });
  }

  /**
   * Opens an uploaded file in a new tab. The tab is opened straight away, inside the tap that asked for it,
   * and pointed at the file once its link is ready, because browsers block a tab opened after a wait.
   */
  async openFile(doc: ReferenceDoc): Promise<void> {
    if (!doc.storagePath) return;
    const tab = window.open('', '_blank');
    try {
      const url = await getDownloadURL(ref(getStorage(getApp()), doc.storagePath));
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.assign(url);
      }
    } catch (err) {
      tab?.close();
      throw new Error("Couldn't open that file. It may have been removed");
    }
  }

  async refresh(id: string): Promise<void> {
    const call = httpsCallable(getFunctions(), 'refreshReferenceDoc');
    await call({ id });
  }

  /** Removes the entry and, for an uploaded file, the stored file with it. */
  async remove(doc: ReferenceDoc): Promise<boolean> {
    const ok = await this.firestoreService.deleteDocument(this.COLLECTION, doc.id);
    if (ok && doc.storagePath) {
      try {
        await deleteObject(ref(getStorage(getApp()), doc.storagePath));
      } catch (err) {
        console.error('Could not remove the stored file:', err);
      }
    }
    return ok;
  }
}
