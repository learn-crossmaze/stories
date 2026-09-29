// Letters (docs/HRMS.md §12–13): offer and other letters from templates — dialogs with preview, the profile tab, and the Letters page.
import { useState } from 'react';
import { Link } from 'react-router';

import { useAuth } from '../../auth/AuthContext';
import { branchScope, can } from '../../auth/claims';
import { ApiError } from '../../data/api';
import { EMPLOYMENT_TYPES, type Employee, type EmploymentType, listEmployees } from '../../data/hr';
import { type LetterTemplate, listTemplates, templateDefaults, usedPlaceholders } from '../../data/letterTemplates';
import {
  issueLetter,
  letterKind,
  letterName,
  type LetterTerms,
  listEmployeeOffers,
  listOffers,
  type OfferLetter,
  type OfferTerms,
  openOffer,
  previewLetter,
  previewOffer,
  releaseOffer,
  withdrawOffer,
} from '../../data/offers';
import { paths } from '../../paths';
import { addDays, todayIST } from '../../shared/dates';
import { day } from '../../shared/format';
import { EmptyState, ErrorState, Icon, NoOrgState, SkeletonRows, TableWrap } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { Notice } from '../components/kit';
import { ConfirmWithReason, Dialog, FormError, SelectField, TextArea, TextField } from '../components/Dialog';
import { useWorkspace } from '../Workspace';

const OFFERABLE = ['DRAFT', 'ONBOARDING', 'ACTIVE'];
const whole = (v: string) => /^\d+$/.test(v.trim());

/** Whether the signed-in user may release offers / issue other letters for this employee (never their own). */
export function useOfferRights(orgId: string, employee: Employee | null) {
  const { claims, user } = useAuth();
  if (!employee) return { canRelease: false, canIssue: false, self: false, perm: false };
  const has = (p: 'offers.release' | 'letters.issue') => (employee.branchId ? can(claims, p, orgId, employee.branchId) : can(claims, p, orgId) && branchScope(claims, orgId) === 'ALL');
  const self = (!!employee.uid && employee.uid === user?.uid) || (!employee.uid && !!employee.email && employee.email.toLowerCase() === user?.email?.toLowerCase());
  const release = has('offers.release');
  const issue = has('letters.issue');
  return { canRelease: release && !self, canIssue: issue && !self, self, perm: release || issue };
}

function blankTerms(orgId: string, e: Employee | null) {
  const today = todayIST();
  const joining = e?.joiningDate && e.joiningDate >= today ? e.joiningDate : addDays(today, 14);
  return {
    orgId,
    employeeId: e?.id ?? '',
    designation: e?.designationName ?? '',
    department: e?.departmentName ?? '',
    employmentType: (e?.employmentType ?? 'FULL_TIME') as EmploymentType,
    joiningDate: joining,
    annualCtc: '',
    probationMonths: '6',
    noticeDays: '30',
    acceptBy: [addDays(today, 7), joining].sort()[0],
    reportingTo: e?.managerName ?? '',
    terms: '',
  };
}

/**
 * Prepares, previews and releases an offer letter (worded by the offer
 * template in force at the employee's branch). Given `candidates` instead of
 * an employee, it starts by picking one.
 */
