import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import { useEffect } from 'react';

import { preferencesAtom } from './state';
import { loadPreferences, savePreferences, watchPreferences } from './storage';

export function usePreferences() {
  const [preferences, setPreferences] = useAtom(preferencesAtom);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['preferences'], queryFn: loadPreferences });
  useEffect(() => {
    if (query.data) setPreferences(query.data);
  }, [query.data, setPreferences]);
  useEffect(
    () =>
      watchPreferences((value) => {
        setPreferences(value);
        queryClient.setQueryData(['preferences'], value);
      }),
    [queryClient, setPreferences],
  );
  const mutation = useMutation({
    mutationFn: savePreferences,
    onSuccess: (_, value) => {
      setPreferences(value);
      queryClient.setQueryData(['preferences'], value);
    },
  });
  return { preferences, query, mutation };
}
