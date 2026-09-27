/**
 * Physical copy state machine (docs/CIRCULATION.md). Any transition not listed
 * here is rejected by every command, so a copy can never, e.g., be issued
 * while in transit or be un-retired.
 */
export const COPY_STATUSES = ['AVAILABLE', 'RESERVED', 'ISSUED', 'IN_TRANSIT', 'UNDER_INSPECTION', 'DAMAGED', 'LOST', 'RETIRED'] as const;
export type CopyStatus = (typeof COPY_STATUSES)[number];

export const CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR'] as const;
export type Condition = (typeof CONDITIONS)[number];

const TRANSITIONS: Record<CopyStatus, readonly CopyStatus[]> = {
  AVAILABLE: ['RESERVED', 'ISSUED', 'IN_TRANSIT', 'UNDER_INSPECTION', 'DAMAGED', 'LOST', 'RETIRED'],
  RESERVED: ['AVAILABLE', 'ISSUED'],
  ISSUED: ['UNDER_INSPECTION', 'LOST'],
  IN_TRANSIT: ['AVAILABLE', 'DAMAGED', 'UNDER_INSPECTION'],
  UNDER_INSPECTION: ['AVAILABLE', 'DAMAGED'],
  DAMAGED: ['AVAILABLE', 'RETIRED', 'LOST'],
  LOST: ['UNDER_INSPECTION', 'RETIRED'],
  RETIRED: [],
};

export const canTransition = (from: CopyStatus, to: CopyStatus) => TRANSITIONS[from].includes(to);

/** Statuses that still count as stock the branch holds (for totals). */
export const IN_STOCK: readonly CopyStatus[] = ['AVAILABLE', 'RESERVED', 'ISSUED', 'IN_TRANSIT', 'UNDER_INSPECTION', 'DAMAGED'];

const HUMAN: Record<CopyStatus, string> = {
  AVAILABLE: 'available',
  RESERVED: 'reserved for a member',
  ISSUED: 'issued to a member',
  IN_TRANSIT: 'in transit',
  UNDER_INSPECTION: 'waiting for inspection',
  DAMAGED: 'marked damaged',
  LOST: 'marked lost',
  RETIRED: 'retired',
};
export const describeStatus = (s: CopyStatus) => HUMAN[s];
