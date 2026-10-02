import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider } from 'jotai';
import { LazyMotion, MotionConfig } from 'motion/react';
import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import { HashRouter } from 'react-router';

const loadMotionFeatures = () =>
  import('../shared/motion/features').then((module) => module.default);

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <Provider>
      <QueryClientProvider client={queryClient}>
        <MotionConfig
          reducedMotion="user"
          transition={{ type: 'spring', stiffness: 360, damping: 32 }}
        >
          <LazyMotion features={loadMotionFeatures} strict>
            <HashRouter>{children}</HashRouter>
          </LazyMotion>
        </MotionConfig>
      </QueryClientProvider>
    </Provider>
  );
}
