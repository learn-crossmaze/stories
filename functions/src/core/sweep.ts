import type { Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

/** Options every scheduled job should run with: room for a full sweep instead of the 60 s default. */
export const JOB_OPTIONS = { timeoutSeconds: 540, memory: '512MiB' } as const;

export interface SweepOptions {
  /** Documents read per page. */
  pageSize?: number;
  /** Documents processed at the same time (each usually runs its own transaction). */
  concurrency?: number;
  /** Stop starting new pages after this long; the next run continues (stay below JOB_OPTIONS.timeoutSeconds). */
  budgetMs?: number;
}

export interface SweepResult {
  /** Documents looked at. */
  processed: number;
  /** Documents `perDoc` reported as changed. */
  changed: number;
  /** Documents whose `perDoc` threw (logged with their path and skipped). */
  failed: number;
  /** False when the time budget ran out before the query was exhausted. */
  complete: boolean;
}

/**
 * Runs `perDoc` for every document `query` selects, page by page, a few at a
 * time. Built for idempotent jobs whose query selects only work still due
 * (e.g. "ACTIVE and endAt <= now"): a document that fails is logged and
 * skipped, so one bad record can never stall the rest, and the next run
 * retries it. Logs one summary line per run for monitoring.
 */
export async function sweep(
  name: string,
  query: Query,
  perDoc: (doc: QueryDocumentSnapshot) => Promise<boolean | void>,
  { pageSize = 200, concurrency = 8, budgetMs = 480_000 }: SweepOptions = {},
): Promise<SweepResult> {
  const started = Date.now();
  const result: SweepResult = { processed: 0, changed: 0, failed: 0, complete: true };
  let last: QueryDocumentSnapshot | undefined;
  for (;;) {
    if (Date.now() - started > budgetMs) {
      result.complete = false;
      break;
    }
    const page = await (last ? query.startAfter(last) : query).limit(pageSize).get();
    await inChunks(page.docs, concurrency, async (doc) => {
      result.processed += 1;
      try {
        if ((await perDoc(doc)) !== false) result.changed += 1;
      } catch (e) {
        result.failed += 1;
        logger.error(`${name}: ${doc.ref.path} failed`, { job: name, path: doc.ref.path, error: e instanceof Error ? e.message : String(e) });
      }
    });
    if (page.size < pageSize) break;
    last = page.docs[page.docs.length - 1];
  }
  const log = result.failed || !result.complete ? logger.warn : logger.info;
  log(`${name}: ${result.changed} changed, ${result.failed} failed, ${result.processed} checked${result.complete ? '' : ' (time budget reached; the next run continues)'}`, { job: name, ...result, ms: Date.now() - started });
  return result;
}

/** Runs `fn` over `items`, at most `size` at a time; errors must be handled inside `fn`. */
export async function inChunks<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}
