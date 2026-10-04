import type { Clock } from '../application/clock.js';
import { LodySdkError } from '../domain/errors.js';

export const systemClock: Clock = {
  now: () => performance.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(new LodySdkError('cancelled'));
        return;
      }
      let timer: ReturnType<typeof setTimeout>;
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        reject(new LodySdkError('cancelled'));
      };
      timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, ms);
      signal.addEventListener('abort', abort, { once: true });
    }),
};
