import { ApiError, errorText } from '../../data/api';
import type { Delivery, DeliveryMethod, ReadyHold } from '../../data/delivery';
import { remember } from '../../shared/remember';

// The Deliveries board's rules that need no screen: what the last dispatch used, which visits can go out
// together, where a bag belongs, and running several visits side by side (each still its own command).

export type BoardTab = 'REQUESTED' | 'OUT' | 'RETURNING' | 'CLOSED';
export const BOARD_TABS: BoardTab[] = ['REQUESTED', 'OUT', 'RETURNING', 'CLOSED'];

/** The tab named in the address (?tab=RETURNING), when it is one of the board's. */
export const tabFrom = (value: string | null): BoardTab | null => BOARD_TABS.find((x) => x === value) ?? null;

/** Where the board opens when no tab was asked for: what waits to go out, else the bags waiting to be received. */
export const landingTab = (open: Pick<Delivery, 'status'>[]): BoardTab =>
  open.some((d) => d.status === 'REQUESTED') || !open.some((d) => d.status === 'RETURNING') ? 'REQUESTED' : 'RETURNING';

// ------------------------------------------------------------------ what the last dispatch used

/** How the branch last sent a visit out. Never a courier app (a paid booking must be chosen each time), a reference or a link. */
export interface LastDispatch {
  method?: 'OWN' | 'MANUAL';
  riderUid?: string;
  courierName?: string;
}

const lastKey = (orgId: string, branchId: string) => remember.key('dispatch', orgId, branchId);
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Only what has the right shape survives: the stored value may be old or edited by hand. */
function tidy(v: Record<string, unknown>): LastDispatch {
  return {
    ...(v.method === 'OWN' || v.method === 'MANUAL' ? { method: v.method } : {}),
    ...(typeof v.riderUid === 'string' && v.riderUid ? { riderUid: v.riderUid } : {}),
    ...(typeof v.courierName === 'string' && v.courierName.trim() ? { courierName: v.courierName.trim().slice(0, 60) } : {}),
  };
}

export const readLastDispatch = (orgId: string, branchId: string): LastDispatch => tidy(remember.get(lastKey(orgId, branchId), {}, isRecord));

/** The choices of a dispatch that went through, laid over what was remembered before. */
export function withDispatch(last: LastDispatch, used: { method: DeliveryMethod; riderUid: string | null; courierName: string }): LastDispatch {
  return tidy({
    ...last,
    ...(used.method === 'OWN' || used.method === 'MANUAL' ? { method: used.method } : {}),
    ...(used.method === 'OWN' && used.riderUid ? { riderUid: used.riderUid } : {}),
    ...(used.method === 'MANUAL' && used.courierName.trim() ? { courierName: used.courierName } : {}),
  });
}

export const saveLastDispatch = (orgId: string, branchId: string, last: LastDispatch) => remember.set(lastKey(orgId, branchId), last);

/**
 * What a dispatch starts with: the remembered method and rider while they are still on offer for this visit,
 * otherwise the first of each (the method list differs by kind, and people leave the branch).
 */
export function startingChoice(last: LastDispatch, methods: DeliveryMethod[], riders: { uid: string }[]) {
  return {
    method: last.method && methods.includes(last.method) ? last.method : (methods[0] ?? 'OWN'),
    riderUid: riders.some((r) => r.uid === last.riderUid) ? last.riderUid! : (riders[0]?.uid ?? ''),
    courierName: last.courierName ?? '',
  };
}

// ------------------------------------------------------------------ sending a run

/** A visit that can go out with the run unopened: a pickup, or books that were all reserved. A request by note needs its books chosen. */
export const canJoinRun = (d: Pick<Delivery, 'status' | 'kind' | 'holdIds'>) => d.status === 'REQUESTED' && (d.kind === 'PICKUP' || d.holdIds.length > 0);

/**
 * The copies to send for a visit in the run, or null when it must be opened instead: the member's ready reserved
 * books (read just now) have to be exactly the ones the visit was booked with, each with its copy set aside.
 */
