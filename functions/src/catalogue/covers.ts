import { randomUUID } from 'node:crypto';

import { FieldValue, type Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { z } from 'zod';

import { recordAudit } from '../core/audit.js';
import { query, requestIdSchema } from '../core/callable.js';
import { errors } from '../core/errors.js';
import { db } from '../core/firebase.js';
import type { Actor } from '../core/rbac.js';
import { id } from '../core/schemas.js';

/** Largest cover accepted; the console shrinks photos to ~100 KB before sending. */
export const MAX_COVER_BYTES = 1_500_000;

export const IMAGE_TYPES: { type: string; ext: string; matches: (b: Buffer) => boolean }[] = [
  { type: 'image/jpeg', ext: 'jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', ext: 'png', matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/webp', ext: 'webp', matches: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

export function bucket() {
  const configured = process.env.FIREBASE_CONFIG ? (JSON.parse(process.env.FIREBASE_CONFIG) as { storageBucket?: string }).storageBucket : undefined;
  const project = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? 'demo-stories';
  return getStorage().bucket(configured || `${project}.firebasestorage.app`);
}

/** Public URL that works without Storage rules (Firebase download-token URL, emulator-aware). */
export function downloadUrl(bucketName: string, path: string, token: string) {
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}` : 'https://firebasestorage.googleapis.com';
  return `${host}/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

/** Public catalogues whose cover images staff may import by URL (no other hosts: no fetching arbitrary addresses). */
const COVER_HOSTS = new Set(['books.google.com', 'books.googleusercontent.com', 'covers.openlibrary.org']);

async function download(url: string): Promise<Buffer> {
  if (!COVER_HOSTS.has(new URL(url).hostname)) throw errors.invalid('Covers can only be imported from Google Books or Open Library.');
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw errors.conflict('COVER_UNAVAILABLE', "The cover couldn't be downloaded. Add it from a photo instead.");
  }
  if (!res.ok) throw errors.conflict('COVER_UNAVAILABLE', "The cover couldn't be downloaded. Add it from a photo instead.");
  const bytes = Buffer.from(await res.arrayBuffer());
  // Tiny images are "no cover" placeholders.
  if (bytes.length < 2000) throw errors.conflict('COVER_UNAVAILABLE', 'This book has no usable cover image online.');
  return bytes;
}

/**
 * Who may do what with a cover: book creators (e.g. branch managers) may add
 * a missing cover; changing or removing one is for catalogue editors.
 */
async function checkCoverRights(actor: Actor, tx: Transaction, previousPath: string | null, removing: boolean) {
  const editor = await actor.canCatalog('books.edit', tx);
  if (!editor) await actor.requireCatalog('books.create', tx);
  if (!editor && (previousPath || removing)) throw errors.forbidden('Only head office can change or remove a cover.');
}

/**
 * Sets (image: base64 JPEG/PNG/WebP) or removes (image: null) a title's cover.
 *
 * Storage can't take part in a Firestore transaction (which may also run more
 * than once), so the image is downloaded and uploaded first, once, to its
 * final path covers/{bookId}/{requestId}.{ext}; then a short transaction
 * re-checks the rights and the book and points it at the new file. If that
 * transaction fails, the uploaded file is deleted; once it commits, the
 * previous file is. A retried request finds its own file already set and
 * returns it (naturally idempotent, keyed by the requestId in the path).
 */
export const setCover = query(
  'books-setCover',
  z.strictObject({
    bookId: id,
    image: z.string().max(Math.ceil((MAX_COVER_BYTES * 4) / 3) + 4).nullable().default(null),
    /** Instead of `image`: a cover from a book-details search (Google Books / Open Library only). */
    imageUrl: z.url({ protocol: /^https$/ }).max(500).optional(),
    requestId: requestIdSchema,
  }),
  async ({ actor, input }) => {
    const ref = db.doc(`books/${input.bookId}`);
    const removing = input.image === null && !input.imageUrl;
    // Read and check before downloading or uploading anything.
    const current = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw errors.notFound('Book');
      await checkCoverRights(actor, tx, (snap.get('coverPath') as string | undefined) ?? null, removing);
      return snap;
    });
    const currentPath = (current.get('coverPath') as string | undefined) ?? null;
    if (currentPath?.startsWith(`covers/${input.bookId}/${input.requestId}.`)) {
      return { bookId: input.bookId, coverUrl: current.get('coverUrl') as string }; // this request already set it
    }
    if (removing && !currentPath) return { bookId: input.bookId, coverUrl: null };

    let cover: { coverUrl: string; coverPath: string } | null = null;
    if (!removing) {
      const bytes = input.imageUrl ? await download(input.imageUrl) : Buffer.from(input.image!, 'base64');
      const kind = IMAGE_TYPES.find((t) => t.matches(bytes));
      if (!kind) throw errors.invalid('The cover must be a JPEG, PNG or WebP image.');
      if (bytes.length > MAX_COVER_BYTES) throw errors.invalid('The cover image is too large (1.5 MB at most).');
      const b = bucket();
      const path = `covers/${input.bookId}/${input.requestId}.${kind.ext}`;
      const token = randomUUID();
      await b.file(path).save(bytes, {
        resumable: false,
        contentType: kind.type,
        metadata: { cacheControl: 'public, max-age=31536000, immutable', metadata: { firebaseStorageDownloadTokens: token } },
      });
      cover = { coverUrl: downloadUrl(b.name, path, token), coverPath: path };
    }

    let previousPath: string | null;
    try {
      previousPath = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw errors.notFound('Book');
        const previous = (snap.get('coverPath') as string | undefined) ?? null;
        await checkCoverRights(actor, tx, previous, removing);
        tx.update(ref, { coverUrl: cover?.coverUrl ?? null, coverPath: cover?.coverPath ?? null, updatedAt: FieldValue.serverTimestamp() });
        recordAudit(tx, { actorUid: actor.uid, actorEmail: actor.email, requestId: input.requestId }, null, {
          action: cover ? 'book.cover.set' : 'book.cover.remove',
          entityType: 'book',
          entityId: input.bookId,
          before: { coverPath: previous },
          after: { coverPath: cover?.coverPath ?? null },
        });
        return previous;
      });
    } catch (e) {
      // Not saved: remove the file just uploaded (unless a retry of this request saved it meanwhile).
      if (cover) {
        const now = await ref.get().catch(() => null);
        if (now?.get('coverPath') !== cover.coverPath) await bucket().file(cover.coverPath).delete({ ignoreNotFound: true }).catch(() => undefined);
      }
      throw e;
    }
    // Best effort: an orphaned old image is harmless; a failed delete must not fail the call.
    if (previousPath && previousPath !== cover?.coverPath) await bucket().file(previousPath).delete({ ignoreNotFound: true }).catch(() => undefined);
    return { bookId: input.bookId, coverUrl: cover?.coverUrl ?? null };
  },
);
