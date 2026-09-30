import { useState } from 'react';

import { command } from '../../data/api';
import { type Employee, type PrivateProfile, type Transition } from '../../data/hr';
import { aadhaarError, aadhaarHint, cleanAadhaar } from '../../shared/aadhaar';
import { cleanIfsc, IFSC_PATTERN } from '../../shared/ifsc';
import { t } from '../../strings';
import { Dialog, DialogActions, FormError, SelectField, TextArea, TextField, useSubmit } from '../components/Dialog';
import { IfscField } from '../components/IfscField';
import { ht } from '../../strings/hr';

// Dialogs on the employee profile: personal details, bank account, status changes.
export function PersonalDialog({
  orgId,
  employee,
  profile,
  onClose,
  onSaved,
}: {
  orgId: string;
  employee: Employee;
  profile: PrivateProfile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    dob: profile.dob ?? '',
    gender: profile.gender ?? '',
    bloodGroup: profile.bloodGroup ?? '',
    personalEmail: profile.personalEmail ?? '',
    personalPhone: profile.personalPhone ?? '',
    currentAddress: profile.currentAddress ?? '',
    permanentAddress: profile.permanentAddress ?? '',
    emergencyName: profile.emergencyName ?? '',
    emergencyRelation: profile.emergencyRelation ?? '',
    emergencyPhone: profile.emergencyPhone ?? '',
    pan: profile.pan ?? '',
    uan: profile.uan ?? '',
    esiNumber: profile.esiNumber ?? '',
  });
  const [aadhaar, setAadhaar] = useState('');
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const { busy, error, submit } = useSubmit(async () => {
    if (aadhaarError(aadhaar)) return;
    await command('employees-setPrivate', {
      orgId,
      employeeId: employee.id,
      ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()])),
      aadhaar: cleanAadhaar(aadhaar),
    });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={ht.editPersonal} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <TextField label={ht.dob} type="date" value={f.dob} onChange={set('dob')} />
          <SelectField
            label={ht.gender}
            value={f.gender}
            onChange={set('gender')}
            options={Object.entries(ht.genders).map(([value, label]) => ({ value, label }))}
          />
          <TextField label={ht.bloodGroup} value={f.bloodGroup} onChange={set('bloodGroup')} />
          <TextField label={ht.personalEmail} type="email" value={f.personalEmail} onChange={set('personalEmail')} />
          <TextField label={ht.personalPhone} type="tel" value={f.personalPhone} onChange={set('personalPhone')} />
          <TextField label={ht.pan} value={f.pan} onChange={set('pan')} />
          <TextField label={ht.aadhaar} value={aadhaar} onChange={setAadhaar} autoComplete="off" hint={aadhaarHint(profile.aadhaarLast4)} error={aadhaarError(aadhaar) || undefined} />
          <TextField label={ht.uan} value={f.uan} onChange={set('uan')} />
          <TextField label={ht.esiNumber} value={f.esiNumber} onChange={set('esiNumber')} />
          <TextField label={ht.emergencyName} value={f.emergencyName} onChange={set('emergencyName')} />
          <TextField label={ht.emergencyRelation} value={f.emergencyRelation} onChange={set('emergencyRelation')} />
          <TextField label={ht.emergencyPhone} type="tel" value={f.emergencyPhone} onChange={set('emergencyPhone')} />
        </div>
        <TextArea label={ht.currentAddress} value={f.currentAddress} onChange={set('currentAddress')} rows={2} />
        <TextArea label={ht.permanentAddress} value={f.permanentAddress} onChange={set('permanentAddress')} rows={2} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

