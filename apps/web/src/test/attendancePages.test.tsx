import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FirebaseError } from 'firebase/app';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AttendanceRecord, Correction, Holiday, Shift } from '../data/attendance';
import type { Employee } from '../data/hr';
import type { LeaveRequest } from '../data/leave';
import { monthIST, todayIST } from '../shared/dates';
import { t } from '../strings';
import { ht } from '../strings/hr';

// The attendance screens with the server faked at the Cloud Functions boundary and the lists faked in the data layer.
type Sent = Record<string, unknown> & { action: string; requestId: string };

const world = vi.hoisted(() => ({
  calls: [] as unknown[],
  respond: (() => ({})) as (data: never) => unknown,
  people: [] as unknown[],
  shifts: [] as unknown[],
  holidays: [] as unknown[],
  /** When set, the holidays arrive only once this does. */
  holidaysWait: undefined as Promise<void> | undefined,
  records: {} as Record<string, unknown[]>,
  corrections: [] as unknown[],
  leave: [] as unknown[],
  me: null as unknown,
  myDay: null as unknown,
  reads: { people: 0, shifts: 0, day: [] as string[], corrections: 0, myEmployee: 0, myDay: 0, month: 0 },
}));
const calls = world.calls as Sent[];

vi.mock('firebase/functions', () => ({
  httpsCallable: () => async (data: Sent) => {
    world.calls.push(data);
    const answer = await world.respond(data as never);
    if (answer instanceof Error) throw answer;
    return { data: answer };
  },
}));
vi.mock('../data/services', () => ({ services: () => ({ fns: {}, db: {} }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ claims: { v: 1, sa: true, o: {} }, user: { uid: 'me' } }) }));
vi.mock('../admin/Workspace', () => ({
  useWorkspace: () => ({
    org: { id: 'o1' },
    branch: { id: 'b1', name: 'Central' },
    myBranches: [{ id: 'b1', name: 'Central', weeklyOffs: [] }],
    branchName: () => 'Central',
  }),
}));
vi.mock('../data/hr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/hr')>()),
  listEmployees: async () => (world.reads.people++, [...world.people]),
  myEmployee: async () => (world.reads.myEmployee++, world.me),
}));
vi.mock('../data/leave', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/leave')>()),
  pendingLeave: async () => [...world.leave],
}));
vi.mock('../data/attendance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/attendance')>()),
  listShifts: async () => (world.reads.shifts++, [...world.shifts]),
  listHolidays: async () => (await world.holidaysWait, [...world.holidays]),
  dayRecords: async (_org: string, date: string) => (world.reads.day.push(date), [...(world.records[date] ?? [])]),
  pendingCorrections: async () => (world.reads.corrections++, [...world.corrections]),
  monthLock: async () => null,
  monthSummaries: async () => [],
  myDay: async () => (world.reads.myDay++, world.myDay),
  myMonth: async () => (world.reads.month++, []),
  myCorrections: async () => [],
}));

const { AttendancePage } = await import('../admin/people/Attendance');
const { AdjustDialog, shiftDefault } = await import('../admin/people/attendanceKit');
const { CheckInCard } = await import('../admin/people/MyAttendance');

const today = todayIST();
const daysAgo = (n: number) => new Date(Date.parse(today) - n * 86_400_000).toISOString().slice(0, 10);
const past = daysAgo(3);
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const pastWeekday = WEEKDAYS[new Date(`${past}T00:00:00Z`).getUTCDay()];

const person = (n: number, fullName: string, over: Partial<Employee> = {}) =>
  ({ id: `e${n}`, uid: `u${n}`, fullName, branchId: 'b1', status: 'ACTIVE', shiftId: 's1', shiftName: 'Morning', weeklyOffs: null, joiningDate: null, exitDate: null, ...over }) as Employee;
const morning = { id: 's1', name: 'Morning', start: '09:30', end: '18:00', status: 'ACTIVE' } as Shift;
const record = (employeeId: string, date: string, over: Partial<AttendanceRecord> = {}) =>
  ({ id: `${employeeId}_${date}`, employeeId, date, status: 'IN_PROGRESS', checkIn: null, checkOut: null, late: false, lateMinutes: 0, earlyExit: false, missedCheckout: false, workedMinutes: 0, source: 'DESK', ...over }) as AttendanceRecord;
