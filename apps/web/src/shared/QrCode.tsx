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

/**
 * A QR code with what it identifies printed beside it: the code in bold and a
 * short title (e.g. a book copy: COPY-000001-02 + the book title), in small type.
 */
export function QrTag({ value, code, title, brand, className }: { value: string; code: string; title?: string; brand?: string; className?: string }) {
  return (
    <div className={`qr-tag ${className ?? ''}`}>
      <QrCode value={value} className="qr-tag-qr" />
      <div className="qr-tag-text">
        {brand && <span className="qr-tag-brand">{brand}</span>}
        <span className="qr-tag-code">{code}</span>
        {title && <span className="qr-tag-title">{title}</span>}
      </div>
    </div>
  );
}