export function BankDialog({
  orgId,
  employee,
  profile,
  onClose,
  onSaved,
}: {
  orgId: string;
  employee: Employee;
  profile: PrivateProfile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [accountHolder, setHolder] = useState(profile.bank?.accountHolder ?? employee.fullName);
  const [accountNumber, setNumber] = useState('');
  const [ifsc, setIfsc] = useState(profile.bank?.ifsc ?? '');
  const [bankName, setBankName] = useState(profile.bank?.bankName ?? '');
  // The bank name last filled from an IFSC lookup; replaced by the next lookup unless someone typed over it.
  const [filledBank, setFilledBank] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const errors = {
    accountHolder: accountHolder.trim().length >= 2 ? undefined : t.required,
    accountNumber: /^\d{9,18}$/.test(accountNumber.trim()) ? undefined : 'Enter 9–18 digits.',
    ifsc: IFSC_PATTERN.test(cleanIfsc(ifsc)) ? undefined : 'Enter a valid IFSC, e.g. HDFC0001234.',
    bankName: bankName.trim().length >= 2 ? undefined : t.required,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (Object.values(errors).some(Boolean)) return;
    await command('employees-setBank', {
      orgId,
      employeeId: employee.id,
      accountHolder: accountHolder.trim(),
      accountNumber: accountNumber.trim(),
      ifsc: cleanIfsc(ifsc),
      bankName: bankName.trim(),
    });
    onSaved();
    onClose();
  });
  return (
    <Dialog title={profile.bank ? ht.bankEdit : ht.bankAdd} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <TextField label={ht.accountHolder} value={accountHolder} onChange={setHolder} error={touched ? errors.accountHolder : undefined} />
        <TextField label={ht.accountNumber} value={accountNumber} onChange={setNumber} autoComplete="off" error={touched ? errors.accountNumber : undefined} />
        <IfscField
          label={ht.ifsc}
          value={ifsc}
          onChange={setIfsc}
          error={touched ? errors.ifsc : undefined}
          onFound={(d) => {
            const saved = profile.bank;
            const changedFromSaved = !!saved && bankName === saved.bankName && d.ifsc !== saved.ifsc;
            if (!bankName.trim() || bankName === filledBank || changedFromSaved) {
              setBankName(d.bank);
              setFilledBank(d.bank);
            }
          }}
        />
        <TextField label={ht.bankName} value={bankName} onChange={setBankName} error={touched ? errors.bankName : undefined} />
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={t.save} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

export function TransitionDialog({
  orgId,
  employee,
  step,
  onClose,
  onDone,
}: {
  orgId: string;
  employee: Employee;
  step: Transition;
  onClose: () => void;
  onDone: () => void;
}) {
  const dateLabel = ht.stepDate[step];
  const needsReason = step === 'RESIGN' || step === 'START_OFFBOARDING';
  const initialDate = step === 'ACTIVATE' ? (employee.joiningDate ?? '') : step === 'START_OFFBOARDING' ? (employee.noticeEndDate ?? '') : '';
  const [date, setDate] = useState(initialDate);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const dateRequired = step === 'RESIGN' || step === 'ACTIVATE' || step === 'START_OFFBOARDING';
  const errors = {
    date: dateRequired && !date ? t.required : undefined,
    reason: needsReason && reason.trim().length < 3 ? t.required : undefined,
  };
  const { busy, error, submit } = useSubmit(async () => {
    setTouched(true);
    if (errors.date || errors.reason) return;
    await command('employees-transition', { orgId, employeeId: employee.id, transition: step, ...(date ? { date } : {}), reason: reason.trim() });
    onDone();
    onClose();
  });
  return (
    <Dialog title={`${ht.steps[step]} · ${employee.fullName}`} onClose={onClose} narrow>
      <form onSubmit={submit} noValidate>
        <p className="muted">{ht.stepHelp[step]}</p>
        {dateLabel && <TextField label={dateLabel} type="date" value={date} onChange={setDate} error={touched ? errors.date : undefined} />}
        {(needsReason || step === 'WITHDRAW_RESIGNATION' || step === 'REHIRE') && (
          <TextField label={needsReason ? ht.reason : ht.changeNote} value={reason} onChange={setReason} error={touched ? errors.reason : undefined} />
        )}
        <FormError error={error} />
        <DialogActions busy={busy} submitLabel={ht.steps[step]} onCancel={onClose} danger={step === 'COMPLETE_OFFBOARDING'} />
      </form>
    </Dialog>
  );
}
