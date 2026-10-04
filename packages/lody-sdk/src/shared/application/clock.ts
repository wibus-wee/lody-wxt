/** now is nondecreasing milliseconds; sleep must reject and release its timer when aborted. */
export interface Clock {
  now: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}
