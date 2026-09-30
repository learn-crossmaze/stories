import { useRef, useState } from 'react';

import { command, toApiError } from '../../data/api';
import type { Employee } from '../../data/hr';
import { onboardingChanged } from '../../data/selfOnboarding';
import { shrinkToJpeg } from '../../shared/image';
import { ht } from '../../strings/hr';

/** Longest side of an uploaded profile picture (sharp at 2× on the large avatar). */
const MAX_SIDE = 480;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** An employee's profile picture, or their initials when there is none. */
export function EmployeeAvatar({ employee, size = 'sm' }: { employee: Pick<Employee, 'fullName' | 'photoUrl'>; size?: 'sm' | 'lg' }) {
  return employee.photoUrl ? (
    <img className={`avatar avatar-${size}`} src={employee.photoUrl} alt="" loading="lazy" />
  ) : (
    <span className={`avatar avatar-${size} avatar-initials`} aria-hidden="true">
      {initials(employee.fullName)}
    </span>
  );
}

/**
 * The large profile picture with Add / Change / Remove (the person themselves,
 * or HR who may edit employees). Photos are shrunk in the browser first.
 */
export function EmployeePhoto({ orgId, employee, canEdit, onChanged }: { orgId: string; employee: Employee; canEdit: boolean; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (image: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await command('employees-setPhoto', { orgId, employeeId: employee.id, image });
      onChanged();
      onboardingChanged();
    } catch (e) {
      setError(toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="employee-photo">
      <EmployeeAvatar employee={employee} size="lg" />
      {canEdit && (
        <div className="employee-photo-actions">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                await save(await shrinkToJpeg(file, MAX_SIDE));
              } catch {
                setError(ht.photoUnreadable);
              }
            }}
          />
          <button type="button" className="btn btn-text btn-inline" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? ht.photoSaving : employee.photoUrl ? ht.photoChange : ht.photoAdd}
          </button>
          {employee.photoUrl && (
            <button type="button" className="btn btn-text btn-inline" disabled={busy} onClick={() => void save(null)}>
              {ht.photoRemove}
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
