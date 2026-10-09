import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import * as v from 'valibot';
import { browser } from 'wxt/browser';

import { isExtension, watchLocal } from '../../shared/storage';
import { updateKey, updateStateSchema } from './appcast';

const replySchema = v.variant('ok', [
  v.strictObject({ ok: v.literal(true), state: updateStateSchema }),
  v.strictObject({ ok: v.literal(false), error: v.string() }),
]);
const queryKey = ['extension-updates'];
async function request(
  message:
    | { type: 'updates:get' | 'updates:check' }
    | { type: 'updates:skip'; version: string | null },
) {
  const reply = v.parse(replySchema, await browser.runtime.sendMessage(message));
  if (!reply.ok) throw new Error(reply.error);
  return reply.state;
}
export function useUpdates() {
  const client = useQueryClient();
  const enabled = isExtension();
  const query = useQuery({
    queryKey,
    queryFn: () => request({ type: 'updates:get' }),
    enabled,
    retry: false,
    staleTime: Infinity,
  });
  useEffect(() => {
    if (!enabled) return;
    return watchLocal(updateKey, () => {
      void client.invalidateQueries({ queryKey });
    });
  }, [enabled, client]);
  const onSuccess = (state: v.InferOutput<typeof updateStateSchema>) =>
    client.setQueryData(queryKey, state);
  const check = useMutation({ mutationFn: () => request({ type: 'updates:check' }), onSuccess });
  const skip = useMutation({
    mutationFn: (version: string | null) => request({ type: 'updates:skip', version }),
    onSuccess,
  });
  return {
    installedVersion: enabled ? browser.runtime.getManifest().version : null,
    state: query.data,
    busy: query.isFetching || check.isPending || skip.isPending,
    error: query.error?.message ?? check.error?.message ?? skip.error?.message ?? null,
    check: () => check.mutate(),
    skip: (version: string | null) => skip.mutate(version),
  };
}
