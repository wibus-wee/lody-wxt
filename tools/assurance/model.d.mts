export interface LifecycleCase {
  id: string;
  lifecycle: string[];
  states: string[];
  obligations: string[];
  interactions?: string[];
}
export interface Journey {
  id: string;
  namespace: string;
  priority: 'P0' | 'P1';
  intent: string;
  chain: string[];
  cases: LifecycleCase[];
}
export interface Interaction {
  id: string;
  journey: string;
  start: string;
  end: string;
  attribution: string[];
  workload: string;
}
export const model: {
  version: number;
  derivation: string;
  owners: Record<
    string,
    { source: string[]; state: string; persistence: string; lifetime: string }
  >;
  namespaces: Record<string, { disposition: string; owners: string[]; reason: string }>;
  journeys: Journey[];
  interactions: Interaction[];
};
