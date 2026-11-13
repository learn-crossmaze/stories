import { doc, type DocumentSnapshot, getDoc, onSnapshot } from 'firebase/firestore';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';

import { ApiError, call, command, errorText } from '../../data/api';
import type { Branch } from '../../data/org';
import { services } from '../../data/services';
import { money, when } from '../../shared/format';
import { t } from '../../strings';
import { Dialog, DialogActions, FormError, TextField, useAction, useSubmit } from '../components/Dialog';
import { Notice } from '../components/kit';
import { lt } from '../../strings/library';

export type RazorpaySettings = NonNullable<NonNullable<Branch['payments']>['razorpay']>;

/** Where Razorpay should send events for this branch. */
export function webhookUrl(orgId: string, branchId: string) {
  const { fns } = services();
  const project = fns.app.options.projectId ?? 'PROJECT';
  return `https://${fns.region}-${project}.cloudfunctions.net/razorpayWebhook?o=${encodeURIComponent(orgId)}&b=${encodeURIComponent(branchId)}`;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Branches → Payments: the branch's Razorpay account (secrets are write-only). */
export function PaymentGatewayDialog({ orgId, branch, onClose, onSaved }: { orgId: string; branch: Branch; onClose: () => void; onSaved: () => void }) {
  const saved = branch.payments?.razorpay;
  const [f, setF] = useState({
    enabled: saved?.enabled ?? true,
    keyId: saved?.keyId ?? '',
    keySecret: '',
    webhookSecret: '',
    notifySms: saved?.notifySms ?? true,
    notifyEmail: saved?.notifyEmail ?? true,
  });
  const [touched, setTouched] = useState(false);
  const [test, setTest] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const url = webhookUrl(orgId, branch.id);
  const keyChanged = !saved || saved.keyId !== f.keyId.trim();
  const errors = {
    keyId: /^rzp_(test|live)_[A-Za-z0-9]{8,32}$/.test(f.keyId.trim()) ? undefined : lt.pgKeyIdHint,
    keySecret: keyChanged && !f.keySecret.trim() ? lt.pgSecretNeeded : undefined,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (errors.keyId || errors.keySecret) return;
    await command('branches-setPaymentGateway', { orgId, branchId: branch.id, ...f, keyId: f.keyId.trim(), keySecret: f.keySecret.trim(), webhookSecret: f.webhookSecret.trim() });
    onSaved();
    onClose();
  });
  const runTest = async () => {
    setTest(null);
    try {
      const r = await call<{ mode: string }>('branches-testPaymentGateway', { orgId, branchId: branch.id });
      setTest({ tone: 'ok', text: lt.pgTestOk(r.mode) });
    } catch (e) {
      setTest({ tone: 'error', text: errorText(e, lt.pgTestFailed) });
    }
  };
  const live = f.keyId.startsWith('rzp_live_');

  return (
    <Dialog title={lt.pgTitle(branch.name)} onClose={onClose}>
      <form onSubmit={submit} noValidate className="form-grid">
        <p className="span-2 muted">{lt.pgIntro}</p>
        <label className="check span-2">
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
          {lt.pgEnabled}
        </label>
        <div className="span-2">
          <TextField label={lt.pgKeyId} value={f.keyId} onChange={(keyId) => setF({ ...f, keyId })} hint={live ? lt.pgLive : lt.pgKeyIdHint} error={touched ? errors.keyId : undefined} autoComplete="off" />
        </div>
        <TextField
          label={lt.pgKeySecret}
          type="password"
          value={f.keySecret}
          onChange={(keySecret) => setF({ ...f, keySecret })}
          hint={saved && !keyChanged ? lt.pgSecretSaved : undefined}
          error={touched ? errors.keySecret : undefined}
          autoComplete="new-password"
        />
        <TextField
          label={lt.pgWebhookSecret}
          type="password"
          value={f.webhookSecret}
          onChange={(webhookSecret) => setF({ ...f, webhookSecret })}
          hint={saved?.hasWebhookSecret ? lt.pgSecretSaved : lt.pgWebhookSecretHint}
          autoComplete="new-password"
        />
        <fieldset className="choices span-2">
          <legend>{lt.pgSendLinkBy}</legend>
          <label className="check">
            <input type="checkbox" checked={f.notifySms} onChange={(e) => setF({ ...f, notifySms: e.target.checked })} /> {lt.pgSms}
          </label>
          <label className="check">
            <input type="checkbox" checked={f.notifyEmail} onChange={(e) => setF({ ...f, notifyEmail: e.target.checked })} /> {lt.pgEmail}
          </label>
        </fieldset>
        <details className="span-2 numbering-help" open={!saved}>
          <summary>{lt.pgWebhookTitle}</summary>
          <ol className="small">
            <li>{lt.pgWebhookStep1}</li>
            <li>
              {lt.pgWebhookStep2}
              <div className="lookup-bar" style={{ marginTop: 4 }}>
                <input readOnly value={url} aria-label={lt.pgWebhookUrl} onFocus={(e) => e.target.select()} />
                <button type="button" className="btn btn-outlined" onClick={async () => setCopied(await copy(url))}>
                  {copied ? lt.copied : lt.copyText}
                </button>
              </div>
            </li>
            <li>{lt.pgWebhookStep3}</li>
            <li>{lt.pgWebhookStep4}</li>
          </ol>
        </details>
        {saved && (
          <div className="span-2 row">
            <button type="button" className="btn btn-text" onClick={() => void runTest()}>
              {lt.pgTest}
            </button>
            {test && <Notice tone={test.tone}>{test.text}</Notice>}
          </div>
        )}
        <div className="span-2">
          <FormError error={error} />
          <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
        </div>
      </form>
    </Dialog>
  );
}

