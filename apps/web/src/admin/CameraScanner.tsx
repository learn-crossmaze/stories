import { useEffect, useRef, useState } from 'react';

import { lt } from './libraryStrings';

type Controls = { stop: () => void };

/** Formats on library labels (Code 128), book covers (EAN-13 / ISBN) and a few common others. */
async function makeReader() {
  // Loaded only when the camera is used, to keep the console quick to open.
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.QR_CODE,
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 600 });
}

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
 * closes after the first code. The same code isn't reported twice in a row
 * within 2 seconds.
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
    let controls: Controls | null = null;
    let cancelled = false;
    setStarting(true);
    setError(null);
    const run = chain.current.then(async () => {
      if (cancelled) return;
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no media'), { name: window.isSecureContext ? 'NotFoundError' : 'SecurityError' });
        const reader = await makeReader();
        const constraints: MediaStreamConstraints = {
          video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        };
        const c = await reader.decodeFromConstraints(constraints, video.current!, (result) => {
          if (!result || cancelled) return;
          const text = result.getText().trim();
          const now = Date.now();
          if (seen.current && seen.current.text === text && now - seen.current.at < 2000) return;
          seen.current = { text, at: now };
          setLast(text);
          navigator.vibrate?.(60);
          detect.current(text);
          if (!continuous) onClose();
        });
        if (cancelled) {
          c.stop();
          return;
        }
        controls = c;
        setStarting(false);
        // Labels are only readable once permission is granted.
        const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        if (!cancelled) setCameras(devices);
      } catch (e) {
        console.warn('camera scanner', e);
        if (!cancelled) {
          setError(cameraProblem(e));
          setStarting(false);
        }
      }
    });
    chain.current = run;
    return () => {
      cancelled = true;
      controls?.stop();
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
