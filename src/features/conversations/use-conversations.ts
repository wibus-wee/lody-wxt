import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { watchLocal } from '../../shared/storage';
import { demoHistoryKey } from '../chat/demo-runtime';
import type { LodyClient } from '../connection/client';

export function useConversations(client: LodyClient) {
  const queryClient = useQueryClient();
  const key = ['conversations', client.accountKey];
  const query = useQuery({
    queryKey: key,
    queryFn: () => client.list(),
    retry: false,
    refetchInterval: client.accountKey.startsWith('demo:') ? 250 : false,
  });
  useEffect(
    () =>
      watchLocal(demoHistoryKey, () => {
        void queryClient.invalidateQueries({ queryKey: ['conversations', client.accountKey] });
      }),
    [client.accountKey, queryClient],
  );
  return query;
}
