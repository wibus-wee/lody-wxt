import type { Journey, LifecycleCase } from './model.mjs';

export function findCase(
  journey: string,
  variant: string,
): { journey: Journey; variant: LifecycleCase };
export const modelHash: string;
