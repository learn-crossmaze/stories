import { useEffect, useRef, useState } from 'react';

import { GUIDE, type Decoded, type Mode } from './barcode';
import { lt } from './libraryStrings';

/** Pause between frames sent to the decoder (it runs in a Web Worker, one frame at a time). */
const SCAN_INTERVAL_MS = 60;
/** Frames are cropped to the framing guide; full detail is kept (small codes need every pixel) up to this width. */
const MAX_WIDTH = 1920;
/** A code is accepted after this many matching reads within 1.5 s (guards against misreads). */
const CONFIRMATIONS = 2;

function cameraProblem(e: unknown): string {
  const name = (e as { name?: string }).name;
  if (!window.isSecureContext) return lt.camInsecure;
  if (name === 'NotAllowedError' || name === 'SecurityError') return lt.camDenied;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return lt.camNone;
  if (name === 'NotReadableError') return lt.camBusy;
  return lt.camFailed;
}

/**
 * Live camera preview that reads barcodes (laptop webcam or phone camera).
 * `continuous` keeps scanning (the desk scans book after book); otherwise it
 * closes after the first code. A code counts only after two matching reads
 * within 1.5 s, and the same code isn't reported again while it stays in view.
 */
export function CameraScanner({ onDetect, onClose, continuous = true }: { onDetect: (text: string) => void; onClose: () => void; continuous?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [last, setLast] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const seen = useRef<{ text: string; at: number } | null>(null);
  const detect = useRef(onDetect);
  detect.current = onDetect;

  // Starts and stops run strictly one after another: stopping a camera clears the <video>, so an
  // overlapping stop (React re-running the effect, or switching cameras) would blank the new stream.
  const chain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let stream: MediaStream | null = null;
    let worker: Worker | null = null;
    let timer: number | undefined;
    let cancelled = false;
    setStarting(true);
    setError(null);
    const stop = () => {
      window.clearTimeout(timer);
      worker?.terminate();
      worker = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };
    const run = chain.current.then(async () => {
      if (cancelled) return;
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no media'), { name: window.isSecureContext ? 'NotFoundError' : 'SecurityError' });
        const s = await navigator.mediaDevices.getUserMedia({
          // As sharp as the camera allows: thin bars need pixels.
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
            : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        stream = s;
        if (cancelled) return stop();
        const track = s.getVideoTracks()[0];
        // Continuous autofocus where the webcam supports it (many phones and some USB webcams).
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
        const v = video.current!;
        v.srcObject = s;
        await v.play().catch(() => undefined);
        if (cancelled) return stop();
        worker = new Worker(new URL('./barcode.worker.ts', import.meta.url), { type: 'module' });
        setStarting(false);

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        let candidate: { text: string; count: number; at: number } | null = null;
        let frame = 0;
        const accept = (hit: Decoded | null) => {
          if (!hit) return;
          const text = hit.text.trim();
          const now = Date.now();
          // Passes alternate between frames, so matching reads needn't be on consecutive frames.
          candidate = candidate && candidate.text === text && now - candidate.at < 1500 ? { text, count: candidate.count + 1, at: now } : { text, count: 1, at: now };
          const repeat = seen.current && seen.current.text === text && now - seen.current.at < 2000;
          if (repeat) {
            seen.current = { text, at: now }; // still in view: keep ignoring it
          } else if (candidate.count >= CONFIRMATIONS) {
            seen.current = { text, at: now };
            candidate = null;
            setLast(text);
            navigator.vibrate?.(60);
            detect.current(text);
            if (!continuous) onClose();
          }
        };
        const send = () => {
          if (cancelled || !stream || !worker) return;
          if (v.readyState < 2 || !v.videoWidth) {
            timer = window.setTimeout(send, SCAN_INTERVAL_MS);
            return;
          }
          frame += 1;
          const mode: Mode = frame % 2 ? 'quick' : 'thorough';
          // Quick frames look inside the framing guide; thorough ones at the whole picture, for labels held
          // so close that they spill past the guide.
          const r = mode === 'quick' ? GUIDE : { x: 0, y: 0, w: 1, h: 1 };
          const sw = Math.round(v.videoWidth * r.w);
          const sh = Math.round(v.videoHeight * r.h);
          const scale = Math.min(1, MAX_WIDTH / sw);
          canvas.width = Math.round(sw * scale);
          canvas.height = Math.round(sh * scale);
          ctx.drawImage(v, Math.round(v.videoWidth * r.x), Math.round(v.videoHeight * r.y), sw, sh, 0, 0, canvas.width, canvas.height);
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          worker.postMessage({ id: frame, rgba: data, width: canvas.width, height: canvas.height, mode }, [data.buffer]);
        };
        worker.onmessage = (e: MessageEvent<{ id: number; result: Decoded | null }>) => {
          if (cancelled) return;
          accept(e.data.result);
          if (!cancelled) timer = window.setTimeout(send, SCAN_INTERVAL_MS);
        };
        worker.onerror = (e) => {
          console.warn('barcode worker failed', e);
          if (!cancelled) setError(lt.camFailed);
        };
        send();
        // Labels are only readable once permission is granted.
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        if (!cancelled) setCameras(devices);
      } catch (e) {
        console.warn('camera scanner', e);
        stop();
        if (!cancelled) {
          setError(cameraProblem(e));
          setStarting(false);
        }
      }
    });
    chain.current = run;
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  return (
    <div className="camera-scanner" role="region" aria-label={lt.camTitle}>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : (
        <div className="camera-view">
          <video ref={video} muted playsInline aria-label={lt.camPreview} />
          <span className="camera-guide" aria-hidden="true" />
          {starting && <span className="camera-status">{lt.camStarting}</span>}
        </div>
      )}
      <div className="camera-bar">
        <span className="small muted" aria-live="polite">
          {last ? lt.camScanned(last) : error ? '' : lt.camHint}
        </span>
        {cameras.length > 1 && (
          <select value={deviceId ?? ''} onChange={(e) => setDeviceId(e.target.value || undefined)} aria-label={lt.camChoose}>
            <option value="">{lt.camDefault}</option>
            {cameras.map((c, i) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label || `${lt.camTitle} ${i + 1}`}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="btn btn-outlined" onClick={onClose}>
          {lt.camStop}
        </button>
      </div>
    </div>
  );
}
