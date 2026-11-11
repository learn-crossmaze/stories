import { useState } from 'react';

import { libraryRules, type LibraryRules, setLibraryRules } from '../../data/roles';
import { toMinor } from '../../shared/format';
import { ErrorState, NoOrgState, SkeletonRows } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ct } from '../../strings/control';
import { FormError, TextField, useSubmit } from '../components/Dialog';
import { Notice } from '../components/kit';
import { useWorkspace } from '../Workspace';

// Master control → Library rules: the organization's rules that were only standard values in code (how long a
// reserved book waits, when a deposit adjustment needs a second person). Server: functions/src/organization/libraryRules.ts.

function Form({ orgId, rules, defaults, onSaved }: { orgId: string; rules: LibraryRules; defaults: LibraryRules; onSaved: () => void }) {
  const [hold, setHold] = useState(String(rules.reservationHoldHours));
  const [threshold, setThreshold] = useState(String(rules.makerCheckerThresholdMinor / 100));
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(false);
  const holdN = Number(hold);
  const thresholdMinor = toMinor(threshold || '0');
  const errors = {
    hold: Number.isInteger(holdN) && holdN >= 1 && holdN <= 336 ? undefined : ct.holdHoursError,
    threshold: Number.isFinite(thresholdMinor) && thresholdMinor >= 0 ? undefined : ct.thresholdError,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    setSaved(false);
    if (errors.hold || errors.threshold) return;
    await setLibraryRules(orgId, { reservationHoldHours: holdN, makerCheckerThresholdMinor: thresholdMinor });
    setSaved(true);
    onSaved();
  });
  return (
    <form onSubmit={submit} noValidate>
      <section className="card">
        <TextField label={ct.holdHours} type="number" value={hold} onChange={setHold} hint={ct.holdHoursHint(defaults.reservationHoldHours)} error={touched ? errors.hold : undefined} />
        <TextField label={ct.threshold} type="number" value={threshold} onChange={setThreshold} hint={ct.thresholdHint} error={touched ? errors.threshold : undefined} />
        <FormError error={error} />
        {saved && <Notice tone="ok">{ct.rulesSaved}</Notice>}
        <button type="submit" className="btn btn-filled" disabled={busy}>
          {busy ? t.saving : t.save}
        </button>
      </section>
    </form>
  );
}

export function LibraryRulesPage() {
  const { org } = useWorkspace();
  const data = useAsync(() => (org ? libraryRules(org.id) : Promise.resolve(null)), [org?.id]);
  if (!org) return <NoOrgState />;
  return (
    <>
      <header className="page-header">
        <h1>{ct.rulesTitle}</h1>
        <p className="muted">{ct.rulesIntro}</p>
      </header>
      {data.loading ? (
        <SkeletonRows />
      ) : data.error || !data.data ? (
        <ErrorState message={data.error ?? ''} onRetry={data.reload} />
      ) : (
        <Form key={org.id} orgId={org.id} rules={data.data.rules} defaults={data.data.defaults} onSaved={data.reload} />
      )}
    </>
  );
}