export function OfferDialog({ orgId, employee, candidates, onClose, onReleased }: { orgId: string; employee?: Employee; candidates?: Employee[]; onClose: () => void; onReleased: (number: string) => void }) {
  const [f, setF] = useState(() => blankTerms(orgId, employee ?? null));
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'release' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = todayIST();
  const current = employee ?? candidates?.find((c) => c.id === f.employeeId) ?? null;

  const pick = (id: string) => {
    const e = candidates?.find((c) => c.id === id) ?? null;
    setF({ ...blankTerms(orgId, e), annualCtc: f.annualCtc, terms: f.terms });
  };
  const errors = {
    employeeId: f.employeeId ? undefined : t.required,
    designation: f.designation.trim().length >= 2 ? undefined : t.required,
    joiningDate: /^\d{4}-\d{2}-\d{2}$/.test(f.joiningDate) ? undefined : t.required,
    annualCtc: whole(f.annualCtc) && Number(f.annualCtc) >= 1000 && Number(f.annualCtc) <= 100_000_000 ? undefined : ht.enterWholeRupees,
    probationMonths: whole(f.probationMonths) && Number(f.probationMonths) <= 24 ? undefined : ht.enterNumber,
    noticeDays: whole(f.noticeDays) && Number(f.noticeDays) <= 180 ? undefined : ht.enterNumber,
    acceptBy: /^\d{4}-\d{2}-\d{2}$/.test(f.acceptBy) && f.acceptBy >= today && f.acceptBy <= f.joiningDate ? undefined : ht.acceptByInvalid,
  };
  const e = (k: keyof typeof errors) => (touched ? errors[k] : undefined);
  const terms = (): OfferTerms => ({
    ...f,
    designation: f.designation.trim(),
    department: f.department.trim(),
    reportingTo: f.reportingTo.trim(),
    terms: f.terms.trim(),
    annualCtc: Number(f.annualCtc),
    probationMonths: Number(f.probationMonths),
    noticeDays: Number(f.noticeDays),
  });
  const run = async (kind: 'preview' | 'release') => {
    setTouched(true);
    if (Object.values(errors).some(Boolean) || busy) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'preview') await previewOffer(terms());
      else {
        const res = await releaseOffer(terms());
        onReleased(res.number);
        onClose();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.errorGeneric);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog title={current ? ht.offerFor(current.fullName) : ht.offerNew} onClose={onClose}>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void run('release');
        }}
        noValidate
      >
        {candidates && (
          <SelectField
            label={ht.offerPickEmployee}
            hint={ht.offerPickHint}
            value={f.employeeId}
            onChange={pick}
            error={e('employeeId')}
            options={[{ value: '', label: '—' }, ...candidates.map((c) => ({ value: c.id, label: `${c.fullName} (${c.code})` }))]}
          />
        )}
        <div className="form-grid">
          <TextField label={ht.offerDesignation} value={f.designation} onChange={set('designation')} error={e('designation')} />
          <TextField label={ht.offerDepartment} value={f.department} onChange={set('department')} />
          <SelectField label={ht.employmentTypeLabel} value={f.employmentType} onChange={set('employmentType')} options={EMPLOYMENT_TYPES.map((v) => ({ value: v, label: ht.employmentType[v] }))} />
          <TextField label={ht.offerReportingTo} value={f.reportingTo} onChange={set('reportingTo')} />
          <TextField label={ht.offerJoining} type="date" value={f.joiningDate} onChange={set('joiningDate')} error={e('joiningDate')} />
          <TextField label={ht.offerAcceptBy} hint={ht.offerAcceptByHint} type="date" value={f.acceptBy} onChange={set('acceptBy')} error={e('acceptBy')} />
          <TextField label={ht.offerCtc} hint={ht.offerCtcHint} value={f.annualCtc} onChange={(v) => set('annualCtc')(v.replace(/[,\s]/g, ''))} error={e('annualCtc')} />
          <TextField label={ht.offerProbation} value={f.probationMonths} onChange={set('probationMonths')} error={e('probationMonths')} />
          <TextField label={ht.offerNotice} value={f.noticeDays} onChange={set('noticeDays')} error={e('noticeDays')} />
        </div>
        <TextArea label={ht.offerTerms} rows={3} value={f.terms} onChange={set('terms')} />
        <p className="muted small">{ht.offerReleaseNote}</p>
        <FormError error={error} />
        <div className="dialog-actions">
          <button type="button" className="btn btn-text" onClick={onClose} disabled={!!busy}>
            {t.cancel}
          </button>
          <button type="button" className="btn btn-outlined" onClick={() => void run('preview')} disabled={!!busy}>
            {busy === 'preview' ? t.loading : ht.offerPreview}
          </button>
          <button type="submit" className="btn btn-filled" disabled={!!busy}>
            {busy === 'release' ? t.saving : ht.offerRelease}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Values an appointment or custom letter may ask for, and the placeholders that use them. */
