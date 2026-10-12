import type { Me } from '@bipae/domain';
import type { Platform } from '@bipae/platform';
import { createContext, useContext, type ReactNode } from 'react';
import type { ApiClient } from './api-client';

interface AppContextValue {
  platform: Platform;
  api: ApiClient;
  me: Me | null;
  setMe: (me: Me | null) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppContextProvider({
  value,
  children,
}: {
  value: AppContextValue;
  children: ReactNode;
}) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp fora do AppContextProvider');
  return value;
}

export function useMe(): Me {
  const { me } = useApp();
  if (!me) throw new Error('useMe sem sessão');
  return me;
}

export function useCan(permission: string) {
  return useApp().me?.permissions.includes(permission) ?? false;
}
