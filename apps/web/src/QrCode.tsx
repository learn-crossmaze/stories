import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/** A QR code drawn as SVG (scales crisply on screen and in print). */
export function QrCode({ value, className }: { value: string; className?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let live = true;
    void QRCode.toString(value, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }).then((s) => live && setSvg(s));
    return () => {
      live = false;
    };
  }, [value]);
  return <span className={`qr ${className ?? ''}`} role="img" aria-label={`QR code ${value}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}
