import { createLodyClient } from '@lody-mobile/sdk';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { extensionHttpTransport } from '../network/transport';
import { AccountController } from './controller';
import { createAccountStorage } from './storage';
import { AccountContext } from './useAccount';

export function AccountProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(
    () =>
      new AccountController(createAccountStorage(), (config) =>
        createLodyClient({
          ...config,
          ...(new Set(['chrome-extension:', 'moz-extension:']).has(location.protocol)
            ? { transport: extensionHttpTransport }
            : {}),
        }),
      ),
  );
  useEffect(() => {
    void controller.initialize();
    return controller.dispose;
  }, [controller]);
  return <AccountContext value={controller}>{children}</AccountContext>;
}
