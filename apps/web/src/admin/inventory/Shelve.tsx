import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { label } from '../../data/common';
import { type Copy, findCopy, listLocations, shelveCopies, unshelvedCopies, UNSHELVED_PAGE } from '../../data/inventory';
import { useAsync } from '../../shared/useAsync';
import { paths } from '../../paths';
import { t } from '../../strings';
import { lt } from '../../strings/library';
import { EmptyState, ErrorState, SkeletonRows, TableWrap } from '../../shared/ui';
import { FormError, SelectField, useSubmit } from '../components/Dialog';
import { NeedBranch, Notice, ScanInput } from '../components/kit';
import { useWorkspace } from '../Workspace';

/** Copies that are in the building and may go on a shelf (as copies-shelve allows). */
const SHELVABLE = ['AVAILABLE', 'RESERVED', 'UNDER_INSPECTION', 'DAMAGED'];

/**
 * Collection → Shelve books: every copy at the branch that is available but
 * not on a shelf (new stock, returned books after inspection), put on one
 * shelf in a single step. Scanning a copy ticks it, and also brings in a copy
 * that is already shelved elsewhere, to move it.
 */
function BranchShelving({ orgId, branchId }: { orgId: string; branchId: string }) {
  const waiting = useAsync(() => unshelvedCopies(orgId, branchId), [orgId, branchId]);
  const locations = useAsync(() => listLocations(orgId, branchId), [orgId, branchId]);
  const shelves = (locations.data ?? []).filter((l) => l.status === 'ACTIVE');
  const [shelf, setShelf] = useState('');
  const [extra, setExtra] = useState<Copy[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  // A fresh list after shelving: clear the ticks and the scanned-in copies.
  useEffect(() => {
    setPicked([]);
    setExtra([]);
  }, [waiting.data]);

  const rows = [...extra, ...(waiting.data ?? [])];
  const shelfName = (id: string | null) => {
    const l = shelves.find((x) => x.id === id) ?? locations.data?.find((x) => x.id === id);
    return l ? `${l.code} · ${l.label}` : '—';
  };
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const allPicked = rows.length > 0 && rows.every((r) => picked.includes(r.id));

  const onScan = async (value: string) => {
    setMsg(null);
    const v = value.toUpperCase();
    const known = rows.find((r) => r.barcode === v || r.code === v);
    if (known) {
      setPicked((p) => (p.includes(known.id) ? p : [...p, known.id]));
      return;
    }
    const c = await findCopy(orgId, branchId, v);
    if (!c) return setMsg({ tone: 'warn', text: lt.shelveNotHere(v) });
    if (!SHELVABLE.includes(c.status)) return setMsg({ tone: 'warn', text: lt.shelveCantShelve(c.code, label(c.status)) });
    setExtra((x) => [c, ...x]);
    setPicked((p) => [...p, c.id]);
    if (c.locationId) setMsg({ tone: 'ok', text: lt.shelveScannedOther(c.code, shelfName(c.locationId)) });
  };

  const { busy, error, submit } = useSubmit(async () => {
    const ids = rows.filter((r) => picked.includes(r.id)).map((r) => r.id);
    await shelveCopies(orgId, branchId, shelf, ids);
    setMsg({ tone: 'ok', text: lt.shelveDone(ids.length, shelfName(shelf)) });
    waiting.reload();
  });

  if (waiting.error) return <ErrorState message={waiting.error} onRetry={waiting.reload} />;
  if (waiting.loading || locations.loading) return <SkeletonRows rows={5} />;

  return (
    <>
      {shelves.length === 0 ? (
        <Notice tone="warn">
          {lt.shelveNoShelves} <Link to={paths.adminInventory}>{lt.inventoryTitle}</Link>
        </Notice>
      ) : (
        <div className="card shelve-bar">
          <SelectField
            label={lt.shelveShelf}
            value={shelf}
            onChange={setShelf}
            options={[{ value: '', label: lt.shelvePickShelf }, ...shelves.map((l) => ({ value: l.id, label: `${l.code} · ${l.label}` }))]}
          />
          <ScanInput label={lt.shelveScan} onScan={onScan} />
          <FormError error={error} />
          <div className="row">
            <button type="button" className="btn btn-filled" disabled={busy || !shelf || picked.length === 0} onClick={() => submit()}>
              {busy ? t.saving : lt.shelveSubmit(picked.length)}
            </button>
          </div>
        </div>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {rows.length === 0 ? (
        <EmptyState icon="check" title={lt.shelveEmpty} message="" />
      ) : (
        <>
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" className="check-col">
                    <input
                      type="checkbox"
                      aria-label={lt.shelveSelectAll}
                      checked={allPicked}
                      onChange={() => setPicked(allPicked ? [] : rows.map((r) => r.id))}
                    />
                  </th>
                  <th scope="col">{lt.copy}</th>
                  <th scope="col">{lt.title}</th>
                  <th scope="col">{lt.condition}</th>
                  <th scope="col">{lt.location}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className={picked.includes(c.id) ? 'row-selected' : undefined}>
                    <td className="check-col">
                      <input type="checkbox" aria-label={lt.shelveSelectRow(c.code)} checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
                    </td>
                    <td className="nowrap">
                      <Link to={paths.adminCopy(c.id)} className="mono">
                        {c.code}
                      </Link>
                    </td>
                    <td>{c.bookTitle}</td>
                    <td>{label(c.condition)}</td>
                    <td className={c.locationId ? 'mono' : 'muted'}>{c.locationId ? shelfName(c.locationId) : lt.unshelved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          {(waiting.data?.length ?? 0) >= UNSHELVED_PAGE && <p className="muted">{lt.shelveMore(UNSHELVED_PAGE)}</p>}
        </>
      )}
    </>
  );
}

export function ShelvePage() {
  const { org } = useWorkspace();
  return (
    <>
      <p className="breadcrumb">
        <Link to={paths.adminInventory}>{lt.inventoryTitle}</Link> / {lt.shelveTitle}
      </p>
      <header className="page-header">
        <h1>{lt.shelveTitle}</h1>
        <p className="muted">{lt.shelveIntro}</p>
      </header>
      <NeedBranch>{(branchId) => org && <BranchShelving orgId={org.id} branchId={branchId} />}</NeedBranch>
    </>
  );
}
