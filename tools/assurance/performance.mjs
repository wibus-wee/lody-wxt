import assert from 'node:assert/strict';

export const policy = { minimumSamples: 5, relativeTolerance: 0.25, absoluteToleranceMs: 50 };
export function percentile(values, fraction) {
  const ordered = values.toSorted((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
}

export function performanceGroups(records) {
  const groups = new Map();
  for (const record of records)
    for (const sample of record.interactions ?? []) {
      const key = JSON.stringify([sample.id, sample.environment]);
      const group = groups.get(key) ?? {
        key,
        id: sample.id,
        environment: sample.environment,
        values: [],
        excluded: 0,
        attribution: [],
        artifacts: [],
      };
      if (
        record.status === 'passed' &&
        sample.status === 'observed' &&
        Number.isFinite(sample.durationMs) &&
        sample.durationMs >= 0
      ) {
        group.values.push(sample.durationMs);
        group.attribution.push(sample.attribution);
      } else group.excluded++;
      group.artifacts.push(record.trace);
      groups.set(key, group);
    }
  return Array.from(groups.values(), (group) => ({
    ...group,
    medianMs: percentile(group.values, 0.5),
    p95Ms: percentile(group.values, 0.95),
  }));
}

export function compareBaseline(group, baseline) {
  const previous = baseline?.groups.find((item) => item.key === group.key);
  if (!previous) return { status: 'no comparable baseline' };
  if (group.values.length < policy.minimumSamples || previous.values.length < policy.minimumSamples)
    return { status: 'insufficient samples' };
  const toleranceMs = Math.max(
    policy.absoluteToleranceMs,
    previous.p95Ms * policy.relativeTolerance,
  );
  return {
    status: group.p95Ms > previous.p95Ms + toleranceMs ? 'regression' : 'within baseline',
    deltaMs: group.p95Ms - previous.p95Ms,
    toleranceMs,
  };
}

export function promoteBaseline(groups, provenance) {
  assert.ok(groups.length > 0, 'No observed interactions to baseline');
  for (const group of groups)
    assert.ok(
      group.values.length >= policy.minimumSamples,
      `${group.id}: Need ${policy.minimumSamples} comparable successful samples`,
    );
  return {
    version: 1,
    policy,
    provenance,
    groups: groups.map(({ key, id, environment, values, medianMs, p95Ms }) => ({
      key,
      id,
      environment,
      values,
      medianMs,
      p95Ms,
    })),
  };
}

// Keep strict validation available for explicit enforcement and baseline tooling.
export function assertReleaseSamples(groups, interactionIds) {
  for (const id of interactionIds) {
    const matching = groups.filter((group) => group.id === id);
    assert.ok(matching.length > 0, `Missing release measurement: ${id}`);
    for (const group of matching)
      assert.ok(group.values.length >= policy.minimumSamples, `Incomplete release samples: ${id}`);
  }
}

// Advisory release reporting retains every missing/undersampled boundary.
export function releaseSampleFindings(groups, interactionIds) {
  return interactionIds.flatMap((id) => {
    const matching = groups.filter((group) => group.id === id);
    if (!matching.length) return [`Missing release measurement: ${id}`];
    return matching
      .filter((group) => group.values.length < policy.minimumSamples)
      .map(
        (group) =>
          `Incomplete release samples: ${id} (${group.values.length}/${policy.minimumSamples})`,
      );
  });
}

export function performanceBlocks(audit, mode = 'enforce') {
  assert.ok(['enforce', 'report'].includes(mode), 'Unknown performance mode');
  if (mode === 'report') return false;
  return (
    audit.measurementFailures.length > 0 ||
    (audit.performanceWarnings ?? []).length > 0 ||
    audit.performance.some((item) => item.comparison.status === 'regression')
  );
}