const LETTER_FIELDS = [
  { key: 'designation', uses: ['designation'] },
  { key: 'department', uses: ['department'] },
  { key: 'reportingTo', uses: ['reportingTo'] },
  { key: 'joiningDate', uses: ['joiningDate'] },
  { key: 'acceptBy', uses: ['acceptBy'] },
  { key: 'annualCtc', uses: ['ctc', 'ctcWords'] },
  { key: 'probationMonths', uses: ['probationMonths'] },
  { key: 'noticeDays', uses: ['noticeDays'] },
  { key: 'terms', uses: ['terms'] },
] as const;
type LetterField = (typeof LETTER_FIELDS)[number]['key'];
const NO_VALUES: Record<LetterField, string> = { designation: '', department: '', reportingTo: '', joiningDate: '', acceptBy: '', annualCtc: '', probationMonths: '', noticeDays: '', terms: '' };

/**
 * Issues an appointment letter or a custom letter from a published template.
 * The form asks only for the values the template uses; blanks come from the
 * employee record.
 */
export function IssueLetterDialog({ orgId, employee, candidates, onClose, onIssued }: { orgId: string; employee?: Employee; candidates?: Employee[]; onClose: () => void; onIssued: (msg: string) => void }) {
  const data = useAsync(async () => ({ templates: await listTemplates(orgId), defaults: await templateDefaults(orgId) }), [orgId]);
  const [employeeId, setEmployeeId] = useState(employee?.id ?? '');
  const [choice, setChoice] = useState('APPOINTMENT');
  const [f, setF] = useState<Record<LetterField, string>>(NO_VALUES);
  const set = (k: LetterField) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'issue' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = employee ?? candidates?.find((c) => c.id === employeeId) ?? null;

  if (data.loading || !data.data) {
    return (
      <Dialog title={ht.letterIssue} onClose={onClose}>
        {data.error ? <ErrorState message={data.error} onRetry={data.reload} /> : <SkeletonRows rows={4} />}
      </Dialog>
    );
  }
  const { templates, defaults } = data.data;
  const branchId = current?.branchId ?? null;
  const applies = (x: LetterTemplate) => x.status === 'PUBLISHED' && (!x.branchId || x.branchId === branchId);
  const custom = templates.filter((x) => x.kind === 'CUSTOM' && applies(x));
  // The appointment wording in force: the branch's, else the organization's, else built-in.
  const appointment =
    templates.find((x) => x.kind === 'APPOINTMENT' && x.status === 'PUBLISHED' && !!branchId && x.branchId === branchId) ??
    templates.find((x) => x.kind === 'APPOINTMENT' && x.status === 'PUBLISHED' && !x.branchId) ??
    defaults.builtIn.APPOINTMENT;
  const template = choice === 'APPOINTMENT' ? appointment : custom.find((x) => `CUSTOM:${x.id}` === choice);
  const used = template ? usedPlaceholders(`${template.subject}\n${template.body}`) : [];
  const shown = (k: LetterField) => LETTER_FIELDS.some((x) => x.key === k && x.uses.some((u) => used.includes(u)));
  const date = (v: string) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);
  const errors = {
    employeeId: current ? undefined : t.required,
    template: template ? undefined : t.required,
    annualCtc: !f.annualCtc || (whole(f.annualCtc) && Number(f.annualCtc) >= 1000) ? undefined : ht.enterWholeRupees,
    probationMonths: !f.probationMonths || (whole(f.probationMonths) && Number(f.probationMonths) <= 24) ? undefined : ht.enterNumber,
    noticeDays: !f.noticeDays || (whole(f.noticeDays) && Number(f.noticeDays) <= 180) ? undefined : ht.enterNumber,
    joiningDate: date(f.joiningDate) ? undefined : t.required,
    acceptBy: date(f.acceptBy) ? undefined : t.required,
  };
  const e = (k: keyof typeof errors) => (touched ? errors[k] : undefined);
  const terms = (): LetterTerms => ({
    orgId,
    employeeId: current?.id ?? '',
    kind: choice === 'APPOINTMENT' ? 'APPOINTMENT' : 'CUSTOM',
    ...(choice === 'APPOINTMENT' ? {} : { templateId: choice.slice('CUSTOM:'.length) }),
    designation: shown('designation') ? f.designation.trim() : '',
    department: shown('department') ? f.department.trim() : '',
    joiningDate: shown('joiningDate') ? f.joiningDate : '',
    annualCtc: shown('annualCtc') && f.annualCtc ? Number(f.annualCtc) : null,
    probationMonths: shown('probationMonths') && f.probationMonths ? Number(f.probationMonths) : null,
    noticeDays: shown('noticeDays') && f.noticeDays ? Number(f.noticeDays) : null,
    acceptBy: shown('acceptBy') ? f.acceptBy : '',
    reportingTo: shown('reportingTo') ? f.reportingTo.trim() : '',
    terms: shown('terms') ? f.terms.trim() : '',
  });
  const run = async (kind: 'preview' | 'issue') => {
    setTouched(true);
    if (Object.values(errors).some(Boolean) || busy || !template) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'preview') await previewLetter(terms());
      else {
        const res = await issueLetter(terms());
        onIssued(ht.letterIssued(template.name, res.number));
        onClose();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.errorGeneric);
    } finally {
      setBusy(null);
    }
  };
  const fromRecord = ht.letterBlankHint;
  return (
    <Dialog title={current ? ht.letterFor(current.fullName) : ht.letterIssue} onClose={onClose}>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void run('issue');
        }}
        noValidate
      >
        {candidates && (
          <SelectField
            label={ht.offerPickEmployee}
            value={employeeId}
            onChange={setEmployeeId}
            error={e('employeeId')}
            options={[{ value: '', label: '—' }, ...candidates.map((c) => ({ value: c.id, label: `${c.fullName} (${c.code})` }))]}
          />
        )}
        <SelectField
          label={ht.letterTemplate}
          value={choice}
          onChange={setChoice}
          hint={ht.letterTemplateHint}
          error={e('template')}
          options={[{ value: 'APPOINTMENT', label: appointment.name }, ...custom.map((x) => ({ value: `CUSTOM:${x.id}`, label: x.name }))]}
        />
        <div className="form-grid">
          {shown('designation') && <TextField label={ht.offerDesignation} hint={fromRecord} value={f.designation} onChange={set('designation')} />}
          {shown('department') && <TextField label={ht.offerDepartment} hint={fromRecord} value={f.department} onChange={set('department')} />}
          {shown('reportingTo') && <TextField label={ht.offerReportingTo} hint={fromRecord} value={f.reportingTo} onChange={set('reportingTo')} />}
          {shown('joiningDate') && <TextField label={ht.offerJoining} hint={fromRecord} type="date" value={f.joiningDate} onChange={set('joiningDate')} error={e('joiningDate')} />}
          {shown('acceptBy') && <TextField label={ht.offerAcceptBy} type="date" value={f.acceptBy} onChange={set('acceptBy')} error={e('acceptBy')} />}
          {shown('annualCtc') && <TextField label={ht.offerCtc} hint={ht.offerCtcHint} value={f.annualCtc} onChange={(v) => set('annualCtc')(v.replace(/[,\s]/g, ''))} error={e('annualCtc')} />}
          {shown('probationMonths') && <TextField label={ht.offerProbation} value={f.probationMonths} onChange={set('probationMonths')} error={e('probationMonths')} />}
          {shown('noticeDays') && <TextField label={ht.offerNotice} value={f.noticeDays} onChange={set('noticeDays')} error={e('noticeDays')} />}
        </div>
        {shown('terms') && <TextArea label={ht.offerTerms} rows={3} value={f.terms} onChange={set('terms')} />}
        <p className="muted small">{ht.letterIssueNote}</p>
        <FormError error={error} />
        <div className="dialog-actions">
          <button type="button" className="btn btn-text" onClick={onClose} disabled={!!busy}>
            {t.cancel}
          </button>
          <button type="button" className="btn btn-outlined" onClick={() => void run('preview')} disabled={!!busy}>
            {busy === 'preview' ? t.loading : ht.offerPreview}
          </button>
          <button type="submit" className="btn btn-filled" disabled={!!busy}>
            {busy === 'issue' ? t.saving : ht.letterIssueButton}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const statusTone: Record<string, string> = { RELEASED: 'ok', SUPERSEDED: 'muted', WITHDRAWN: 'warn' };