export function runBarcodes(d: Pick<Delivery, 'kind' | 'holdIds'>, holds: ReadyHold[]): string[] | null {
  if (d.kind === 'PICKUP') return [];
  const booked = new Set(d.holdIds);
  if (!booked.size || holds.length !== booked.size || holds.some((h) => !booked.has(h.reservationId) || !h.copyCode)) return null;
  return holds.map((h) => h.copyCode!);
}

/** Runs `work` for every item, at most `size` at a time. One failure never stops the others; results keep the items' order. */
export async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await work(items[i]) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return results;
}

export const RUN_AT_ONCE = 3;

export interface RunApi {
  holds: (deliveryId: string) => Promise<ReadyHold[]>;
  dispatch: (deliveryId: string, input: { barcodes: string[]; method: 'OWN'; riderUid: string; courier: null; waiveFee: false }) => Promise<unknown>;
}

/**
 * Dispatches the ticked visits to one rider, each as its own command (a refusal stays with its visit). Answers
 * with the visits that went out and, for the others, what to show on their card.
 */
export async function sendRun(visits: Delivery[], riderUid: string, api: RunApi, needsCheck: string): Promise<{ sent: string[]; problems: Record<string, string> }> {
  const results = await pool(visits, RUN_AT_ONCE, async (d) => {
    const barcodes = runBarcodes(d, d.kind === 'PICKUP' ? [] : await api.holds(d.id));
    if (!barcodes) return needsCheck;
    await api.dispatch(d.id, { barcodes, method: 'OWN', riderUid, courier: null, waiveFee: false });
    return null;
  });
  const sent: string[] = [];
  const problems: Record<string, string> = {};
  results.forEach((r, i) => {
    const problem = r.status === 'rejected' ? errorText(r.reason) : r.value;
    if (problem) problems[visits[i].id] = problem;
    else sent.push(visits[i].id);
  });
  return { sent, problems };
}

// ------------------------------------------------------------------ bags coming back

/** Who is bringing a bag back. Riders are told apart by account, not by name. */
export function carrierOf(d: Pick<Delivery, 'rider' | 'provider' | 'courier'>): { key: string; name: string | null } {
  if (d.rider) return { key: `rider:${d.rider.uid}`, name: d.rider.name };
  if (d.provider) return { key: `app:${d.provider.key}`, name: null };
  if (d.courier?.name) return { key: `courier:${d.courier.name.trim().toLowerCase()}`, name: d.courier.name };
  return { key: 'other', name: null };
}

/** Bags in the order given, kept together by who brings them back. */
export function carrierGroups(bags: Delivery[]): { key: string; name: string | null; bags: Delivery[] }[] {
  const groups = new Map<string, { key: string; name: string | null; bags: Delivery[] }>();
  for (const d of bags) {
    const c = carrierOf(d);
    const g = groups.get(c.key) ?? { ...c, bags: [] };
    g.bags.push(d);
    groups.set(c.key, g);
  }
  return [...groups.values()];
}

/** The books in a bag: what was collected, and what could not be delivered. */
export const bagItems = (d: Pick<Delivery, 'collected' | 'sent' | 'outcome'>) => [...d.collected, ...(d.outcome === 'FAILED' ? d.sent : [])];

/**
 * Receives the bags, each as its own command. A bag someone else received meanwhile counts as done. Answers
 * with how many bags and books came in, and what went wrong with the rest.
 */
export async function receiveBags(bags: Delivery[], receive: (deliveryId: string) => Promise<{ returned: number }>) {
  const results = await pool(bags, RUN_AT_ONCE, (d) => receive(d.id));
  const done: string[] = [];
  const problems: Record<string, string> = {};
  let books = 0;
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') books += r.value.returned;
    if (r.status === 'fulfilled' || (r.reason instanceof ApiError && r.reason.reason === 'NOT_RETURNING')) done.push(bags[i].id);
    else problems[bags[i].id] = errorText(r.reason);
  });
  return { done, books, problems };
}
