import { useEffect, useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { command } from '../../data/api';
import { type PrivateProfile } from '../../data/hr';
import { myOnboarding, onboardingChanged, type OnboardingStatus, type ProfileField } from '../../data/selfOnboarding';
import { EmptyState, ErrorState, Icon, NoOrgState, SkeletonRows } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { ht } from '../../strings/hr';
import { t } from '../../strings';
import { FormError, SelectField, TextArea, TextField, useSubmit } from '../components/Dialog';
import { Notice } from '../components/kit';
import { useWorkspace } from '../Workspace';
import { BankDialog } from './employeeDialogs';
import { EmployeeDocumentsPanel } from './EmployeeDocuments';

// Staff → Complete my profile (self-onboarding): the details and documents HR
// needs, filled in by the person themselves. The reminder in the shell points here.

const BLOOD_GROUPS = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

type Form = Required<Omit<PrivateProfile, 'bank'>>;

const fromProfile = (p: PrivateProfile): Form => ({
  dob: p.dob ?? '',
  gender: p.gender ?? '',
  bloodGroup: p.bloodGroup ?? '',
  personalEmail: p.personalEmail ?? '',
  personalPhone: p.personalPhone ?? '',
  currentAddress: p.currentAddress ?? '',
  permanentAddress: p.permanentAddress ?? '',
  emergencyName: p.emergencyName ?? '',
  emergencyRelation: p.emergencyRelation ?? '',
  emergencyPhone: p.emergencyPhone ?? '',
  pan: p.pan ?? '',
  uan: p.uan ?? '',
  esiNumber: p.esiNumber ?? '',
});

function Progress({ s }: { s: OnboardingStatus }) {
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 100;
  return (
    <section className="card ob-progress" aria-labelledby="ob-progress">
      <div className="ob-progress-head">
        <h2 id="ob-progress">{s.missing.length ? ht.obStillToDo : ht.obAllDone}</h2>
        <span className="muted">{ht.obProgress(s.done, s.total)}</span>
      </div>
      <div className="ob-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={ht.obProgress(s.done, s.total)}>
        <span style={{ width: `${pct}%` }} />
      </div>
      {s.missing.length > 0 && (
        <ul className="ob-missing">
          {s.missing.map((i) => (
            <li key={i.key}>
              <a href={`#${i.kind === 'document' ? 'ob-docs' : i.key === 'bank' ? 'ob-bank' : `ob-${i.key}`}`}>{i.label}</a>
              {i.note && <span className="muted small"> · {i.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DetailsForm({ orgId, s, onSaved }: { orgId: string; s: OnboardingStatus; onSaved: () => void }) {
  const [f, setF] = useState<Form>(() => fromProfile(s.profile));
  const [same, setSame] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => setF(fromProfile(s.profile)), [s.profile]);
  const need = (k: ProfileField) => s.required.includes(k);
  const label = (text: string, k: ProfileField) => (need(k) ? `${text} (${ht.obRequired})` : text);
  const set = (k: keyof Form) => (v: string) => {
    setSaved(false);
    setF((x) => ({ ...x, [k]: v }));
  };
  const { busy, error, submit } = useSubmit(async () => {
    const body = { ...f, permanentAddress: same ? f.currentAddress : f.permanentAddress };
    await command('employees-setPrivate', { orgId, employeeId: s.employee.id, ...Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v.trim()])) });
    setSaved(true);
    onSaved();
  });
  return (
    <form className="card ob-form" onSubmit={submit} noValidate>
      <fieldset>
        <legend>{ht.obPersonal}</legend>
        <div className="form-grid">
          <div id="ob-dob">
            <TextField label={label(ht.dob, 'dob')} type="date" value={f.dob} onChange={set('dob')} autoComplete="bday" />
          </div>
          <div id="ob-gender">
            <SelectField label={label(ht.gender, 'gender')} value={f.gender} onChange={set('gender')} options={Object.entries(ht.genders).map(([value, text]) => ({ value, label: value ? text : '—' }))} />
          </div>
          <div id="ob-bloodGroup">
            <SelectField label={label(ht.bloodGroup, 'bloodGroup')} value={f.bloodGroup} onChange={set('bloodGroup')} options={BLOOD_GROUPS.map((g) => ({ value: g, label: g || '—' }))} />
          </div>
          <div id="ob-personalPhone">
            <TextField label={label(ht.personalPhone, 'personalPhone')} type="tel" value={f.personalPhone} onChange={set('personalPhone')} autoComplete="tel" />
          </div>
          <div id="ob-personalEmail">
            <TextField label={label(ht.personalEmail, 'personalEmail')} type="email" value={f.personalEmail} onChange={set('personalEmail')} autoComplete="email" />
          </div>
        </div>
      </fieldset>
      <fieldset>
        <legend>{ht.obAddress}</legend>
        <div id="ob-currentAddress">
          <TextArea label={label(ht.currentAddress, 'currentAddress')} value={f.currentAddress} onChange={set('currentAddress')} rows={2} />
        </div>
        <label className="check">
          <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} /> {ht.obSameAddress}
        </label>
        {!same && (
          <div id="ob-permanentAddress">
            <TextArea label={label(ht.permanentAddress, 'permanentAddress')} value={f.permanentAddress} onChange={set('permanentAddress')} rows={2} />
          </div>
        )}
      </fieldset>
      <fieldset id="ob-emergency">
        <legend>{need('emergency') ? `${ht.obEmergency} (${ht.obRequired})` : ht.obEmergency}</legend>
        <div className="form-grid">
          <TextField label={ht.emergencyName} value={f.emergencyName} onChange={set('emergencyName')} />
          <TextField label={ht.emergencyRelation} value={f.emergencyRelation} onChange={set('emergencyRelation')} />
          <TextField label={ht.emergencyPhone} type="tel" value={f.emergencyPhone} onChange={set('emergencyPhone')} />
        </div>
      </fieldset>
      <fieldset>
        <legend>{ht.obIds}</legend>
        <div className="form-grid">
          <div id="ob-pan">
            <TextField label={label(ht.pan, 'pan')} value={f.pan} onChange={set('pan')} hint="ABCDE1234F" />
          </div>
          <div id="ob-uan">
            <TextField label={label(ht.uan, 'uan')} value={f.uan} onChange={set('uan')} hint="12 digits" />
          </div>
          <div id="ob-esiNumber">
            <TextField label={label(ht.esiNumber, 'esiNumber')} value={f.esiNumber} onChange={set('esiNumber')} />
          </div>
        </div>
      </fieldset>
      <FormError error={error} />
      {saved && <Notice tone="ok">{ht.obSaved}</Notice>}
      <div className="row">
        <button type="submit" className="btn btn-filled" disabled={busy}>
          {busy ? t.saving : ht.obSaveDetails}
        </button>
      </div>
    </form>
  );
}

export function MyOnboardingPage() {
  const { user } = useAuth();
  const { org } = useWorkspace();
  const status = useAsync(() => (org && user ? myOnboarding(org.id, user.uid) : Promise.resolve(null)), [org?.id, user?.uid]);
  const [bank, setBank] = useState(false);
  const changed = () => {
    status.reload();
    onboardingChanged();
  };
  if (!org) return <NoOrgState />;
  if (status.loading && !status.data) return <SkeletonRows rows={6} />;
  if (status.error) return <ErrorState message={status.error} onRetry={status.reload} />;
  const s = status.data;
  if (!s) return <EmptyState page icon="person" title={ht.obTitle} message={ht.noEmployeeRecord} />;
  const b = s.profile.bank;

  return (
    <>
      <header className="page-header">
        <h1>{ht.obTitle}</h1>
        <p className="muted">{ht.obIntro}</p>
      </header>
      <Progress s={s} />

      <section className="section" aria-labelledby="ob-details">
        <h2 id="ob-details">{ht.obMyDetails}</h2>
        <DetailsForm orgId={org.id} s={s} onSaved={changed} />
      </section>

      <section className="section" id="ob-bank" aria-labelledby="ob-bank-title">
        <h2 id="ob-bank-title">
          {ht.obBank}
          {s.required.includes('bank') && <span className="muted small"> ({ht.obRequired})</span>}
        </h2>
        <div className="card">
          {b?.last4 ? (
            <>
              <p>
                <Icon name="check" /> {b.accountHolder} · {ht.obBankOnFile(b.bankName, b.last4)} · {b.ifsc}
              </p>
              <p className="muted small">{ht.obBankChange}</p>
            </>
          ) : (
            <button type="button" className="btn btn-outlined" onClick={() => setBank(true)}>
              <Icon name="plus" /> {ht.obBankAdd}
            </button>
          )}
        </div>
      </section>

      <section className="section" id="ob-docs" aria-labelledby="ob-docs-title">
        <h2 id="ob-docs-title">{ht.obDocuments}</h2>
        <p className="muted">{ht.obDocumentsIntro}</p>
        <EmployeeDocumentsPanel orgId={org.id} employee={s.employee} canManage={false} canVerify={false} onChanged={changed} />
      </section>

      {bank && <BankDialog orgId={org.id} employee={s.employee} profile={s.profile} onClose={() => setBank(false)} onSaved={changed} />}
    </>
  );
}
