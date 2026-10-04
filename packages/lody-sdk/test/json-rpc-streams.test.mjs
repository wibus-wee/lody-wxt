import assert from 'node:assert/strict';
import test from 'node:test';

import { JsonRpcStreams } from '../dist/sessions/infrastructure/json-rpc-streams.js';

for (const readyFirst of [false, true]) {
  test(
    `RPC surfaces a denied response stream ${readyFirst ? 'after' : 'before'} readiness`,
    { timeout: 2000 },
    async () => {
      let reads = 0;
      let fail;
      const failure = new Promise((resolve) => {
        fail = resolve;
      });
      const rpc = new JsonRpcStreams({
        baseUrl: 'https://streams.example.test',
        auth: 'controlled-token',
        fetch: async (_url, init) => {
          if (init.method === 'HEAD')
            return new Response(null, {
              headers: {
                'Content-Type': 'application/json',
                'Stream-Next-Offset': '100',
              },
            });
          reads++;
          if (readyFirst && reads === 1)
            return new Response(
              'event: control\ndata: {"streamNextOffset":"100","upToDate":true}\n\n',
              { headers: { 'Content-Type': 'text/event-stream' } },
            );
          return new Response('Denied', { status: 403 });
        },
      });
      const controller = new AbortController();
      try {
        const ready = rpc.subscribe(
          'workspace:rpc:res:machine',
          () => assert.fail('No successful reply'),
          controller.signal,
          fail,
        );
        if (readyFirst) await ready;
        else await assert.rejects(ready, /forbidden/);
        assert.match((await failure).message, /forbidden/);
        // Streams retries authorization once before publishing the terminal failure.
        assert.equal(reads, readyFirst ? 3 : 2);
      } finally {
        controller.abort();
      }
    },
  );
}
