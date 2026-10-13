import { useState } from 'react';

import { DialogActions, FormError, SelectField, TextArea, TextField, useSubmit } from '../admin/components/Dialog';
import type { DeliveryAddress, DeliveryKind, RequestInput } from '../data/delivery';
import { istDate } from '../data/delivery';
import { money } from './format';
import { dt } from '../strings/delivery';
import { addressProblem, DeliveryAddressFields, emptyAddress } from './DeliveryAddressFields';

// Booking a home visit (staff at the branch, or members in the app): the
// type, date and time, address, ready holds to bring and books to take back.

export interface RequestChoices {
  slots: string[];
  maxDaysAhead: number;
  feeMinor: number;
  holds: { id: string; title: string }[];
  loans: { id: string; title: string }[];
  address: Partial<DeliveryAddress> | null;
}

function Checklist({ legend, empty, items, chosen, onChange }: { legend: string; empty: string; items: { id: string; title: string }[]; chosen: string[]; onChange: (ids: string[]) => void }) {
  return (
    <fieldset className="checklist">
      <legend>{legend}</legend>
      {items.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        items.map((i) => (
          <label key={i.id} className="check">
            <input type="checkbox" checked={chosen.includes(i.id)} onChange={(e) => onChange(e.target.checked ? [...chosen, i.id] : chosen.filter((x) => x !== i.id))} />
            {i.title}
          </label>
        ))
      )}
    </fieldset>
  );
}

export function DeliveryRequestForm({
  branchId,
  memberId,
  choices,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  branchId: string;
  memberId: string;
  choices: RequestChoices;
  submitLabel: string;
  onSubmit: (r: RequestInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<DeliveryKind>(choices.loans.length && !choices.holds.length ? 'PICKUP' : 'DELIVER');
  const [date, setDate] = useState(istDate(1));
  const [slot, setSlot] = useState(choices.slots[0] ?? '');
  const [address, setAddress] = useState(emptyAddress(choices.address));
  const [holdIds, setHoldIds] = useState<string[]>(choices.holds.map((h) => h.id));
  const [collect, setCollect] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const sends = kind !== 'PICKUP';
  const collects = kind !== 'DELIVER';
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (addressProblem(address)) return;
    await onSubmit({
      branchId,
      memberId,
      kind,
      date,
      slot: choices.slots.length ? slot : null,
      address: { ...address, postalCode: address.postalCode.trim() },
      note: note.trim(),
      holdIds: sends ? holdIds : [],
      collectLoanIds: collects ? collect : [],
    });
  });
  return (
    <form onSubmit={submit} noValidate>
      <SelectField label={dt.kindLabel} value={kind} onChange={setKind} options={(['DELIVER', 'PICKUP', 'EXCHANGE'] as const).map((k) => ({ value: k, label: dt.kind[k] }))} />
      <p className="muted small">{dt.kindHint[kind]}</p>
      <div className="form-grid">
        <TextField label={dt.date} type="date" value={date} onChange={(v) => setDate(v)} hint={`${istDate(0)} – ${istDate(choices.maxDaysAhead)}`} />
        {choices.slots.length > 0 ? (
          <SelectField label={dt.slot} value={slot} onChange={setSlot} options={choices.slots.map((s) => ({ value: s, label: s }))} />
        ) : (
          <p className="muted small field-note">{dt.anyTime}</p>
        )}
      </div>
      {sends && <Checklist legend={dt.holds} empty={dt.noHolds} items={choices.holds} chosen={holdIds} onChange={setHoldIds} />}
      {collects && <Checklist legend={dt.collect} empty={dt.noLoans} items={choices.loans} chosen={collect} onChange={setCollect} />}
      <TextArea label={dt.note} value={note} onChange={setNote} rows={2} hint={dt.noteHint} />
      <h3 className="form-section">{dt.where}</h3>
      <DeliveryAddressFields value={address} onChange={setAddress} showErrors={touched} />
      {choices.feeMinor > 0 && <p className="muted small">{dt.feeToCollect(money(choices.feeMinor))}</p>}
      <FormError error={error} />
      <DialogActions busy={busy} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
  );
}
