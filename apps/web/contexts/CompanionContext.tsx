'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CompanionState } from '@/lib/companion';

const CompanionContext = createContext<{ state: CompanionState; setState: (state: CompanionState) => void }>({ state: 'ready', setState: () => {} });

/** Dashboard-scoped presentation state. Carries no audio, transcript or tenant data. */
export function CompanionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CompanionState>('ready');
  const value = useMemo(() => ({ state, setState }), [state]);
  return <CompanionContext.Provider value={value}>{children}</CompanionContext.Provider>;
}
export const useCompanion = () => useContext(CompanionContext);
