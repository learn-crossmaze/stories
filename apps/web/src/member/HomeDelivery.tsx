import { useState } from 'react';
import { Link } from 'react-router';

import { toApiError } from '../data/api';
import { cancelMyDelivery, type Delivery, OPEN, requestDelivery } from '../data/delivery';
import type { Membership } from '../data/me';
import { paths } from '../paths';
import { DeliveryRequestForm } from '../shared/DeliveryRequestForm';
import { day, money } from '../shared/format';
import { dt } from '../strings/delivery';
import { useMemberData } from './memberData';

// My Books → Home delivery: book a delivery, pickup or exchange from the home
// branch (when its plan includes delivery), follow it, and cancel it before it goes out.

const now = () => Date.now();
const live = (s: Membership['subscriptions'][number]) =>
  s.status === 'ACTIVE' && !!s.startAt && Date.parse(s.startAt) <= now() && !!s.endAt && Date.parse(s.endAt) > now();

function Current({ m, d }: { m: Membership; d: Delivery }) {
  const { overview } = useMemberData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const track = d.provider?.trackingUrl ?? d.courier?.trackingUrl ?? null;
  return (
    <div className="card">
      <p>
        <strong>{dt.kind[d.kind]}</strong> · {day(d.date)}
        {d.slot && `, ${d.slot}`} · <span className="badge badge-info">{dt.status[d.status]}</span>
      </p>
      {d.status === 'OUT' && d.rider && (
        <p className="small">
          {d.rider.name}
          {d.rider.phone && (
            <>
              {' · '}
              <a href={`tel:${d.rider.phone}`}>{d.rider.phone.replace(/^\+91/, '')}</a>
            </>
          )}
        </p>
      )}
      {d.status === 'OUT' && d.provider?.partner?.name && <p className="small">{dt.partner(d.provider.partner.name, d.provider.partner.phone, d.provider.partner.vehicleNumber)}</p>}
      {track && (
        <p>
          <a href={track} target="_blank" rel="noreferrer">
            {dt.track}
          </a>
        </p>
      )}
      {d.fee.status === 'DUE' && <p className="muted small">{dt.feeToCollect(money(d.fee.amountMinor))}</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {d.status === 'REQUESTED' && (
        <button
          type="button"
          className="btn btn-text danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await cancelMyDelivery(m.orgId, d.id);
              overview.reload();
            } catch (e) {
              setError(toApiError(e).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {dt.cancel}
        </button>
      )}
    </div>
  );
}

export function HomeDelivery({ m }: { m: Membership }) {
  const { overview } = useMemberData();
  const [booking, setBooking] = useState(false);
  const s = m.branch.delivery;
  if (!s?.enabled) return null;
  const deliveries = m.deliveries ?? [];
  const current = deliveries.find((d) => OPEN.includes(d.status));
  const past = deliveries.filter((d) => !OPEN.includes(d.status)).slice(0, 3);
  const term = m.subscriptions.find(live);
  const eligible = !!term?.planSnapshot.deliveryEligible;
  return (
    <section className="section" aria-labelledby="home-delivery">
      <h2 id="home-delivery">{dt.title}</h2>
      {current ? (
        <Current m={m} d={current} />
      ) : !eligible ? (
        <p className="muted">
          {dt.memberNoPlan} <Link to={paths.membership}>{dt.memberChoosePlan}</Link> {dt.memberOrVisit}
        </p>
      ) : booking ? (
        <div className="card">
          <DeliveryRequestForm
            branchId={m.branch.id}
            memberId={m.memberId}
            choices={{
              slots: s.slots,
              maxDaysAhead: s.maxDaysAhead,
              feeMinor: s.feeMinor,
              holds: m.reservations.filter((r) => r.status === 'ALLOCATED' && r.branchId === m.branch.id).map((r) => ({ id: r.id, title: r.bookTitle })),
              loans: m.loans.filter((l) => l.status === 'ACTIVE').map((l) => ({ id: l.id, title: l.bookTitle })),
              address: m.member.address,
            }}
            submitLabel={dt.memberBook}
            onCancel={() => setBooking(false)}
            onSubmit={async (r) => {
              await requestDelivery(m.orgId, r);
              setBooking(false);
              overview.reload();
            }}
          />
        </div>
      ) : (
        <>
          <p className="muted">{dt.memberIntro(m.branch.name, s.feeMinor > 0 ? money(s.feeMinor) : null)}</p>
          <button type="button" className="btn btn-filled" onClick={() => setBooking(true)}>
            {dt.memberBook}
          </button>
        </>
      )}
      {past.length > 0 && (
        <ul className="plain-list">
          {past.map((d) => (
            <li key={d.id}>
              <span>
                {dt.kind[d.kind]} · {day(d.date)}
              </span>
              <span className="muted small">{d.outcome ? dt.outcome[d.outcome] : dt.status[d.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
