import { FirebaseError } from 'firebase/app';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ht } from '../strings/hr';

// What the console sends for a chosen document: large photos are made smaller first (docs/HRMS.md §7).
const sent: { action: string; fileName: string; content: string; requestId: string }[] = [];
let fail: Error | null = null;
vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: (typeof sent)[number]) => {
    sent.push(data);
    if (fail) throw fail;
    return { data: { documentId: 'd1', status: 'PENDING' } };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
// The browser's own shrinking, replaced: each call would give different bytes, as a canvas may.
let shrinks = 0;
vi.mock('../shared/image', () => ({ shrinkToJpeg: async () => btoa(`shrunk ${++shrinks}`) }));

const { ApiError, resetBackendState } = await import('../data/api');
const { MAX_DOCUMENT_BYTES, prepareDocument, uploadDocument } = await import('../data/hrDocuments');

const fileOf = (bytes: number, name: string, type: string) => new File([new Uint8Array(bytes).fill(7)], name, { type });
const original = (bytes: number) => btoa('\x07'.repeat(bytes));
const small = btoa('a much smaller picture');

beforeEach(() => {
  sent.length = 0;
  shrinks = 0;
  fail = null;
  resetBackendState();
});

describe('prepareDocument', () => {
  it('sends a PDF as it is', async () => {
    const shrink = vi.fn(async () => small);
    expect(await prepareDocument(fileOf(3000, 'Offer.pdf', 'application/pdf'), shrink)).toEqual({ fileName: 'Offer.pdf', content: original(3000) });
    expect(shrink).not.toHaveBeenCalled();
  });

  it('sends a small image as it is', async () => {
    const shrink = vi.fn(async () => small);
    expect(await prepareDocument(fileOf(3000, 'pan.png', 'image/png'), shrink)).toEqual({ fileName: 'pan.png', content: original(3000) });
    expect(shrink).not.toHaveBeenCalled();
  });

  it('sends a large photo smaller, as a JPEG named so', async () => {
    const shrink = vi.fn(async () => small);
    const photo = fileOf(1_200_000, 'Aadhaar front.PNG', 'image/png');
    expect(await prepareDocument(photo, shrink)).toEqual({ fileName: 'Aadhaar front.jpg', content: small });
    expect(shrink).toHaveBeenCalledWith(photo, 2200);
  });

  it('makes room for a photo over the limit', async () => {
    const res = await prepareDocument(fileOf(MAX_DOCUMENT_BYTES + 1, 'IMG_0042.jpeg', 'image/jpeg'), async () => small);
    expect(res).toEqual({ fileName: 'IMG_0042.jpg', content: small });
  });

  it('keeps the original when the smaller version is not smaller', async () => {
    // A screenshot of text can grow as a JPEG.
    const bigger = btoa('x'.repeat(1_200_001));
    const res = await prepareDocument(fileOf(1_200_000, 'statement.png', 'image/png'), async () => bigger);
    expect(res.fileName).toBe('statement.png');
    expect(res.content).toBe(original(1_200_000));
  });

  it('falls back to the original when the photo cannot be made smaller and it fits', async () => {
    const res = await prepareDocument(fileOf(1_200_000, 'cheque.jpg', 'image/jpeg'), async () => {
      throw new Error('out of memory');
    });
    expect(res.fileName).toBe('cheque.jpg');
    expect(res.content).toBe(original(1_200_000));
  });

  it('says the file is too large when it cannot be made smaller and does not fit', async () => {
    const failed = prepareDocument(fileOf(MAX_DOCUMENT_BYTES + 1, 'huge.jpg', 'image/jpeg'), async () => {
      throw new Error('out of memory');
    });
    // An ApiError: the form shows its own sentence, not the general failure text.
    await expect(failed).rejects.toBeInstanceOf(ApiError);
    await expect(failed).rejects.toMatchObject({ message: ht.fileTooLarge, reason: 'INVALID_INPUT' });
    await expect(prepareDocument(fileOf(MAX_DOCUMENT_BYTES + 1, 'scan.pdf', 'application/pdf'))).rejects.toMatchObject({ message: ht.fileTooLarge });
  });
});

describe('uploadDocument', () => {
  it('prepares a chosen file once, so pressing Upload again sends the same bytes under the same request', async () => {
    const input = { orgId: 'o1', employeeId: 'e1', typeId: 'aadhaar', file: fileOf(1_200_000, 'aadhaar.jpg', 'image/jpeg'), number: '', issuedOn: '', expiresOn: '' };
    // A timeout: the upload may or may not have gone through.
    fail = new FirebaseError('functions/deadline-exceeded', 'deadline-exceeded');
    vi.useFakeTimers();
    const first = uploadDocument(input).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    expect(await first).toBeInstanceOf(ApiError);
    const tries = sent.length;

    fail = null;
    await expect(uploadDocument(input)).resolves.toEqual({ documentId: 'd1', status: 'PENDING' });
    expect(shrinks).toBe(1);
    expect(new Set(sent.map((s) => s.content)).size).toBe(1);
    expect(sent[tries].fileName).toBe('aadhaar.jpg');
    // Recognised as the same upload: the server answers with the stored result instead of filing it twice.
    expect(new Set(sent.map((s) => s.requestId)).size).toBe(1);
  });
});