const correction = (n: number, name: string, date: string, over: Partial<Correction> = {}) =>
  ({ id: `e${n}_${date}`, employeeId: `e${n}`, employeeName: name, employeeCode: `E${n}`, employeeUid: `u${n}`, branchId: 'b1', date, checkIn: '09:30', checkOut: '18:00', reason: `Reason ${n}`, status: 'PENDING', decisionNote: null, ...over }) as Correction;
const refused = (reason: string, message: string) => Object.assign(new FirebaseError('functions/failed-precondition', message), { details: { reason } });
/** A server answer the test gives when it chooses. */
function later() {
  const waiting = new Map<string, (answer: unknown) => void>();
  world.respond = ((data: Sent) => new Promise((resolve) => waiting.set(String(data.employeeId ?? data.correctionId), resolve))) as never;
  return (key: string, answer: unknown = {}) => waiting.get(key)!(answer);
}

const asha = person(1, 'Asha Rao');
const bela = person(2, 'Bela Shah');

async function openBoard() {
  render(
    <MemoryRouter>
      <AttendancePage />
    </MemoryRouter>,
  );
  await screen.findByRole('link', { name: 'Asha Rao' });
  await waitFor(() => expect(world.reads.day).toHaveLength(1));
  return userEvent.setup();
}
const goTo = async (date: string) => {
  fireEvent.change(screen.getByLabelText(ht.day), { target: { value: date } });
  await waitFor(() => expect(world.reads.day.at(-1)).toBe(date));
  await waitFor(() => expect(screen.getByRole('table')).not.toHaveAttribute('aria-busy'));
};

beforeEach(() => {
  calls.length = 0;
  world.respond = () => ({});
  world.people = [person(0, 'Me Manager', { uid: 'me' }), asha, bela];
  world.shifts = [morning];
  world.holidays = [];
  world.holidaysWait = undefined;
  world.records = {};
  world.corrections = [];
  world.leave = [];
  world.me = person(0, 'Me Manager', { uid: 'me' });
  world.myDay = null;
  world.reads = { people: 0, shifts: 0, day: [], corrections: 0, myEmployee: 0, myDay: 0, month: 0 };
});

