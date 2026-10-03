import { useAtomValue } from 'jotai';
import { useMemo } from 'react';

import { preferencesAtom } from '../preferences/state';
import { unavailableClient } from './client';
import { demoClient } from './demo-client';

export function useLodyClient() {
  const preferences = useAtomValue(preferencesAtom);
  return useMemo(
    () => (preferences.mode === 'demo' ? demoClient : unavailableClient(preferences.workspaceId)),
    [preferences.mode, preferences.workspaceId],
  );
}
