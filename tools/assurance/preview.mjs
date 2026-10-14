import { setTimeout as delay } from 'node:timers/promises';

export const previewArgs = [
  'node_modules/vite/bin/vite.js',
  'preview',
  '--config',
  'vite.config.ts',
  '--host',
  '127.0.0.1',
  '--port',
  '4173',
  '--strictPort',
];

// Bound each request as well as the whole wait. An HTTP listener may accept
// connections before it can answer; that must not hang the assurance runner.
export async function waitForPreview(
  server,
  url,
  { timeoutMs = 20_000, requestTimeoutMs = 1_000, intervalMs = 200 } = {},
) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (server.exitCode !== null || server.signalCode != null)
      throw new Error('Preview exited before becoming ready');
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(requestTimeoutMs, Math.ceil(deadline - performance.now()))),
        ),
      });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      // Retry only startup readiness, never a failed user journey.
    }
    await delay(Math.max(0, Math.min(intervalMs, deadline - performance.now())));
  }
  throw new Error('Preview failed to start before readiness deadline');
}