describe('the day board', () => {
  it('punches rows independently: two on their way at once, one command per row, a refusal stays with its row', async () => {
    const answer = later();
    await openBoard();
    fireEvent.click(screen.getByRole('button', { name: ht.checkInFor('Asha Rao') }));
    fireEvent.click(screen.getByRole('button', { name: ht.checkInFor('Asha Rao') }));
    fireEvent.click(screen.getByRole('button', { name: ht.checkInFor('Bela Shah') }));
    expect(calls.map((c) => [c.action, c.employeeId, c.punch])).toEqual([
      ['attendance-punch', 'e1', 'IN'],
      ['attendance-punch', 'e2', 'IN'],
    ]);
    expect(screen.getByRole('button', { name: ht.checkInFor('Asha Rao') })).toBeDisabled();
    expect(screen.getByRole('button', { name: ht.checkInFor('Bela Shah') })).toBeDisabled();
    // The manager's own row is not held back by the others.
    expect(screen.getByRole('button', { name: ht.checkInFor('Me Manager') })).toBeEnabled();

    answer('e1', refused('ALREADY_IN', 'Already checked in today.'));
    expect(await screen.findByText(ht.punchFailed('Asha Rao', 'Already checked in today.'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ht.checkInFor('Asha Rao') })).toBeEnabled();
    expect(world.reads.day).toHaveLength(1);

    // Bela's goes through: only the day's records are read again, and Asha's message stays.
    world.records[today] = [record('e2', today, { checkIn: new Date() })];
    answer('e2');
    expect(await screen.findByRole('button', { name: ht.checkOutFor('Bela Shah') })).toBeEnabled();
    expect(world.reads.day).toEqual([today, today]);
    expect(world.reads).toMatchObject({ people: 1, shifts: 1 });
    expect(screen.getByText(ht.punchFailed('Asha Rao', 'Already checked in today.'))).toBeInTheDocument();
  });

  it('changing the day reads only that day: the people and the shifts are read once', async () => {
    await openBoard();
    await goTo(past);
    await goTo(daysAgo(4));
    expect(world.reads.day).toEqual([today, past, daysAgo(4)]);
    expect(world.reads).toMatchObject({ people: 1, shifts: 1 });
    // The people stay on screen; nobody is punched on a past day.
    expect(screen.getByRole('link', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ht.checkInFor('Asha Rao') })).toBeNull();
  });

  it('adjusts several people on a past day: own shift times, one command each, the refused stay ticked', async () => {
    const chitra = person(3, 'Chitra Nair', { shiftId: null, shiftName: null });
    const dev = person(4, 'Dev Menon', { weeklyOffs: [pastWeekday] });
    const esha = person(5, 'Esha Roy', { joiningDate: today });
    world.people = [...(world.people as Employee[]), chitra, dev, esha];
    const user = await openBoard();
    // Nobody is ticked for today.
    expect(screen.queryByRole('checkbox')).toBeNull();
    await goTo(past);
    // Never yourself, never someone who had not joined yet.
    expect(screen.queryByRole('checkbox', { name: ht.selectForAdjust('Me Manager') })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: ht.selectForAdjust('Esha Roy') })).toBeNull();
    expect(screen.getByRole('checkbox', { name: ht.selectForAdjust('Dev Menon') })).not.toBeChecked();
    expect(screen.getByRole('button', { name: ht.adjustSelected(0) })).toBeDisabled();

    // "Everyone" leaves out the person whose day off it was.
    await user.click(screen.getByRole('checkbox', { name: ht.selectAllNoRecord }));
    for (const name of ['Asha Rao', 'Bela Shah', 'Chitra Nair']) expect(screen.getByRole('checkbox', { name: ht.selectForAdjust(name) })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: ht.selectForAdjust('Dev Menon') })).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: ht.adjustSelected(3) }));
    const dialog = screen.getByRole('dialog', { name: ht.adjustManyTitle(3, past) });
    world.respond = ((data: Sent) => (data.employeeId === 'e2' ? refused('MONTH_FINALIZED_NOT', 'Bela is on leave that day.') : {})) as never;
    world.records[past] = [record('e1', past, { checkIn: new Date(), checkOut: new Date(), status: 'PRESENT' })];
    await user.clear(within(dialog).getByLabelText(t.reasonLabel));
    await user.type(within(dialog).getByLabelText(t.reasonLabel), 'Biometric was down');
    await user.click(within(dialog).getByRole('button', { name: ht.adjustSelected(3) }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((c) => ({ ...c, requestId: undefined }))).toEqual(
      ['e1', 'e2'].map((employeeId) => ({ action: 'attendance-adjust', orgId: 'o1', employeeId, date: past, checkIn: '09:30', checkOut: '18:00', reason: 'Biometric was down', requestId: undefined })),
    );
    expect(new Set(calls.map((c) => c.requestId)).size).toBe(2);
    // The dialog stays for the two that were not adjusted, each with its reason; the day is read once more.
    const still = await screen.findByRole('dialog', { name: ht.adjustManyTitle(2, past) });
    expect(within(still).getByText('Bela is on leave that day.')).toBeInTheDocument();
    expect(within(still).getByText(ht.adjustManyNoShift)).toBeInTheDocument();
    expect(within(still).queryByText('Asha Rao')).toBeNull();
    await waitFor(() => expect(world.reads.day).toEqual([today, past, past]));
    expect(world.reads).toMatchObject({ people: 1, shifts: 1 });

    await user.click(within(still).getByRole('button', { name: t.cancel }));
    expect(screen.getByText(ht.adjustManyDone(1))).toBeInTheDocument();
    expect(screen.getByText(ht.adjustManyNotDone(2))).toBeInTheDocument();
    expect(screen.getByText('Bela is on leave that day.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: ht.selectForAdjust('Bela Shah') })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: ht.selectForAdjust('Asha Rao') })).toBeNull();
    expect(screen.getByRole('button', { name: ht.adjustSelected(2) })).toBeEnabled();
  });

  it('"everyone" is switched off on a holiday', async () => {
    world.holidays = [{ id: past, date: past, name: 'Founders day', branchIds: [] } as Holiday];
    await openBoard();
    await goTo(past);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: ht.selectAllNoRecord })).toBeDisabled());
    expect(screen.getByRole('checkbox', { name: ht.selectForAdjust('Asha Rao') })).toBeEnabled();
  });

  it('"everyone" waits for the holidays of the day picked (the list read for today says nothing about it)', async () => {
    world.people = [...(world.people as Employee[]).slice(0, 2), person(2, 'Bela Shah', { branchId: 'b2' })];
    world.holidays = [{ id: past, date: past, name: 'Founders day', branchIds: ['b1'] } as Holiday];
    let arrive!: () => void;
    world.holidaysWait = new Promise<void>((resolve) => (arrive = resolve));
    const user = await openBoard();
    // The day's records are there before its holidays.
    await goTo(past);
    const everyone = screen.getByRole('checkbox', { name: ht.selectAllNoRecord });
    expect(everyone).toBeDisabled();
    arrive();
    await waitFor(() => expect(everyone).toBeEnabled());
    await user.click(everyone);
    // It was a holiday at Asha's branch only.
    expect(screen.getByRole('checkbox', { name: ht.selectForAdjust('Bela Shah') })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: ht.selectForAdjust('Asha Rao') })).not.toBeChecked();
  });

  it('a closed month ends it for that branch only, and everyone not adjusted gets a reason', async () => {
    const finalized = 'Attendance for this month is finalized. Ask HR to reopen it.';
    const names = ['Asha Rao', 'Bela Shah', 'Chitra Nair', 'Dev Menon', 'Esha Roy', 'Farid Khan'];
    // Odd numbers work at Central, even ones at another branch.
    world.people = [(world.people as Employee[])[0], ...names.map((name, i) => person(i + 1, name, { branchId: i % 2 ? 'b2' : 'b1' }))];
    const user = await openBoard();
    await goTo(past);
    await user.click(screen.getByRole('checkbox', { name: ht.selectAllNoRecord }));
    await user.click(screen.getByRole('button', { name: ht.adjustSelected(6) }));
    const dialog = screen.getByRole('dialog', { name: ht.adjustManyTitle(6, past) });
    await user.clear(within(dialog).getByLabelText(t.reasonLabel));
    await user.type(within(dialog).getByLabelText(t.reasonLabel), 'Biometric was down');
    const answer = later();
    await user.click(within(dialog).getByRole('button', { name: ht.adjustSelected(6) }));
    await waitFor(() => expect(calls).toHaveLength(4));

    // Central's month is closed: Esha (Central) is not sent, Farid (the other branch) is.
    answer('e1', refused('MONTH_FINALIZED', finalized));
    await waitFor(() => expect(calls).toHaveLength(5));
    expect(calls.map((c) => c.employeeId)).toEqual(['e1', 'e2', 'e3', 'e4', 'e6']);
    // A different refusal afterwards does not undo that.
    answer('e3', refused('ON_LEAVE', 'Chitra is on leave that day.'));
    for (const id of ['e2', 'e4', 'e6']) answer(id);

    const still = await screen.findByRole('dialog', { name: ht.adjustManyTitle(3, past) });
    expect(calls).toHaveLength(5);
    const reasonOf = (name: string) => within(still).getByText(name).closest('li');
    expect(reasonOf('Asha Rao')).toHaveTextContent(finalized);
    expect(reasonOf('Chitra Nair')).toHaveTextContent('Chitra is on leave that day.');
    expect(reasonOf('Esha Roy')).toHaveTextContent(ht.adjustManyStopped);
    await user.click(within(still).getByRole('button', { name: t.cancel }));
    expect(screen.getByText(ht.adjustManyDone(3))).toBeInTheDocument();
    expect(screen.getByText(ht.adjustManyNotDone(3))).toBeInTheDocument();
  });
});

