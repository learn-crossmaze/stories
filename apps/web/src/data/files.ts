// Files the server sends as base64 (letters, documents, payslips).
import { call } from './api';

interface FileResponse {
  fileName: string;
  contentType: string;
  content: string;
}

const objectUrl = (res: FileResponse) =>
  URL.createObjectURL(new Blob([Uint8Array.from(atob(res.content), (c) => c.charCodeAt(0))], { type: res.contentType }));

/** Fetches a file from an action and shows it in a new tab. */
export async function openFile(action: string, data: Record<string, unknown>) {
  // Open the tab first so the browser treats it as a response to the click.
  const tab = window.open('', '_blank');
  try {
    const url = objectUrl(await call<FileResponse>(action, data));
    if (tab) tab.location.href = url;
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** Fetches a file from an action and saves it under the name the server gives it. */
export async function downloadFile(action: string, data: Record<string, unknown>) {
  const res = await call<FileResponse>(action, data);
  const url = objectUrl(res);
  const a = document.createElement('a');
  a.href = url;
  a.download = res.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** A file's contents as base64 (for uploads). */
export function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
