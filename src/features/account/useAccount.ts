import { createContext, useContext, useSyncExternalStore } from 'react';

import type { AccountController } from './controller';

export const AccountContext = createContext<AccountController | null>(null);

export function useAccount() {
  const controller = useContext(AccountContext);
  if (!controller) throw new Error('useAccount requires AccountProvider');
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return {
    ...state,
    login: controller.login,
    retryValidation: controller.retryValidation,
    cancel: controller.cancel,
    logout: controller.logout,
    selectWorkspace: controller.selectWorkspace,
  };
}
