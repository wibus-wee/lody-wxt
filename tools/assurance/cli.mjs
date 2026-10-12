import { writeFile } from 'node:fs/promises';
import process from 'node:process';

import { auditCatalog, modelHash } from './catalog.mjs';
import { model } from './model.mjs';
import { promoteBaseline } from './performance.mjs';
import { generateReport } from './report.mjs';

const command = process.argv[2] ?? 'audit';
if (command === 'namespaces') {
  await writeFile('tests/e2e/namespaces.json', `${JSON.stringify(model.namespaces, null, 2)}\n`);
} else if (command === 'validate') {
  const scenarios = await auditCatalog();
  console.log(
    `${model.journeys.length} product journeys; ${scenarios.length} authored executable cases.`,
  );
} else if (command === 'audit') {
  const audit = await generateReport();
  if (
    !audit.runId ||
    !audit.finished ||
    audit.stale ||
    audit.layerFailures.length > 0 ||
    audit.measurementFailures.length > 0 ||
    audit.cases.some((item) => ['failed', 'incomplete'].includes(item.status)) ||
    audit.performance.some((item) => item.comparison.status === 'regression')
  )
    process.exitCode = 1;
  if (
    (process.argv.includes('--strict') || process.argv.includes('--complete')) &&
    audit.cases.some(
      (item) =>
        (process.argv.includes('--complete') || item.priority === 'P0') &&
        item.status !== 'verified',
    )
  )
    process.exitCode = 1;
} else if (command === 'baseline') {
  const audit = await generateReport();
  if (
    !audit.runId ||
    !audit.finished ||
    audit.stale ||
    audit.layerFailures.length > 0 ||
    audit.measurementFailures.length > 0 ||
    audit.cases.some((item) => ['failed', 'incomplete'].includes(item.status))
  )
    throw new Error('Cannot baseline a stale or failing run');
  const baseline = promoteBaseline(audit.performance, {
    modelHash,
    sourceHash: audit.sourceHash,
    runId: audit.runId,
    createdAt: new Date().toISOString(),
  });
  await writeFile('tools/assurance/baseline.json', `${JSON.stringify(baseline, null, 2)}\n`);
  console.log('Promoted explicitly observed performance baseline.');
} else throw new Error(`Unknown assurance command: ${command}`);
