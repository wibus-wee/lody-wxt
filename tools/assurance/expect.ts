import { expect } from '@playwright/test';

// Short fixture SSE batches can wait five seconds before reconnecting. Allow
// confirmation plus rendering time; interaction latency is measured separately
// by armInteraction and remains subject to the authored performance audit.
export const journeyExpect = expect.configure({ timeout: 15_000 });
