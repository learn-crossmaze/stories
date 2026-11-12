import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { RequestInput } from '../data/delivery';
import { DeliveryRequestForm, type RequestChoices } from '../shared/DeliveryRequestForm';
import { dt } from '../strings/delivery';

// Booking a home visit (shared by the staff console and the member app): what the form fills in for you.

const home = { line1: '12 MG Road', line2: '', landmark: 'Opposite the park', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001', geo: { lat: 12.9716, lng: 77.5946 } };
const loans = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `l${i + 1}`, title: `Book ${i + 1}` }));
const choices = (extra: Partial<RequestChoices> = {}): RequestChoices => ({ slots: [], maxDaysAhead: 14, feeMinor: 0, holds: [], loans: [], address: home, pincodes: [], ...extra });

function show(c: RequestChoices) {
  const onSubmit = vi.fn(async (_r: RequestInput) => undefined);
  render(<DeliveryRequestForm branchId="b1" memberId="m1" choices={c} submitLabel="Book" onSubmit={onSubmit} onCancel={() => undefined} />);
  return onSubmit;
}
const ticked = () => (screen.queryAllByRole('checkbox') as HTMLInputElement[]).filter((c) => c.checked).length;

describe('booking a home visit', () => {
  it('starts a pickup with the books out already ticked, ten at most (what one visit can collect)', async () => {
    const user = userEvent.setup();
    const onSubmit = show(choices({ loans: loans(12) }));
    expect(screen.getByLabelText(dt.kindLabel)).toHaveValue('PICKUP');
    expect(screen.getAllByRole('checkbox')).toHaveLength(12);
    expect(ticked()).toBe(10);
    expect(screen.getByRole('checkbox', { name: 'Book 11' })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Book' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ kind: 'PICKUP', holdIds: [], collectLoanIds: loans(10).map((l) => l.id), address: home });
  });

  it('ticks the books when the visit is changed to a pickup with none chosen, and leaves an exchange for staff to choose', async () => {
    const user = userEvent.setup();
    show(choices({ holds: [{ id: 'h1', title: 'Reserved one' }], loans: loans(3) }));
    const kind = screen.getByLabelText(dt.kindLabel);
    expect(kind).toHaveValue('DELIVER');
    await user.selectOptions(kind, 'EXCHANGE');
    expect(screen.getByRole('checkbox', { name: 'Reserved one' })).toBeChecked();
    for (const l of loans(3)) expect(screen.getByRole('checkbox', { name: l.title })).not.toBeChecked();
    // A choice already made is kept when the visit becomes a pickup.
    await user.click(screen.getByRole('checkbox', { name: 'Book 2' }));
    await user.selectOptions(kind, 'PICKUP');
    expect(ticked()).toBe(1);
    expect(screen.getByRole('checkbox', { name: 'Book 2' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Book 2' }));
    await user.selectOptions(kind, 'DELIVER');
    await user.selectOptions(kind, 'PICKUP');
    expect(ticked()).toBe(3);
  });

  it('takes the ticks it made for a pickup back when the visit becomes an exchange', async () => {
    const user = userEvent.setup();
    const onSubmit = show(choices({ loans: loans(3) }));
    const kind = screen.getByLabelText(dt.kindLabel);
    expect(kind).toHaveValue('PICKUP');
    expect(ticked()).toBe(3);
    await user.selectOptions(kind, 'EXCHANGE');
    expect(ticked()).toBe(0);
    // The same by way of a delivery, where the books to send back are not on screen.
    await user.selectOptions(kind, 'PICKUP');
    expect(ticked()).toBe(3);
    await user.selectOptions(kind, 'DELIVER');
    await user.selectOptions(kind, 'EXCHANGE');
    expect(ticked()).toBe(0);
    // Only the book chosen for the exchange is sent.
    await user.click(screen.getByRole('checkbox', { name: 'Book 2' }));
    await user.type(screen.getByLabelText(dt.note), 'Any two adventure books');
    await user.click(screen.getByRole('button', { name: 'Book' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ kind: 'EXCHANGE', holdIds: [], collectLoanIds: ['l2'] });
  });

  it('keeps the books a person chose for a pickup when the visit becomes an exchange', async () => {
    const user = userEvent.setup();
    show(choices({ loans: loans(3) }));
    const kind = screen.getByLabelText(dt.kindLabel);
    await user.click(screen.getByRole('checkbox', { name: 'Book 3' }));
    await user.selectOptions(kind, 'EXCHANGE');
    expect(ticked()).toBe(2);
    expect(screen.getByRole('checkbox', { name: 'Book 3' })).not.toBeChecked();
  });

  it('warns at once when the PIN code is outside the delivery area, without stopping the booking', async () => {
    const user = userEvent.setup();
    const onSubmit = show(choices({ pincodes: ['560001', '560002'], address: { ...home, postalCode: '560099' }, holds: [{ id: 'h1', title: 'Reserved one' }] }));
    const pin = screen.getByLabelText(dt.address.postalCode);
    expect(pin).toHaveAccessibleDescription(dt.address.pinOutside('560099'));
    // Still being typed: nothing to say yet.
    await user.clear(pin);
    await user.type(pin, '56000');
    expect(pin).not.toHaveAccessibleDescription();
    await user.type(pin, '2');
    expect(pin).not.toHaveAccessibleDescription();
    await user.clear(pin);
    await user.type(pin, '560045');
    expect(pin).toHaveAccessibleDescription(dt.address.pinOutside('560045'));
    // The branch's list on screen can be out of date: the server decides.
    await user.click(screen.getByRole('button', { name: 'Book' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].address.postalCode).toBe('560045');
  });

  it('says nothing about the PIN code when the branch delivers anywhere', () => {
    show(choices({ pincodes: [], address: { ...home, postalCode: '560099' } }));
    expect(screen.getByLabelText(dt.address.postalCode)).not.toHaveAccessibleDescription();
    expect(screen.getByLabelText(dt.address.landmark)).toHaveValue('Opposite the park');
  });
});
