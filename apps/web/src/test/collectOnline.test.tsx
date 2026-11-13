import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lt } from '../strings/library';

// "Collect online" at the counter: while a payment request is open the dialog asks Razorpay by itself, so the
// counter does not wait for the webhook. The server is faked at the data layer; the request document's listener
// and the clock are held by the test.
type Snapshot = { exists: () => boolean; get: (field: string) => unknown };

const world = vi.hoisted(() => ({
  asked: [] as { action: string; data: Record<string, unknown> }[],
  /** The server's answer to each action (a promise that may be held, a result, or a thrown error). */
  answer: ((): unknown => ({})) as (action: string, data: Record<string, unknown>) => unknown,
  listeners: [] as ((s: unknown) => void)[],
  unsubscribed: 0,
  /** What a one-off read of the request document gives. */
  document: null as Record<string, unknown> | null,
}));

vi.mock('../data/services', () => ({ services: () => ({ fns: { app: { options: {} } }, db: {} }) }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,' } }));
vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  doc: (_db: unknown, path: string) => ({ path }),
  onSnapshot: (_ref: unknown, next: (s: unknown) => void) => {
    world.listeners.push(next);
    return () => void world.unsubscribed++;
  },
  getDoc: async () => ({ exists: () => !!world.document, get: (field: string) => world.document?.[field] }),
}));
vi.mock('../data/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../data/api')>();
  const send = async (action: string, data: Record<string, unknown>) => {
    world.asked.push({ action, data });
    const answer = await world.answer(action, data);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { ...real, call: send, command: send };
});

const { ApiError } = await import('../data/api');
const { AUTO_CHECK, CollectOnlineDialog } = await import('../admin/members/OnlinePayments');

const request = (over: Record<string, unknown> = {}) => ({
  requestId: 'qr_1', channel: 'QR', url: null, qrImageUrl: 'https://rzp.io/qr/1.png', amountMinor: 130000, status: 'OPEN', sentTo: { sms: null, email: null },
  expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), mode: 'test', ...over,
});
const checks = () => world.asked.filter((a) => a.action === 'payments-checkRequest');
const snapshot = (fields: Record<string, unknown>): Snapshot => ({ exists: () => true, get: (field) => fields[field] });
/** The request document changed (the webhook or a check settled it): the listener hears of it. */
const emit = (fields: Record<string, unknown>) => act(() => world.listeners.forEach((hear) => hear(snapshot(fields))));
const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const onPaid = vi.fn();
const onClose = vi.fn();

/** Opens the dialog and shows a UPI QR code: the request is now open. */
async function showQr() {
  const view = render(<CollectOnlineDialog orgId="o1" subscriptionId="s1" amountMinor={130000} member={{ phone: '+919876500001', email: null }} onClose={onClose} onPaid={onPaid} />);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(lt.olQr) }));
  await wait(0);
  expect(screen.getByText(lt.olWaiting, { exact: false })).toBeInTheDocument();
  return view;
}
/** Answers every status check with `status`; creating the request answers as usual. */
const checksAnswer = (status: unknown) => {
  world.answer = (action) => (action === 'payments-createRequest' ? request() : status);
};

