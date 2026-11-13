// A staff member's own payslips (account menu → My payslips).
import { useAuth } from '../../auth/AuthContext';
import { myEmployee } from '../../data/hr';
import { myPayslips } from '../../data/payroll';
import { EmptyState, ErrorState, NoOrgState, SkeletonRows } from '../../shared/ui';
import { useAsync } from '../../shared/useAsync';
import { t } from '../../strings';
import { ht } from '../../strings/hr';
import { useWorkspace } from '../Workspace';
import { PayslipList } from './payrollKit';

export function MyPayslipsPage() {
  const { user } = useAuth();
  const { org } = useWorkspace();
  const data = useAsync(async () => {
    if (!org || !user) return null;
    // Own payslips are found by the account, so both reads start together.
    const [me, slips] = await Promise.all([myEmployee(org.id, user.uid), myPayslips(org.id, user.uid)]);
    return { me, slips: me ? slips : [] };
  }, [org?.id, user?.uid]);
  if (!org) return <NoOrgState />;
  return (
    <>
      <header className="page-header">
        <h1>{ht.navMyPayslips}</h1>
        <p className="muted">{ht.myPayslipsIntro}</p>
      </header>
      {data.loading && !data.data ? (
        <SkeletonRows />
      ) : data.error || !data.data ? (
        <ErrorState message={data.error ?? t.errorGeneric} onRetry={data.reload} />
      ) : !data.data.me ? (
        <EmptyState icon="payments" title={ht.noEmployeeRecord} message="" />
      ) : (
        <PayslipList orgId={org.id} slips={data.data.slips} />
      )}
    </>
  );
}