describe('adjusting one day', () => {
  const open = (date: string, rec: AttendanceRecord | null, shift: Shift | null = morning) =>
    render(<AdjustDialog orgId="o1" employee={asha} date={date} record={rec} shift={shift} onClose={() => undefined} onDone={() => undefined} />);

  it('starts a past day with a missing punch from the shift, and says so', () => {
    open(past, null);
    expect(screen.getByLabelText(ht.checkInTime)).toHaveValue('09:30');
    expect(screen.getByLabelText(ht.checkOutTime)).toHaveValue('18:00');
    expect(screen.getByText(ht.adjustShiftFilled('09:30', '18:00'))).toBeInTheDocument();
  });

  it('keeps a recorded check-in and fills only the missing check-out', () => {
    open(past, record('e1', past, { checkIn: new Date(`${past}T04:15:00Z`) }));
    expect(screen.getByLabelText(ht.checkInTime)).toHaveValue('09:45');
    expect(screen.getByLabelText(ht.checkOutTime)).toHaveValue('18:00');
  });

  it('fills no check-out that is not later than the check-in already there (it would be saved as the next morning)', () => {
    // Came at 18:20, after the shift's end.
    const cameLate = record('e1', past, { checkIn: new Date(`${past}T12:50:00Z`) });
    expect(shiftDefault(past, morning, cameLate)).toEqual({ checkIn: '09:30', checkOut: '' });
    expect(shiftDefault(past, morning, record('e1', past, { checkIn: new Date(`${past}T12:30:00Z`) }))).toEqual({ checkIn: '09:30', checkOut: '' });
    expect(shiftDefault(past, morning, record('e1', past, { checkIn: new Date(`${past}T12:29:00Z`) }))).toEqual({ checkIn: '09:30', checkOut: '18:00' });
    // An overnight shift ends the next morning anyway.
    expect(shiftDefault(past, { start: '22:00', end: '06:00' }, record('e1', past, { checkIn: new Date(`${past}T16:40:00Z`) }))).toEqual({ checkIn: '22:00', checkOut: '06:00' });
    open(past, cameLate);
    expect(screen.getByLabelText(ht.checkInTime)).toHaveValue('18:20');
    expect(screen.getByLabelText(ht.checkOutTime)).toHaveValue('');
    expect(screen.queryByText(ht.adjustShiftFilled('09:30', '18:00'))).toBeNull();
  });

  it('fills nothing for today, for a full day of leave, or without a shift', () => {
    expect(shiftDefault(today, morning, null)).toBeNull();
    expect(shiftDefault(past, morning, { leave: { typeId: 'casual', paid: true, half: false } })).toBeNull();
    expect(shiftDefault(past, morning, { leave: { typeId: 'casual', paid: true, half: true } })).toEqual({ checkIn: '09:30', checkOut: '18:00' });
    expect(shiftDefault(past, null, null)).toBeNull();
    // An overnight shift that started last night may not be over: no check-out is filled in.
    const night = { start: '22:00', end: '06:00' };
    expect(shiftDefault(daysAgo(1), night, null)).toEqual({ checkIn: '22:00', checkOut: '' });
    expect(shiftDefault(daysAgo(2), night, null)).toEqual({ checkIn: '22:00', checkOut: '06:00' });
    open(today, null);
    expect(screen.getByLabelText(ht.checkInTime)).toHaveValue('');
    expect(screen.queryByRole('button', { name: ht.clearTimes })).toBeNull();
  });

  it('clears both times in one press, and offers the last reason again', async () => {
    const user = userEvent.setup();
    const first = open(past, null);
    await user.click(screen.getByRole('button', { name: ht.clearTimes }));
    expect(screen.getByLabelText(ht.checkInTime)).toHaveValue('');
    expect(screen.getByLabelText(ht.checkOutTime)).toHaveValue('');
    // The reason of the adjustment before this one is already there (the test above left it).
    await user.clear(screen.getByLabelText(t.reasonLabel));
    await user.type(screen.getByLabelText(t.reasonLabel), 'Was on site visit');
    await user.click(screen.getByRole('button', { name: t.save }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ action: 'attendance-adjust', employeeId: 'e1', date: past, checkIn: null, checkOut: null, reason: 'Was on site visit' });
    first.unmount();
    open(daysAgo(5), null);
    expect(screen.getByLabelText(t.reasonLabel)).toHaveValue('Was on site visit');
  });
});

