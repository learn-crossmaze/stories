import { useState } from 'react';

import { type CallTap, downloadCsv, listCalls } from '../../data/site';
import { useAsync } from '../../shared/useAsync';
import { EmptyState, ErrorState, SkeletonRows, TableWrap } from '../../shared/ui';
import { st } from '../../strings/site';

const PERIODS = [7, 30, 90] as const;
const pretty = (n: string) => (n.length === 12 && n.startsWith('91') ? `+91 ${n.slice(2, 7)} ${n.slice(7)}` : n.length === 10 ? `+91 ${n.slice(0, 5)} ${n.slice(5)}` : n);
const pageOf = (c: CallTap) => (c.page === '/' ? st.homePage : c.page || '–');

/** Counts by a key, largest first, with calls and WhatsApp apart. Several taps in one visit count once. */
function tally(rows: CallTap[], key: (c: CallTap) => string) {
  const seen = new Set<string>();
  const counts = new Map<string, { calls: number; whatsapp: number }>();
  for (const r of rows) {
    const k = key(r) || st.unknown;
    const once = `${r.visit || r.id}|${k}|${r.channel}`;
    if (seen.has(once)) continue;
    seen.add(once);
    const entry = counts.get(k) ?? { calls: 0, whatsapp: 0 };
    if (r.channel === 'whatsapp') entry.whatsapp += 1;
    else entry.calls += 1;
    counts.set(k, entry);
  }
  return [...counts.entries()].sort((a, b) => b[1].calls + b[1].whatsapp - (a[1].calls + a[1].whatsapp));
}

function Tally({ title, rows }: { title: string; rows: [string, { calls: number; whatsapp: number }][] }) {
  return (
    <section className="card">
      <h2 className="h3">{title}</h2>
      <TableWrap label={title}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{title}</th>
              <th scope="col">{st.call}</th>
              <th scope="col">WhatsApp</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v.calls}</td>
                <td>{v.whatsapp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </section>
  );
}

/**
 * Calls (as on crossmaze.in): every tap on a call or WhatsApp button on the website, by branch, page and how the visit
 * started. A website can't see who called or whether the call went through, only the tap.
 */
export function CallsPage() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(7);
  const data = useAsync(() => listCalls(days), [days]);
  const rows = data.data ?? [];
  const branchOf = (c: CallTap) => c.branch || pretty(c.number);
  return (
    <>
      <header className="page-header page-header-row">
        <div>
          <h1>{st.navCalls}</h1>
          <p className="muted">{st.callsIntro}</p>
        </div>
        <button
          type="button"
          className="btn btn-outlined"
          disabled={!rows.length}
          onClick={() => downloadCsv(`stories-calls-${new Date().toISOString().slice(0, 10)}.csv`, ['When', 'Button', 'Branch', 'Number', 'Page', 'Where on the page', 'Came from', 'Device'], rows.map((c) => [c.createdAt, c.channel === 'whatsapp' ? 'WhatsApp' : 'Call', c.branch, pretty(c.number), c.page, c.place, c.source, c.device]))}
        >
          {st.exportCsv}
        </button>
      </header>
      <div className="toolbar" role="group" aria-label={st.period}>
        {PERIODS.map((p) => (
          <button key={p} type="button" className="chip" aria-pressed={days === p} onClick={() => setDays(p)}>
            {st.lastDays(p)}
          </button>
        ))}
      </div>
      {data.loading ? (
        <SkeletonRows />
      ) : data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : !rows.length ? (
        <EmptyState icon="insights" title={st.noCalls} message={st.noCallsHint} />
      ) : (
        <>
          <ul className="site-sections stat-row">
            <li className="card stat"><strong>{rows.filter((r) => r.channel === 'phone').length}</strong><span>{st.callTaps}</span></li>
            <li className="card stat"><strong>{rows.filter((r) => r.channel === 'whatsapp').length}</strong><span>{st.whatsappTaps}</span></li>
            <li className="card stat"><strong>{new Set(rows.map((r) => r.visit || r.id)).size}</strong><span>{st.visitors}</span></li>
          </ul>
          <div className="calls-grid">
            <Tally title={st.byBranch} rows={tally(rows, branchOf)} />
            <Tally title={st.byPage} rows={tally(rows, pageOf)} />
            <Tally title={st.bySource} rows={tally(rows, (c) => c.source)} />
            <Tally title={st.byDevice} rows={tally(rows, (c) => c.device)} />
          </div>
          <p className="muted small">{st.callsNote}</p>
        </>
      )}
    </>
  );
}
