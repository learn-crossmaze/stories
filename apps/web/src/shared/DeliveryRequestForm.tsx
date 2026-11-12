import { useRef, useState } from 'react';

import { DialogActions, FormError, useSubmit } from './Dialog';
import { SelectField, TextArea, TextField } from './fields';
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
  /** PIN codes the branch delivers to (empty: any). A PIN outside them is only warned about; the server decides. */
  pincodes: string[];
}

/** The server takes at most this many books to collect in one visit. */
const MAX_COLLECT = 10;

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
  // A pickup with nothing to collect is refused, so it starts with every book out ticked (staff untick what stays).
  const everyLoan = () => choices.loans.slice(0, MAX_COLLECT).map((l) => l.id);
  const [kind, setKindOnly] = useState<DeliveryKind>(choices.loans.length && !choices.holds.length ? 'PICKUP' : 'DELIVER');
  const [date, setDate] = useState(istDate(1));
  const [slot, setSlot] = useState(choices.slots[0] ?? '');
  const [address, setAddress] = useState(emptyAddress(choices.address));
  const [holdIds, setHoldIds] = useState<string[]>(choices.holds.map((h) => h.id));
  const [collect, setCollect] = useState<string[]>(() => (kind === 'PICKUP' ? everyLoan() : []));
  // The ticks are still the ones the form put there for a pickup: nobody has chosen them.
  const filled = useRef(kind === 'PICKUP');
  const choose = (ids: string[]) => {
    filled.current = false;
    setCollect(ids);
  };
  const setKind = (k: DeliveryKind) => {
    setKindOnly(k);
    if (k === 'PICKUP' && !collect.length) {
      filled.current = true;
      setCollect(everyLoan());
    } else if (k === 'EXCHANGE' && filled.current) {
      // An exchange starts unticked: the books ticked count as coming back when the new ones are issued, so they
      // have to be chosen. Ticks the person made carry over.
      filled.current = false;
      setCollect([]);
    }
  };
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const sends = kind !== 'PICKUP';
  const collects = kind !== 'DELIVER';
  const pin = address.postalCode.trim();
  const pinWarning = /^\d{6}$/.test(pin) && choices.pincodes.length > 0 && !choices.pincodes.includes(pin) ? dt.address.pinOutside(pin) : undefined;
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
      {collects && <Checklist legend={dt.collect} empty={dt.noLoans} items={choices.loans} chosen={collect} onChange={choose} />}
      <TextArea label={dt.note} value={note} onChange={setNote} rows={2} hint={dt.noteHint} />
      <h3 className="form-section">{dt.where}</h3>
      <DeliveryAddressFields value={address} onChange={setAddress} showErrors={touched} pinWarning={pinWarning} />
      {choices.feeMinor > 0 && <p className="muted small">{dt.feeToCollect(money(choices.feeMinor))}</p>}
      <FormError error={error} />
      <DialogActions busy={busy} submitLabel={submitLabel} onCancel={onCancel} />
    </form>
  );
}