describe('corrections', () => {
  it('reads the waiting list once, counts only what is yours to decide, and approves the ticked ones side by side', async () => {
    world.corrections = [correction(1, 'Asha Rao', past), correction(2, 'Bela Shah', past), correction(3, 'Chitra Nair', past), correction(0, 'Me Manager', past, { employeeUid: 'me' })];
    const user = await openBoard();
    const tab = screen.getByRole('tab', { name: new RegExp(ht.tabCorrections) });
    await waitFor(() => expect(tab).toHaveTextContent(`${ht.tabCorrections}3`));
    expect(world.reads.corrections).toBe(1);
    await user.click(tab);
    await waitFor(() => expect(world.reads.corrections).toBe(2)); // coming to the tab looks again, once

    // Nothing is ticked to begin with, and your own request cannot be.
    expect(screen.getByRole('button', { name: ht.approveSelected(0) })).toBeDisabled();
    expect(screen.queryByRole('checkbox', { name: ht.selectCorrection('Me Manager', past) })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: ht.selectAllDecidable }));
    world.respond = ((data: Sent) =>
      data.correctionId === `e2_${past}` ? refused('MONTH_FINALIZED', 'Attendance for this month is finalized. Ask HR to reopen it.') : data.correctionId === `e3_${past}` ? refused('NOT_PENDING', 'This correction has already been decided.') : {}) as never;
    world.corrections = [correction(2, 'Bela Shah', past), correction(0, 'Me Manager', past, { employeeUid: 'me' })];
    await user.click(screen.getByRole('button', { name: ht.approveSelected(3) }));

    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls.every((c) => c.action === 'attendance-decideCorrection' && c.decision === 'APPROVE')).toBe(true);
    expect(new Set(calls.map((c) => c.requestId)).size).toBe(3);
    // Approved and decided-elsewhere rows go; the refused one stays ticked with the reason.
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Asha Rao' })).toBeNull());
    expect(screen.queryByRole('link', { name: 'Chitra Nair' })).toBeNull();
    expect(screen.getByText('Attendance for this month is finalized. Ask HR to reopen it.')).toBeInTheDocument();
    expect(screen.getByText(ht.decidedElsewhere([`Chitra Nair, ${past}`]))).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: ht.selectCorrection('Bela Shah', past) })).toBeChecked();
    expect(screen.getByRole('button', { name: ht.approveSelected(1) })).toBeEnabled();
    // One more read of the list, once nothing is on its way.
    await waitFor(() => expect(world.reads.corrections).toBe(3));
    expect(tab).toHaveTextContent(`${ht.tabCorrections}1`);
  });

  it('a day asked again while the list is open does not arrive ticked', async () => {
    world.corrections = [correction(1, 'Asha Rao', past, { requestedAt: new Date(1_800_000_000_000) }), correction(2, 'Bela Shah', past), correction(3, 'Chitra Nair', past)];
    const user = await openBoard();
    await user.click(screen.getByRole('tab', { name: new RegExp(ht.tabCorrections) }));
    await waitFor(() => expect(world.reads.corrections).toBe(2));
    await user.click(await screen.findByRole('checkbox', { name: ht.selectCorrection('Asha Rao', past) }));
    await user.click(screen.getByRole('checkbox', { name: ht.selectCorrection('Bela Shah', past) }));
    expect(screen.getByRole('button', { name: ht.approveSelected(2) })).toBeEnabled();

    // Meanwhile HR rejects Asha's request and she asks again for the same day, with another time: the id is the same.
    world.corrections = [correction(1, 'Asha Rao', past, { checkIn: '08:00', requestedAt: new Date(1_800_000_600_000) }), correction(2, 'Bela Shah', past)];
    // Deciding another row reads the list again.
    await user.click(screen.getByRole('button', { name: `${ht.approve} Chitra Nair ${past}` }));
    await waitFor(() => expect(world.reads.corrections).toBe(3));
    expect(await screen.findByText(ht.requested('08:00', '18:00'))).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: ht.selectCorrection('Asha Rao', past) })).not.toBeChecked();
    // Bela's is the request that was ticked: it still is.
    expect(screen.getByRole('checkbox', { name: ht.selectCorrection('Bela Shah', past) })).toBeChecked();
    expect(screen.getByRole('button', { name: ht.approveSelected(1) })).toBeEnabled();
  });

  it('says on the Month tab what still waits for the month, before Finalize is pressed', async () => {
    const lastMonth = (() => {
      const [y, m] = monthIST().split('-').map(Number);
      return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    })();
    world.corrections = [correction(1, 'Asha Rao', `${lastMonth}-05`), correction(2, 'Bela Shah', `${monthIST()}-01`)];
    world.leave = [{ id: 'l1', branchId: 'b1', employeeUid: 'u1', dates: [`${lastMonth}-10`, `${lastMonth}-11`] } as LeaveRequest, { id: 'l2', branchId: 'b2', employeeUid: 'u2', dates: [`${lastMonth}-10`] } as LeaveRequest];
    const user = await openBoard();
    await user.click(screen.getByRole('tab', { name: ht.tabMonth }));
    expect(await screen.findByText(new RegExp(ht.finalizeWaiting(1, 1).replace(/[.]/g, '\\.')))).toBeInTheDocument();
    // Finalize stays available: the server decides.
    expect(screen.getByRole('button', { name: ht.finalize })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: ht.openCorrections }));
    expect(await screen.findByRole('checkbox', { name: ht.selectCorrection('Asha Rao', `${lastMonth}-05`) })).toBeInTheDocument();
  });
});

