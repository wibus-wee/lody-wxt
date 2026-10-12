import assert from 'node:assert/strict';

export const extensionReportName = /^extension(?:-([1-9]\d*))?\.json$/;

export function extensionRuns(repeat, directory, failFast = false) {
  assert.ok(Number.isInteger(repeat) && repeat >= 1 && repeat <= 20);
  return Array.from({ length: repeat }, (_, index) => {
    const repetition = index + 1;
    return {
      args: [
        'exec',
        'playwright',
        'test',
        '--output',
        `test-results/${directory.split('/').at(-1)}/extension-${repetition}`,
        ...(failFast ? ['--max-failures=1'] : []),
      ],
      env: {
        ASSURANCE_REPETITION: String(repetition),
        ASSURANCE_EXTENSION_REPORT:
          repetition === 1 ? 'extension.json' : `extension-${repetition}.json`,
      },
    };
  });
}

export function collectExtensionOutcomes(report, repetition, outcomes) {
  const visit = (suites) => {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          const key = `extension:${repetition}:${spec.id}`;
          assert.ok(!outcomes.has(key), `Duplicate framework outcome: ${key}`);
          const statuses = test.results.map((result) => result.status);
          outcomes.set(
            key,
            statuses.length && statuses.every((status) => status === 'passed')
              ? 'passed'
              : statuses.some((status) => ['failed', 'timedOut', 'interrupted'].includes(status))
                ? 'failed'
                : 'incomplete',
          );
        }
      }
      visit(suite.suites);
    }
  };
  visit(report?.suites);
}