interface PaymentRequest {
  requestId: string;
  channel: 'LINK' | 'QR' | 'QR_LINK';
  url: string | null;
  qrImageUrl: string | null;
  amountMinor: number;
  status: string;
  sentTo: { sms: string | null; email: string | null };
  expiresAt: string;
  mode: string;
}

/**
 * When the dialog asks Razorpay by itself whether an open request was paid (ms from the request being shown):
 * first after `first`, then every `fast` until `slowAfter`, every `slow` until `stopAfter`, then no more.
 */
export const AUTO_CHECK = { first: 4_000, fast: 3_000, slowAfter: 60_000, slow: 6_000, stopAfter: 120_000 };
/** Answers after which asking again is pointless (no right to see payments here, the request or the gateway is gone). */
const AUTO_CHECK_GIVE_UP = new Set(['FORBIDDEN', 'PERMISSION-DENIED', 'NOT_FOUND', 'NOT-FOUND', 'UNAUTHENTICATED', 'GATEWAY_NOT_CONFIGURED', 'SERVER_OUTDATED']);
const AUTO_CHECK_MAX_FAILURES = 3;

/** Member page → "Collect online": send a Razorpay payment link or show a UPI QR code, then watch for the payment. */
export function CollectOnlineDialog({
  orgId,
  subscriptionId,
  amountMinor,
  member,
  onClose,
  onPaid,
}: {
  orgId: string;
  subscriptionId: string;
  amountMinor: number;
  member: { phone: string | null; email: string | null };
  onClose: () => void;
  onPaid: () => void;
}) {
  const [req, setReq] = useState<PaymentRequest | null>(null);
  const [status, setStatus] = useState<string>('OPEN');
  const [needsAttention, setNeedsAttention] = useState<string | null>(null);
  // One request at a time: creating a link twice would message the member twice.
  const action = useAction();
  const { pending: busy, error, setError } = action;
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // What the request document says, taken whole: "paid" and "paid but not applied" must arrive together, or the
  // "payment recorded" notice below would fire for money that still needs someone's attention.
  const show = (s: DocumentSnapshot) => {
    if (!s.exists()) return;
    setStatus(s.get('status') as string);
    setNeedsAttention((s.get('needsAttention') as string | undefined) ?? null);
  };

  // Live status: the request is marked paid by the webhook or by a status check (the automatic one below, or the
  // button), and the dialog updates by itself.
  useEffect(() => {
    if (!req) return;
    return onSnapshot(doc(services().db, `orgs/${orgId}/paymentRequests/${req.requestId}`), show, (e) => console.warn('payment request watch failed', e));
  }, [orgId, req]);

  // While the request is open the dialog asks Razorpay by itself. The webhook alone keeps the counter waiting: it
  // is served by a function of its own that is usually asleep, and it may be late or not set up at all. This only
  // makes the server look; what the dialog shows still comes from the listener above. Silent, and it gives up by
  // itself (AUTO_CHECK): the button stays for anything it misses.
  const acting = useRef(busy);
  acting.current = busy;
  useEffect(() => {
    if (!req || status !== 'OPEN') return;
    const paymentRequestId = req.requestId;
    const started = Date.now();
    const expires = new Date(req.expiresAt).getTime();
    let stopped = false;
    let asking = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      stopped = true;
      clearTimeout(timer);
    };
    const over = () => stopped || Date.now() - started >= AUTO_CHECK.stopAfter || Date.now() >= expires;
    const schedule = () => {
      clearTimeout(timer);
      if (over()) return stop();
      const age = Date.now() - started;
      timer = setTimeout(() => void tick(), age < AUTO_CHECK.first ? AUTO_CHECK.first - age : age < AUTO_CHECK.slowAfter ? AUTO_CHECK.fast : AUTO_CHECK.slow);
    };
    const tick = async () => {
      if (asking) return;
      if (over()) return stop();
      // Not behind a hidden tab, and not while Cancel or Check is running (one question to the server at a time).
      if (document.visibilityState === 'hidden' || acting.current) return schedule();
      asking = true;
      try {
        const r = await call<{ status: string }>('payments-checkRequest', { orgId, paymentRequestId });
        failures = 0;
        if (r.status !== 'OPEN') stop();
      } catch (e) {
        failures++;
        if (failures >= AUTO_CHECK_MAX_FAILURES || (e instanceof ApiError && AUTO_CHECK_GIVE_UP.has(e.reason))) stop();
      } finally {
        asking = false;
      }
      schedule();
    };
    // Back on this tab: ask at once instead of waiting out the timer.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - started >= AUTO_CHECK.first) void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    schedule();
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [orgId, req, status]);

  useEffect(() => {
    if (status === 'PAID' && !needsAttention) onPaid();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, needsAttention]);

  // A payment link shown as a QR code (accounts without Razorpay UPI QR codes).
  useEffect(() => {
    if (req?.channel === 'QR_LINK' && req.url) void QRCode.toDataURL(req.url, { margin: 1, width: 280 }).then(setQr);
  }, [req]);

  const run = (label: string, fn: () => Promise<void>) => action.run(fn, label);
  const create = (channel: 'LINK' | 'QR') =>
    run(channel, async () => {
      const r = await call<PaymentRequest>('payments-createRequest', { orgId, subscriptionId, channel, requestId: crypto.randomUUID() });
      setReq(r);
      setStatus(r.status);
    });
  const check = () =>
    run('check', async () => {
      const paymentRequestId = req!.requestId;
      const r = await call<{ status: string; reason?: string; problem?: string }>('payments-checkRequest', { orgId, paymentRequestId });
      if (r.status === 'OPEN') return setError(lt.olNotYet);
      // Settled: shown from the request itself (as the listener does), not from the bare status in the answer.
      const settled = await getDoc(doc(services().db, `orgs/${orgId}/paymentRequests/${paymentRequestId}`)).catch(() => null);
      if (settled?.exists()) return show(settled);
      setNeedsAttention(r.reason === 'NEEDS_ATTENTION' ? (r.problem ?? r.reason) : null);
      setStatus(r.status);
    });
  const cancel = () =>
    run('cancel', async () => {
      await command('payments-cancelRequest', { orgId, paymentRequestId: req!.requestId });
      setReq(null);
      setStatus('OPEN');
    });

  const sentTo = req ? [req.sentTo.sms, req.sentTo.email].filter(Boolean).join(' and ') : '';
  return (
    <Dialog title={`${lt.olTitle} · ${money(amountMinor)}`} onClose={onClose}>
      {!req ? (
        <div className="collect-options">
          <button type="button" className="collect-option" disabled={!!busy || (!member.phone && !member.email)} onClick={() => void create('LINK')}>
            <strong>{busy === 'LINK' ? lt.olCreating : lt.olLink}</strong>
            <span className="muted small">{member.phone || member.email ? lt.olLinkHint([member.phone, member.email].filter(Boolean).join(' · ')) : lt.olNoContact}</span>
          </button>
          <button type="button" className="collect-option" disabled={!!busy} onClick={() => void create('QR')}>
            <strong>{busy === 'QR' ? lt.olCreating : lt.olQr}</strong>
            <span className="muted small">{lt.olQrHint}</span>
          </button>
        </div>
      ) : status === 'PAID' ? (
        needsAttention ? <Notice tone="warn">{lt.olAttention(needsAttention)}</Notice> : <Notice tone="ok">{lt.olPaid}</Notice>
      ) : status !== 'OPEN' ? (
        <Notice tone="warn">{lt.olClosed(status.toLowerCase())}</Notice>
      ) : (
        <div className="collect-result">
          {req.mode === 'test' && <p className="badge badge-warn">{lt.olTestMode}</p>}
          {req.channel === 'LINK' && (
            <>
              <p>{sentTo ? lt.olSent(sentTo) : lt.olLinkReady}</p>
              <div className="lookup-bar">
                <input readOnly value={req.url ?? ''} aria-label={lt.olLink} onFocus={(e) => e.target.select()} />
                <button type="button" className="btn btn-outlined" onClick={async () => setCopied(await copy(req.url ?? ''))}>
                  {copied ? lt.copied : lt.copyText}
                </button>
              </div>
            </>
          )}
          {req.channel !== 'LINK' && (
            <div className="qr-box">
              {req.qrImageUrl ? <img src={req.qrImageUrl} alt={lt.olQrAlt} /> : qr ? <img src={qr} alt={lt.olQrAlt} /> : null}
              <p className="small muted">{req.channel === 'QR' ? lt.olScanUpi : lt.olScanLink}</p>
            </div>
          )}
          <p className="muted small">
            {lt.olWaiting} · {lt.olExpires(when(new Date(req.expiresAt)))}
          </p>
        </div>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        {req && status === 'OPEN' && (
          <>
            <button type="button" className="btn btn-text" disabled={!!busy} onClick={() => void cancel()}>
              {busy === 'cancel' ? lt.olCancelling : lt.olCancel}
            </button>
            <button type="button" className="btn btn-outlined" disabled={!!busy} onClick={() => void check()}>
              {busy === 'check' ? lt.olChecking : lt.olCheck}
            </button>
          </>
        )}
        <button type="button" className="btn btn-filled" onClick={onClose}>
          {status === 'PAID' ? lt.finished : lt.close}
        </button>
      </div>
    </Dialog>
  );
}