describe('the check-in card', () => {
  const card = (props: Parameters<typeof CheckInCard>[0] = {}) =>
    render(
      <MemoryRouter>
        <CheckInCard {...props} />
      </MemoryRouter>,
    );

  it('reads the record and today together, and shows a punch from its answer without reading again', async () => {
    const onPunched = vi.fn();
    card({ compact: true, onPunched });
    const user = userEvent.setup();
    expect(await screen.findByText(ht.notCheckedIn)).toBeInTheDocument();
    expect(world.reads).toMatchObject({ myEmployee: 1, myDay: 1, month: 0 });

    const at = Date.now();
    world.respond = (() => ({ date: today, status: 'IN_PROGRESS', late: true, lateMinutes: 14, earlyExit: false, missedCheckout: false, workedMinutes: 0, checkIn: at, checkOut: null })) as never;
    await user.click(screen.getByRole('button', { name: ht.checkIn }));
    expect(await screen.findByText(/^Checked in at/)).toBeInTheDocument();
    expect(screen.getByText(ht.lateBy(14))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ht.checkOut })).toBeEnabled();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ action: 'attendance-punch', punch: 'IN' });
    expect(calls[0].employeeId).toBeUndefined();
    expect(onPunched).toHaveBeenCalledTimes(1);
    expect(world.reads).toMatchObject({ myEmployee: 1, myDay: 1 });

    world.respond = (() => ({ date: today, status: 'HALF_DAY', late: true, lateMinutes: 14, earlyExit: true, missedCheckout: false, workedMinutes: 250, checkIn: at, checkOut: at + 250 * 60_000 })) as never;
    await user.click(screen.getByRole('button', { name: ht.checkOut }));
    expect(await screen.findByText(/^Checked out at/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ht.checkOut })).toBeNull();
    expect(world.reads).toMatchObject({ myEmployee: 1, myDay: 1 });
  });

  it("a check-out that closed yesterday's day leaves today not checked in", async () => {
    world.myDay = record('e0', today, { checkIn: new Date(Date.now() - 60_000) });
    card();
    const user = userEvent.setup();
    world.respond = (() => ({ date: daysAgo(1), status: 'PRESENT', late: false, lateMinutes: 0, earlyExit: false, missedCheckout: false, workedMinutes: 480, checkIn: 1, checkOut: 2 })) as never;
    await user.click(await screen.findByRole('button', { name: ht.checkOut }));
    expect(await screen.findByText(ht.notCheckedIn)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ht.checkIn })).toBeEnabled();
  });

  it('uses the record a page already read, and shows nothing for someone not working here', async () => {
    const { unmount } = card({ me: person(0, 'Me Manager', { uid: 'me' }) });
    expect(await screen.findByText(ht.notCheckedIn)).toBeInTheDocument();
    expect(world.reads).toMatchObject({ myEmployee: 0, myDay: 1 });
    unmount();
    const { container } = card({ me: person(0, 'Me Manager', { uid: 'me', status: 'OFFBOARDED' }) });
    await waitFor(() => expect(world.reads.myDay).toBe(2));
    expect(container).toBeEmptyDOMElement();
    // No record at all: nothing either.
    world.me = null;
    const none = card();
    await waitFor(() => expect(world.reads.myEmployee).toBe(1));
    expect(none.container).toBeEmptyDOMElement();
  });
});
