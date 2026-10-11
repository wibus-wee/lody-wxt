import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createReviewPacket, renderReviewPacket } from './review-packet.mjs';

test('concise review packet retains failed/missing obligations and exact provenance without retry-to-green', () => {
  const audit = {
    runId: '1234',
    modelHash: 'c'.repeat(64),
    sourceHash: 'd'.repeat(64),
    stale: false,
    finished: true,
    layerFailures: [],
    measurementFailures: [],
    cases: [
      { key: 'send/delivery', status: 'failed', missing: ['remote-admission'] },
      { key: 'send/reconnect', status: 'verified', missing: [] },
      { key: 'restart/persistence', status: 'missing', missing: ['retained-draft'] },
    ],
  };
  const packet = createReviewPacket({
    repository: 'wibus-wee/lody-wxt',
    headSha: 'a'.repeat(40),
    baseSha: 'b'.repeat(40),
    run: {
      id: 42,
      attempt: 1,
      artifactId: 7,
      url: 'https://github.com/wibus-wee/lody-wxt/actions/runs/42',
    },
    audit,
    evidenceDigest: 'e'.repeat(64),
    decision: { decision: 'REVISE', blockingFindings: [] },
  });
  assert.equal(packet.assuranceStatus, 'incomplete');
  assert.equal(packet.summary.failed, 1);
  assert.equal(packet.summary.verified, 1);
  assert.deepEqual(packet.journeyDiff[0].missingObligations, ['remote-admission']);
  assert.ok(renderReviewPacket(packet).includes('remote-admission'));
  assert.equal(packet.provenance.artifactId, 7);
});