beforeEach(() => {
  vi.useFakeTimers();
  world.asked.length = 0;
  world.listeners.length = 0;
  world.unsubscribed = 0;
  world.document = null;
  onPaid.mockReset();
  onClose.mockReset();
  checksAnswer({ status: 'OPEN' });
});
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('collect online: the automatic status check', () => {
  it('first asks after about 4 seconds, then every 3, slower after a minute, and stops after two', async () => {
    await showQr();
    await wait(AUTO_CHECK.first - 100);
    expect(checks()).toHaveLength(0);
    await wait(200);
    expect(checks()).toHaveLength(1);
    expect(checks()[0].data).toEqual({ orgId: 'o1', paymentRequestId: 'qr_1' });
    await wait(AUTO_CHECK.fast);
    expect(checks()).toHaveLength(2);

    await wait(AUTO_CHECK.slowAfter - AUTO_CHECK.first - AUTO_CHECK.fast);
    const afterAMinute = checks().length;
    expect(afterAMinute).toBeGreaterThanOrEqual(18);
    expect(afterAMinute).toBeLessThanOrEqual(20);
    // The second minute asks half as often.
    await wait(AUTO_CHECK.stopAfter - AUTO_CHECK.slowAfter);
    const atTheEnd = checks().length;
    expect(atTheEnd - afterAMinute).toBeGreaterThanOrEqual(9);
    expect(atTheEnd - afterAMinute).toBeLessThanOrEqual(11);
    await wait(5 * 60_000);
    expect(checks()).toHaveLength(atTheEnd);

    // It never spoke: nothing shown as an error, the buttons were never taken away, and the button still works.
    expect(screen.queryByText(lt.olNotYet)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: lt.olCheck }));
    await wait(0);
    expect(checks()).toHaveLength(atTheEnd + 1);
    expect(screen.getByText(lt.olNotYet)).toBeInTheDocument();
  });

  it('asks one question at a time, and none while Cancel or Check is running', async () => {
    let answerCheck: (answer: unknown) => void = () => {};
    checksAnswer(new Promise((r) => (answerCheck = r)));
    await showQr();
    await wait(AUTO_CHECK.first);
    expect(checks()).toHaveLength(1);
    // The answer is slow: no second question behind it, and the buttons stay usable meanwhile.
    await wait(30_000);
    expect(checks()).toHaveLength(1);
    expect(screen.getByRole('button', { name: lt.olCheck })).toBeEnabled();
    expect(screen.getByRole('button', { name: lt.olCancel })).toBeEnabled();
    checksAnswer({ status: 'OPEN' });
    await act(async () => answerCheck({ status: 'OPEN' }));
    await wait(AUTO_CHECK.fast);
    expect(checks()).toHaveLength(2);

    // Cancel is on its way to the server: the automatic check keeps out of it.
    let answerCancel: (answer: unknown) => void = () => {};
    world.answer = (action) => (action === 'payments-cancelRequest' ? new Promise((r) => (answerCancel = r)) : { status: 'OPEN' });
    fireEvent.click(screen.getByRole('button', { name: lt.olCancel }));
    await wait(20_000);
    expect(checks()).toHaveLength(2);
    // Cancelled: back to the two choices, and nothing more is asked about the old request.
    checksAnswer({ status: 'OPEN' });
    await act(async () => answerCancel({}));
    expect(screen.getByRole('button', { name: new RegExp(lt.olQr) })).toBeEnabled();
    await wait(60_000);
    expect(checks()).toHaveLength(2);
  });

  it('only wakes the server: the dialog turns to paid when the request itself says so, and then stops asking', async () => {
    checksAnswer({ status: 'PAID', applied: true });
    await showQr();
    await wait(AUTO_CHECK.first);
    expect(checks()).toHaveLength(1);
    // The answer alone changes nothing on screen and records no "payment recorded".
    expect(screen.getByText(lt.olWaiting, { exact: false })).toBeInTheDocument();
    expect(onPaid).not.toHaveBeenCalled();
    await wait(60_000);
    expect(checks()).toHaveLength(1);

    await emit({ status: 'PAID' });
    expect(screen.getByText(lt.olPaid)).toBeInTheDocument();
    expect(onPaid).toHaveBeenCalledTimes(1);
    await wait(60_000);
    expect(checks()).toHaveLength(1);
  });

  it('stops when the listener reports a payment that could not be applied, and says so', async () => {
    await showQr();
    await wait(AUTO_CHECK.first);
    expect(checks()).toHaveLength(1);
    // Paid but not applied: no "payment recorded", and no more questions.
    await emit({ status: 'PAID', needsAttention: 'The subscription was no longer waiting for payment.' });
    expect(screen.getByText(lt.olAttention('The subscription was no longer waiting for payment.'))).toBeInTheDocument();
    expect(onPaid).not.toHaveBeenCalled();
    await wait(60_000);
    expect(checks()).toHaveLength(1);
  });

  it('stops on unmount, leaving no timer behind', async () => {
    const view = await showQr();
    await wait(AUTO_CHECK.first);
    expect(checks()).toHaveLength(1);
    view.unmount();
    expect(world.unsubscribed).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(checks()).toHaveLength(1);
  });

  it('stops at the request’s expiry', async () => {
    world.answer = (action) => (action === 'payments-createRequest' ? request({ expiresAt: new Date(Date.now() + 9_000).toISOString() }) : { status: 'OPEN' });
    await showQr();
    await wait(60_000);
    // Asked at 4 and 7 seconds; the request ran out at 9.
    expect(checks()).toHaveLength(2);
  });

  it('keeps its failures to itself, gives up at once when refused, and after three failures in a row otherwise', async () => {
    checksAnswer(new ApiError('You do not have permission to do this.', 'FORBIDDEN'));
    const view = await showQr();
    await wait(60_000);
    expect(checks()).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: lt.olCheck })).toBeEnabled();
    view.unmount();

    world.asked.length = 0;
    let n = 0;
    // Two failures, a good answer, then failures only: the count starts again after the good one.
    world.answer = (action) => (action === 'payments-createRequest' ? request() : ++n === 3 ? { status: 'OPEN' } : new ApiError('The payment gateway did not answer.', 'GATEWAY_ERROR'));
    await showQr();
    await wait(110_000);
    expect(checks()).toHaveLength(6);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('waits while the tab is hidden and asks at once when it is looked at again', async () => {
    await showQr();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    await wait(30_000);
    expect(checks()).toHaveLength(0);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    await wait(0);
    expect(checks()).toHaveLength(1);
    await wait(AUTO_CHECK.fast);
    expect(checks()).toHaveLength(2);
  });
});

describe('collect online: the Check button', () => {
  it('shows a payment that could not be applied as such, without the "payment recorded" notice', async () => {
    await showQr();
    // The bare answer says PAID; the request document carries why it was not applied.
    checksAnswer({ status: 'PAID', applied: false, reason: 'NEEDS_ATTENTION', problem: 'Paid ₹100.00 but ₹1300.00 was due.' });
    world.document = { status: 'PAID', needsAttention: 'Paid ₹100.00 but ₹1300.00 was due.' };
    fireEvent.click(screen.getByRole('button', { name: lt.olCheck }));
    await wait(0);
    expect(screen.getByText(lt.olAttention('Paid ₹100.00 but ₹1300.00 was due.'))).toBeInTheDocument();
    expect(onPaid).not.toHaveBeenCalled();
  });

  it('shows a payment settled a moment ago by the webhook, read from the request', async () => {
    await showQr();
    checksAnswer({ status: 'PAID' });
    world.document = { status: 'PAID' };
    fireEvent.click(screen.getByRole('button', { name: lt.olCheck }));
    await wait(0);
    expect(screen.getByText(lt.olPaid)).toBeInTheDocument();
    expect(onPaid).toHaveBeenCalledTimes(1);
  });

  it('falls back to the answer when the request cannot be read', async () => {
    await showQr();
    checksAnswer({ status: 'PAID', applied: false, reason: 'NEEDS_ATTENTION', problem: 'The payment request had been cancelled.' });
    fireEvent.click(screen.getByRole('button', { name: lt.olCheck }));
    await wait(0);
    expect(screen.getByText(lt.olAttention('The payment request had been cancelled.'))).toBeInTheDocument();
    expect(onPaid).not.toHaveBeenCalled();
  });
});
