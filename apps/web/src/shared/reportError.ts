// Client error reporting. Every unexpected failure the app sees goes through
// reportError(): the route error screen, failed reads (useAsync), failed
// actions that aren't a server's user-facing answer (useSubmit, useAction),
// and uncaught errors and promise rejections.
//
// For now a report is logged to the console as one structured object and kept
// in a small in-memory buffer (recentErrors()). To send reports somewhere,
// change `sink` below (e.g. to a callable or Sentry's captureException).

export interface ErrorReport {
  at: string;
  /** Where it was caught: 'route', 'load', 'action', 'window', 'promise'… */
  source: string;
  name: string;
  message: string;
  /** Firebase / server code, when there is one. */
  code?: string;
  stack?: string;
  url: string;
  context?: Record<string, unknown>;
}

type Sink = (report: ErrorReport, error: unknown) => void;

const consoleSink: Sink = (report) => console.error('[stories] error', report);

let sink: Sink = consoleSink;

/** Replaces where reports go (tests; or a real sink at startup). Returns the previous one. */
export function setErrorSink(next: Sink): Sink {
  const previous = sink;
  sink = next;
  return previous;
}

const LIMIT = 50;
const buffer: ErrorReport[] = [];

/** The latest reports, oldest first (at most 50). */
export const recentErrors = (): readonly ErrorReport[] => buffer;

function describe(error: unknown): Pick<ErrorReport, 'name' | 'message' | 'code' | 'stack'> {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return { name: error.name, message: error.message, code: typeof code === 'string' ? code : undefined, stack: error.stack };
  }
  if (error && typeof error === 'object') {
    const { status, statusText, data } = error as { status?: unknown; statusText?: unknown; data?: unknown };
    // A route error response (404 etc.).
    if (typeof status === 'number') return { name: 'Response', message: `${status} ${String(statusText ?? '')}`.trim(), code: String(status), stack: typeof data === 'string' ? data : undefined };
  }
  return { name: typeof error, message: String(error) };
}

let last: { key: string; at: number } | null = null;

/** Records an unexpected failure. Never throws. */
export function reportError(error: unknown, source: string, context?: Record<string, unknown>): ErrorReport | null {
  try {
    const report: ErrorReport = {
      at: new Date().toISOString(),
      source,
      ...describe(error),
      url: typeof location === 'undefined' ? '' : location.pathname,
      ...(context && { context }),
    };
    // The same failure reported twice in a row (StrictMode effects, a retry loop) counts once.
    const key = `${source}|${report.name}|${report.message}`;
    const now = Date.now();
    if (last && last.key === key && now - last.at < 2000) return null;
    last = { key, at: now };
    buffer.push(report);
    if (buffer.length > LIMIT) buffer.shift();
    sink(report, error);
    return report;
  } catch {
    return null;
  }
}

let installed = false;

/** Reports uncaught errors and unhandled promise rejections (once per page). */
export function installGlobalErrorReporting(target: Window = window) {
  if (installed) return;
  installed = true;
  target.addEventListener('error', (e) => {
    // Failed <script>/<img> loads arrive here too, without an error object.
    reportError(e.error ?? e.message, 'window', e.filename ? { file: e.filename, line: e.lineno, column: e.colno } : undefined);
  });
  target.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'));
}
