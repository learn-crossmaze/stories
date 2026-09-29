import { useState } from 'react';

import { command } from '../../data/api';
import { getBookNumbering } from '../../data/catalogue';
import type { Branch, Org } from '../../data/org';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ErrorState } from '../../shared/ui';
import { Dialog, DialogActions, FormError, TextField, useSubmit } from '../components/Dialog';
import { lt } from '../../strings/library';
import { BRANCH_KINDS, type BranchKind, type CodeKind, DEFAULT_PATTERNS, patternProblem, previewCode, TOKEN_HELP, TOKENS } from './numbering';

const LABELS: Record<CodeKind, string> = {
  book: lt.numberingBook,
  copy: lt.numberingCopy,
  member: lt.numberingMember,
  location: lt.numberingLocation,
  employee: lt.numberingEmployee,
};

function PatternInput({ kind, value, onChange, branchCode, touched }: { kind: CodeKind; value: string; onChange: (v: string) => void; branchCode?: string; touched: boolean }) {
  const pattern = value.trim().toUpperCase();
  const problem = patternProblem(kind, pattern);
  const example = problem ? null : [1, 2].map((n) => previewCode(pattern, { BRANCH: branchCode ?? 'BR' }, n)).join(', ');
  return (
    <TextField
      label={LABELS[kind]}
      value={value}
      onChange={onChange}
      error={problem && (touched || pattern.length > 2) ? problem : undefined}
      hint={example ? lt.numberingExample(example) : `${lt.numberingDefault} ${DEFAULT_PATTERNS[kind]}`}
    />
  );
}

function TokenHelp({ kinds }: { kinds: CodeKind[] }) {
  const tokens = ['SEQ', ...new Set(kinds.flatMap((k) => TOKENS[k]))];
  return (
    <details className="span-2 numbering-help">
      <summary>{lt.numberingTokens}</summary>
      <dl>
        {tokens.map((tk) => (
          <div key={tk}>
            <dt className="mono">{`{${tk}}`}</dt>
            <dd>{TOKEN_HELP[tk]}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** Head-office numbering: employee IDs for staff without a branch, and the code {BRANCH} stands for. */
export function HeadOfficeNumberingDialog({ org, onClose, onSaved }: { org: Org; onClose: () => void; onSaved: () => void }) {
  const [pattern, setPattern] = useState(org.numbering?.employee || DEFAULT_PATTERNS.employee);
  const [code, setCode] = useState(org.headOfficeCode || 'HO');
  const [touched, setTouched] = useState(false);
  const hoCode = code.trim().toUpperCase();
  const codeError = /^[A-Z0-9]{2,8}$/.test(hoCode) ? undefined : lt.hoCodeInvalid;
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    const p = pattern.trim().toUpperCase();
    if (patternProblem('employee', p) || codeError) return;
    await command('orgs-setNumbering', { orgId: org.id, employee: p === DEFAULT_PATTERNS.employee ? '' : p, headOfficeCode: hoCode === 'HO' ? '' : hoCode });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={lt.hoNumberingTitle} onClose={onClose}>
      <form onSubmit={submit} noValidate className="form-grid">
        <p className="span-2 muted">{lt.hoNumberingIntro}</p>
        <TextField label={lt.hoCode} hint={lt.hoCodeHint} value={code} onChange={setCode} error={touched ? codeError : undefined} />
        <PatternInput kind="employee" value={pattern} onChange={setPattern} branchCode={codeError ? 'HO' : hoCode} touched={touched} />
        <TokenHelp kinds={['employee']} />
        <div className="span-2">
          <FormError error={error} />
          <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
        </div>
      </form>
    </Dialog>
  );
}

/** Branch numbering: patterns for the codes this branch creates. */
export function BranchNumberingDialog({ orgId, branch, onClose, onSaved }: { orgId: string; branch: Branch; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Record<BranchKind, string>>(
    Object.fromEntries(BRANCH_KINDS.map((k) => [k, branch.numbering?.[k] || DEFAULT_PATTERNS[k]])) as Record<BranchKind, string>,
  );
  const [touched, setTouched] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    const patterns = Object.fromEntries(BRANCH_KINDS.map((k) => [k, f[k].trim().toUpperCase()])) as Record<BranchKind, string>;
    if (BRANCH_KINDS.some((k) => patternProblem(k, patterns[k]))) return;
    const body = Object.fromEntries(BRANCH_KINDS.map((k) => [k, patterns[k] === DEFAULT_PATTERNS[k] ? '' : patterns[k]]));
    await command('branches-setNumbering', { orgId, branchId: branch.id, ...body });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={lt.numberingTitle(branch.name)} onClose={onClose}>
      <form onSubmit={submit} noValidate className="form-grid">
        <p className="span-2 muted">{lt.numberingIntro}</p>
        {BRANCH_KINDS.map((k) => (
          <PatternInput key={k} kind={k} value={f[k]} onChange={(v) => setF((s) => ({ ...s, [k]: v }))} branchCode={branch.code} touched={touched} />
        ))}
        <TokenHelp kinds={BRANCH_KINDS} />
        <div className="span-2">
          <FormError error={error} />
          <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
        </div>
      </form>
    </Dialog>
  );
}

/** Catalogue numbering: the book code pattern, shared by every organization. */
export function BookNumberingDialog({ current, onClose, onSaved }: { current: string | null; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(current || DEFAULT_PATTERNS.book);
  const [touched, setTouched] = useState(false);
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    const pattern = value.trim().toUpperCase();
    if (patternProblem('book', pattern)) return;
    await command('books-setNumbering', { book: pattern === DEFAULT_PATTERNS.book ? '' : pattern });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={lt.numberingBookTitle} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="muted">{lt.numberingBookIntro}</p>
        <PatternInput kind="book" value={value} onChange={setValue} touched={touched} />
        <TokenHelp kinds={['book']} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** Loads the current book pattern, then opens the dialog. */
export function BookNumbering({ onClose }: { onClose: () => void }) {
  const current = useAsync(getBookNumbering, []);
  if (current.loading) return null;
  if (current.error) {
    return (
      <Dialog title={lt.numberingBookTitle} onClose={onClose}>
        <ErrorState message={current.error} onRetry={current.reload} />
      </Dialog>
    );
  }
  return <BookNumberingDialog current={current.data ?? null} onClose={onClose} onSaved={() => undefined} />;
}
