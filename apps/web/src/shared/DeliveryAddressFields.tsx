import { useState } from 'react';

import { TextField } from '../admin/components/Dialog';
import { coordsFromText, currentPosition, type DeliveryAddress, type Geo } from '../data/delivery';
import { dt } from '../strings/delivery';

// The delivery address with an optional map pin (couriers like Porter need it):
// paste a Google Maps link or "lat, lng", or use the device's location.

export const emptyAddress = (a?: Partial<DeliveryAddress> | null): DeliveryAddress => ({
  line1: a?.line1 ?? '',
  line2: a?.line2 ?? '',
  landmark: a?.landmark ?? '',
  city: a?.city ?? '',
  state: a?.state ?? '',
  postalCode: a?.postalCode ?? '',
  geo: a?.geo ?? null,
});

export const addressProblem = (a: DeliveryAddress) =>
  a.line1.trim().length < 3 || a.city.trim().length < 2 || a.state.trim().length < 2 || !/^\d{6}$/.test(a.postalCode.trim());

export function MapPinField({ label, hint, value, onChange }: { label: string; hint: string; value: Geo | null; onChange: (g: Geo | null) => void }) {
  const [text, setText] = useState(value ? `${value.lat}, ${value.lng}` : '');
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  return (
    <div className="map-pin">
      <TextField
        label={label}
        hint={value ? `${hint} ${dt.address.mapSet(value.lat, value.lng)}` : hint}
        value={text}
        error={error ?? undefined}
        autoComplete="off"
        onChange={(v) => {
          setText(v);
          if (!v.trim()) {
            setError(null);
            return onChange(null);
          }
          const g = coordsFromText(v);
          setError(g ? null : dt.address.mapBad);
          if (g) onChange(g);
        }}
      />
      <button
        type="button"
        className="btn btn-text"
        disabled={locating}
        onClick={async () => {
          setLocating(true);
          setError(null);
          try {
            const g = await currentPosition();
            setText(`${g.lat}, ${g.lng}`);
            onChange(g);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setLocating(false);
          }
        }}
      >
        {dt.address.useHere}
      </button>
    </div>
  );
}

export function DeliveryAddressFields({ value, onChange, showErrors }: { value: DeliveryAddress; onChange: (a: DeliveryAddress) => void; showErrors?: boolean }) {
  const set = (k: keyof DeliveryAddress) => (v: string) => onChange({ ...value, [k]: v });
  const err = (bad: boolean) => (showErrors && bad ? 'Required' : undefined);
  return (
    <div className="form-grid">
      <div className="span-2">
        <TextField label={dt.address.line1} value={value.line1} onChange={set('line1')} autoComplete="address-line1" error={err(value.line1.trim().length < 3)} />
      </div>
      <TextField label={dt.address.line2} value={value.line2} onChange={set('line2')} autoComplete="address-line2" />
      <TextField label={dt.address.landmark} value={value.landmark} onChange={set('landmark')} />
      <TextField label={dt.address.city} value={value.city} onChange={set('city')} autoComplete="address-level2" error={err(value.city.trim().length < 2)} />
      <TextField label={dt.address.state} value={value.state} onChange={set('state')} autoComplete="address-level1" error={err(value.state.trim().length < 2)} />
      <TextField
        label={dt.address.postalCode}
        value={value.postalCode}
        onChange={set('postalCode')}
        autoComplete="postal-code"
        error={err(!/^\d{6}$/.test(value.postalCode.trim()))}
      />
      <MapPinField label={dt.address.map} hint={dt.address.mapHint} value={value.geo} onChange={(geo) => onChange({ ...value, geo })} />
    </div>
  );
}