const OfferBadge = ({ status }: { status: string }) => <span className={`badge badge-${statusTone[status] ?? 'muted'}`}>{ht.offerStatus[status] ?? status}</span>;

function OfferActions({ offer, canWithdraw, onWithdraw }: { offer: OfferLetter; canWithdraw: boolean; onWithdraw: () => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn-text"
        aria-label={`${ht.offerOpen} ${letterName(offer)} ${offer.number}`}
        onClick={() => openOffer(offer.orgId, offer.id).catch((e: unknown) => setError(e instanceof ApiError ? e.message : t.errorGeneric))}
      >
        {ht.offerOpen}
      </button>
      {canWithdraw && offer.status === 'RELEASED' && (
        <button type="button" className="btn btn-text" aria-label={`${ht.offerWithdraw} ${letterName(offer)} ${offer.number}`} onClick={onWithdraw}>
          {ht.offerWithdraw}
        </button>
      )}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

function WithdrawDialog({ offer, onClose, onDone }: { offer: OfferLetter; onClose: () => void; onDone: () => void }) {
  return (
    <ConfirmWithReason
      title={ht.letterWithdrawTitle(letterName(offer), offer.number)}
      body={ht.offerWithdrawBody}
      confirmLabel={ht.offerWithdraw}
      onClose={onClose}
      onConfirm={async (reason) => {
        await withdrawOffer(offer.orgId, offer.id, reason);
        onDone();
      }}
    />
  );
}

/** The employee profile's Letters tab. */
export function EmployeeOffersPanel({ orgId, employee }: { orgId: string; employee: Employee }) {
  const offers = useAsync(() => listEmployeeOffers(orgId, employee.id, employee.branchId), [orgId, employee.id, employee.branchId]);
  const { canRelease, canIssue, self } = useOfferRights(orgId, employee);
  const [releasing, setReleasing] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [withdrawing, setWithdrawing] = useState<OfferLetter | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const offerable = OFFERABLE.includes(employee.status);
  return (
    <section className="section" aria-labelledby="offers-h">
      <div className="page-header-row">
        <h2 id="offers-h">{ht.lettersTitle}</h2>
        <div className="row">
          {canIssue && employee.status !== 'DRAFT' && (
            <button type="button" className="btn btn-outlined" onClick={() => setIssuing(true)}>
              {ht.letterIssue}
            </button>
          )}
          {canRelease && offerable && (
            <button type="button" className="btn btn-filled" onClick={() => setReleasing(true)}>
              <Icon name="plus" /> {ht.offerRelease}
            </button>
          )}
        </div>
      </div>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {self && <Notice tone="warn">{ht.offerSelf}</Notice>}
      {!self && !offerable && <p className="muted">{ht.offerNotOfferable}</p>}
      {offers.loading ? (
        <SkeletonRows rows={2} />
      ) : offers.error ? (
        <ErrorState message={offers.error} onRetry={offers.reload} />
      ) : !offers.data?.length ? (
        <p className="muted">{ht.offersNone}</p>
      ) : (
        <ul className="plain-list">
          {offers.data.map((o) => (
            <li key={o.id}>
              <span>
                <strong>{letterName(o)}</strong> <span className="mono small">{o.number}</span> <OfferBadge status={o.status} />
                <div className="small">{ht.letterSummary(o)}</div>
                <div className="muted small">
                  {ht.offerReleasedBy(o.releasedByEmail ?? '—', day(o.releasedAt))}
                  {o.withdrawnReason ? ` · ${o.withdrawnReason}` : ''}
                </div>
              </span>
              <span className="cell-actions">
                <OfferActions offer={o} canWithdraw={letterKind(o) === 'OFFER' ? canRelease : canIssue} onWithdraw={() => setWithdrawing(o)} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {releasing && (
        <OfferDialog
          orgId={orgId}
          employee={employee}
          onClose={() => setReleasing(false)}
          onReleased={(n) => {
            setNotice(ht.offerReleased(n));
            offers.reload();
          }}
        />
      )}
      {issuing && (
        <IssueLetterDialog
          orgId={orgId}
          employee={employee}
          onClose={() => setIssuing(false)}
          onIssued={(msg) => {
            setNotice(msg);
            offers.reload();
          }}
        />
      )}
      {withdrawing && (
        <WithdrawDialog
          offer={withdrawing}
          onClose={() => setWithdrawing(null)}
          onDone={() => {
            setWithdrawing(null);
            offers.reload();
          }}
        />
      )}
    </section>
  );
}

/** Admin → People → Letters and Operations → My team → Letters. */
export function OfferLettersPage() {
  const { claims, user } = useAuth();
  const { org, branchName } = useWorkspace();
  const orgId = org?.id ?? '';
  const scope = org ? branchScope(claims, orgId) : 'ALL';
  const key = scope === 'ALL' ? 'ALL' : scope.join(',');
  const offers = useAsync(() => (orgId ? listOffers(orgId, scope) : Promise.resolve([])), [orgId, key]);
  const people = useAsync(() => (orgId ? listEmployees(orgId, scope) : Promise.resolve([])), [orgId, key]);
  const [releasing, setReleasing] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [withdrawing, setWithdrawing] = useState<OfferLetter | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!org) return <NoOrgState />;

  const mayDo = (p: 'offers.release' | 'letters.issue', branchId: string | null) => (branchId ? can(claims, p, orgId, branchId) : can(claims, p, orgId) && scope === 'ALL');
  const isMe = (e: { uid: string | null; email?: string | null }) => (!!e.uid && e.uid === user?.uid) || (!e.uid && !!e.email && e.email.toLowerCase() === user?.email?.toLowerCase());
  const candidates = (people.data ?? []).filter((e) => OFFERABLE.includes(e.status) && mayDo('offers.release', e.branchId) && !isMe(e));
  const letterCandidates = (people.data ?? []).filter((e) => e.status !== 'DRAFT' && mayDo('letters.issue', e.branchId) && !isMe(e));

  return (
    <>
      <header className="page-header page-header-row">
        <div>
          <h1>{ht.lettersTitle}</h1>
          <p className="muted">{ht.lettersIntro}</p>
        </div>
        <div className="row">
          <button type="button" className="btn btn-outlined" onClick={() => setIssuing(true)} disabled={people.loading || !letterCandidates.length}>
            {ht.letterIssue}
          </button>
          <button type="button" className="btn btn-filled" onClick={() => setReleasing(true)} disabled={people.loading || !candidates.length}>
            <Icon name="plus" /> {ht.offerNew}
          </button>
        </div>
      </header>
      {notice && <Notice tone="ok">{notice}</Notice>}
      {!people.loading && !candidates.length && !letterCandidates.length && <p className="muted">{ht.offerNoneToPick}</p>}
      {offers.loading ? (
        <SkeletonRows rows={4} />
      ) : offers.error ? (
        <ErrorState message={offers.error} onRetry={offers.reload} />
      ) : !offers.data?.length ? (
        <EmptyState icon="folder" title={ht.offersNone} message="" />
      ) : (
        <TableWrap>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{ht.colEmployee}</th>
                <th scope="col">{ht.colOffer}</th>
                <th scope="col">{ht.colStatus}</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {offers.data.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link to={paths.adminEmployee(o.employeeId)}>{o.employeeName}</Link>
                    <div className="muted small">
                      <span className="mono">{o.employeeCode}</span> · {o.branchId ? branchName(o.branchId) : ht.headOffice}
                    </div>
                  </td>
                  <td>
                    <strong>{letterName(o)}</strong> <span className="mono small">{o.number}</span>
                    <div className="small">{ht.letterSummary(o)}</div>
                    <div className="muted small">{ht.offerReleasedBy(o.releasedByEmail ?? '—', day(o.releasedAt))}</div>
                  </td>
                  <td>
                    <OfferBadge status={o.status} />
                  </td>
                  <td className="cell-actions">
                    <OfferActions
                      offer={o}
                      canWithdraw={mayDo(letterKind(o) === 'OFFER' ? 'offers.release' : 'letters.issue', o.branchId) && !(o.employeeUid && o.employeeUid === user?.uid)}
                      onWithdraw={() => setWithdrawing(o)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {releasing && (
        <OfferDialog
          orgId={orgId}
          candidates={candidates}
          onClose={() => setReleasing(false)}
          onReleased={(n) => {
            setNotice(ht.offerReleased(n));
            offers.reload();
          }}
        />
      )}
      {issuing && (
        <IssueLetterDialog
          orgId={orgId}
          candidates={letterCandidates}
          onClose={() => setIssuing(false)}
          onIssued={(msg) => {
            setNotice(msg);
            offers.reload();
          }}
        />
      )}
      {withdrawing && (
        <WithdrawDialog
          offer={withdrawing}
          onClose={() => setWithdrawing(null)}
          onDone={() => {
            setWithdrawing(null);
            offers.reload();
          }}
        />
      )}
    </>
  );
}
