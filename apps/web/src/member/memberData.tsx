import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

import { type Membership, loadOverview, type Overview } from '../data/me';
import { type AsyncState, useAsync } from '../shared/useAsync';

interface MemberData {
  overview: AsyncState<Overview>;
  /** The membership being viewed (a guardian can switch to their child's). */
  current: Membership | null;
  select: (memberId: string) => void;
}

const Ctx = createContext<MemberData | null>(null);
const KEY = 'stories.member.selected';

/** Loads the signed-in person's memberships once for all member pages. */
export function MemberDataProvider({ children }: { children: ReactNode }) {
  const overview = useAsync(async () => loadOverview(), []);
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  });
  const list = overview.data?.memberships ?? [];
  const current = list.find((m) => m.memberId === selected) ?? list[0] ?? null;
  useEffect(() => {
    if (current && current.memberId !== selected) setSelected(current.memberId);
  }, [current, selected]);
  const select = (memberId: string) => {
    setSelected(memberId);
    try {
      sessionStorage.setItem(KEY, memberId);
    } catch {
      /* not remembered */
    }
  };
  return <Ctx.Provider value={{ overview, current, select }}>{children}</Ctx.Provider>;
}

export function useMemberData(): MemberData {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMemberData must be used inside <MemberDataProvider>');
  return ctx;
}
