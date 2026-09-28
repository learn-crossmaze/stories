import { useRef, useState } from 'react';

import { command } from '../../data/api';
import type { Book } from '../../data/catalogue';
import { BookCover, Notice } from '../components/kit';
import { lt } from '../../strings/library';

/** Longest side of an uploaded cover; enough for the large cover at 2× density. */
const MAX_SIDE = 800;

/**
 * Shrinks a photo or scan to a JPEG of at most MAX_SIDE pixels and returns it
 * as base64 (no data: prefix). Keeps uploads small on slow connections.
 */
export async function shrinkToJpeg(file: File, maxSide = MAX_SIDE): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.fillStyle = '#fff'; // transparent PNGs get a white background, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

/** The book's cover with add/change/remove controls for catalogue editors. */
export function CoverEditor({ book, canEdit, onChanged }: { book: Book; canEdit: boolean; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (image: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await command('books-setCover', { bookId: book.id, image });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : lt.coverFailed);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError(lt.coverNotImage);
      return;
    }
    let image: string;
    try {
      image = await shrinkToJpeg(file);
    } catch {
      setError(lt.coverUnreadable);
      return;
    }
    await save(image);
  };

  return (
    <div className="cover-col">
      <BookCover title={book.title} author={book.authorNames.join(', ')} seed={book.id} url={book.coverUrl} size="lg" />
      {canEdit && (
        <div className="cover-actions">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/*"
            hidden
            aria-label={lt.coverChoose}
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button type="button" className="btn btn-text" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? lt.coverSaving : book.coverUrl ? lt.coverChange : lt.coverAdd}
          </button>
          {book.coverUrl && (
            <button type="button" className="btn btn-text" disabled={busy} onClick={() => void save(null)}>
              {lt.coverRemove}
            </button>
          )}
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
