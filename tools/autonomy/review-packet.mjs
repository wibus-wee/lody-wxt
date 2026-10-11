import assert from 'node:assert/strict';

import { hashPattern, shaPattern } from './common.mjs';

const whitespace = /\s+/g;

export function createReviewPacket({
  repository,
  headSha,
  baseSha,
  run,
  audit,
  evidenceDigest,
  decision,
}) {
  assert.ok(
    shaPattern.test(headSha) && shaPattern.test(baseSha) && hashPattern.test(evidenceDigest),
  );
  assert.ok(audit?.cases?.length > 0 && audit.runId && run?.id);
  const status =
    audit.stale ||
    !audit.finished ||
    audit.layerFailures.length ||
    audit.measurementFailures.length ||
    audit.cases.some((item) => item.status !== 'verified')
      ? 'incomplete'
      : 'verified';
  const journeyDiff = audit.cases
    .filter((item) => item.status !== 'verified')
    .map((item) => ({
      journey: item.key,
      expected: 'All authored obligations in one successful attempt',
      observed: item.status,
      missingObligations: item.missing ?? [],
    }));
  const findings = decision?.blockingFindings ?? [];
  const errors = [
    ...findings.map((item) => `${item.code}: ${item.location}: ${item.reason}`),
    ...audit.layerFailures.map((layer) => `Execution layer failed: ${layer}`),
    ...audit.measurementFailures.map((failure) => `Interaction measurement failed: ${failure}`),
    ...journeyDiff.map(
      (item) =>
        `${item.journey}: ${item.observed}; missing ${item.missingObligations.join(', ') || 'a complete verified attempt'}`,
    ),
  ];
  return {
    schemaVersion: 1,
    repository,
    headSha,
    baseSha,
    evidenceDigest,
    provenance: {
      runId: String(run.id),
      attempt: run.attempt,
      artifactId: run.artifactId,
      assuranceRunId: audit.runId,
      modelHash: audit.modelHash,
      sourceHash: audit.sourceHash,
    },
    assuranceStatus: status,
    acceptanceDecision: decision?.decision ?? 'PENDING',
    summary: {
      modeled: audit.cases.length,
      verified: audit.cases.filter((item) => item.status === 'verified').length,
      failed: audit.cases.filter((item) => item.status === 'failed').length,
      incomplete: journeyDiff.length,
    },
    errors: errors.slice(0, 3),
    additionalErrors: Math.max(0, errors.length - 3),
    journeyDiff,
    evidence: {
      runUrl: run.url,
      auditPath: `reports/assurance/${audit.runId}/audit.json`,
      manifestPath: 'reports/autonomy/evidence.json',
    },
    limits:
      'A machine-readable assertion summary; screenshots, suite counts and this packet alone cannot authorize acceptance. Raw failed attempts remain retained. Authoritative value differences are in the original assertion reports and traces.',
  };
}
export function renderReviewPacket(packet) {
  const lines = [
    `Acceptance: ${packet.acceptanceDecision}; assurance: ${packet.assuranceStatus}.`,
    `Candidate: \`${packet.headSha}\`; base: \`${packet.baseSha}\`; run: ${packet.provenance.runId}, attempt ${packet.provenance.attempt}.`,
    '',
    `${packet.summary.verified}/${packet.summary.modeled} modeled cases verified; ${packet.summary.failed} failed; ${packet.summary.incomplete} incomplete/missing. Counts describe execution obligations, not product correctness.`,
    '',
    ...packet.errors.map((error) => `- ${error.replace(whitespace, ' ')}`),
    ...(packet.additionalErrors
      ? [`- ${packet.additionalErrors} additional errors remain in the full reports.`]
      : []),
    '',
    `[Original run](${packet.evidence.runUrl}); audit: \`${packet.evidence.auditPath}\`; evidence digest: \`${packet.evidenceDigest}\`.`,
    '',
    packet.limits,
    '',
  ];
  return lines.join('\n');
}
