import { useState } from 'react';

import type { SubscriptionUpgrade, UpgradeOption, UpgradeQuote } from '../data/billing';
import { planWithOption } from '../data/common';
import { t } from '../strings';
import { asDate, day, money } from './format';

// Upgrading mid-term (functions/src/billing/upgrade.ts), shared by the staff
// console's member page and the member app's Membership tab: the credit for
// the days left, the plans to choose from, and what each costs today.

const key = (o: Pick<UpgradeOption, 'planId' | 'duration'>) => `${o.planId}:${o.duration}`;

/** How the credit for the current plan's unused days was worked out. */
function CurrentCredit({ current }: { current: NonNullable<UpgradeQuote['current']> }) {
  return (
    <div className="upgrade-current">
      <p>
        {t.upCurrent(planWithOption({ name: current.planName, duration: current.duration ?? undefined }), money(current.priceMinor), current.termDays)}
      </p>
      <p>
        <strong>{t.upLeft(current.unusedDays, current.termDays, money(current.creditMinor))}</strong>
      </p>
      <p className="muted small">{t.upHowWorkedOut(money(current.priceMinor), current.unusedDays, current.termDays, money(current.creditMinor))}</p>
    </div>
  );
}

/** Line by line: new price, less the credit, deposit, total, and when the new plan runs. */
export function UpgradeBreakdown({
  newPlan,
  priceMinor,
  creditMinor,
  unusedDays,
  fromPlan,
  subscriptionMinor,
  depositMinor,
  totalMinor,
  runs,
}: {
  newPlan: string;
  priceMinor: number;
  creditMinor: number;
  unusedDays: number;
  fromPlan: string;
  subscriptionMinor: number;
  depositMinor: number;
  totalMinor: number;
  runs?: { from: string; to: string };
}) {
  return (
    <dl className="facts upgrade-breakdown">
      <dt>{t.upNewPlan(newPlan)}</dt>
      <dd>{money(priceMinor)}</dd>
      <dt>{t.upCredit(unusedDays, fromPlan)}</dt>
      <dd>−{money(creditMinor)}</dd>
      <dt>{t.upPlanFee}</dt>
      <dd>{money(subscriptionMinor)}</dd>
      {depositMinor > 0 && (
        <>
          <dt>{t.upDeposit}</dt>
          <dd>{money(depositMinor)}</dd>
        </>
      )}
      <dt>{t.upTotal}</dt>
      <dd>
        <strong>{money(totalMinor)}</strong>
      </dd>
      {runs && (
        <>
          <dt>{t.upRuns}</dt>
          <dd>{t.upRunsValue(runs.from, runs.to)}</dd>
        </>
      )}
    </dl>
  );
}

/** The breakdown of an upgrade waiting for payment (from what was stored when it was created). */
export function PendingUpgrade({ upgrade, planName, amountDue }: { upgrade: SubscriptionUpgrade; planName: string; amountDue: { subscriptionMinor: number; depositMinor: number; totalMinor: number } }) {
  const lapsed = (asDate(upgrade.validUntil)?.getTime() ?? Infinity) < Date.now();
  return (
    <>
      <UpgradeBreakdown
        newPlan={planName}
        priceMinor={upgrade.newPriceMinor}
        creditMinor={upgrade.creditMinor}
        unusedDays={upgrade.unusedDays}
        fromPlan={upgrade.fromPlanName}
        subscriptionMinor={amountDue.subscriptionMinor}
        depositMinor={amountDue.depositMinor}
        totalMinor={amountDue.totalMinor}
      />
      {lapsed ? <p className="notice notice-warn">{t.upLapsed}</p> : <p className="muted small">{t.upValidUntil(day(upgrade.validUntil))}</p>}
    </>
  );
}

/**
 * The quote: the current plan's credit, a choice of bigger plans with the
 * amount due for each, and the full breakdown for the one chosen.
 */
export function UpgradeChooser({
  quote,
  busy,
  onUpgrade,
  error,
}: {
  quote: UpgradeQuote;
  busy: boolean;
  onUpgrade: (o: UpgradeOption) => void;
  error?: string | null;
}) {
  const [picked, setPicked] = useState('');
  const chosen = quote.options.find((o) => key(o) === picked) ?? quote.options[0];
  const current = quote.current;
  return (
    <div className="upgrade">
      {current && <CurrentCredit current={current} />}
      {quote.blocked || !chosen || !current ? (
        <p className="muted">{quote.blocked ?? t.upNone}</p>
      ) : (
        <>
          <fieldset className="choices plan-choices">
            <legend>{t.upChoose}</legend>
            {quote.options.map((o) => (
              <label key={key(o)} className="plan-choice">
                <input type="radio" name="upgrade" checked={key(chosen) === key(o)} onChange={() => setPicked(key(o))} />
                <span>
                  <strong>{planWithOption({ name: o.planName, duration: o.duration })}</strong> · {t.upBooks(o.maxSimultaneousBooks)}
                  <span className="muted small">
                    {' '}
                    {money(o.priceMinor)} − {money(o.creditMinor)} {o.discountLabel ? `· ${o.discountLabel}` : ''}
                  </span>
                  <span className="upgrade-pay">{t.upPayNow(money(o.totalMinor))}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <UpgradeBreakdown
            newPlan={planWithOption({ name: chosen.planName, duration: chosen.duration })}
            priceMinor={chosen.priceMinor}
            creditMinor={chosen.creditMinor}
            unusedDays={current.unusedDays}
            fromPlan={current.planName}
            subscriptionMinor={chosen.subscriptionMinor}
            depositMinor={chosen.depositMinor}
            totalMinor={chosen.totalMinor}
            runs={{ from: day(chosen.startAt), to: day(chosen.endAt) }}
          />
          <p className="muted small">{t.upValidUntil(day(quote.validUntil))}</p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="button" className="btn btn-filled" disabled={busy} onClick={() => onUpgrade(chosen)}>
              {busy ? t.saving : t.upSubmit(money(chosen.totalMinor))}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

