import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

import { auditCatalog, caseKey, findCase, modelHash, sourceFingerprint } from './catalog.mjs';
import { model } from './model.mjs';
import { collectExtensionOutcomes, extensionReportName } from './extension-runs.mjs';
import { assertReleaseSamples, compareBaseline, performanceGroups } from './performance.mjs';

const cucumberReportName = /^cucumber-\d+\.json$/;
const repetitionDigits = /\d+/;

export async function readOptional(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function auditEvidence(records, manifest, authored, outcomes = new Map()) {
  const authoredKeys = new Set(authored.map((item) => item.key));
  const results = new Map();
  for (const record of records) {
    assert.equal(record.runId, manifest.id, 'Evidence belongs to a different run');
    assert.equal(record.modelHash, modelHash, 'Evidence belongs to a different model');
    assert.equal(
      record.sourceHash,
      manifest.sourceHash,
      'Evidence belongs to a different source snapshot',
    );
    const { journey, variant } = findCase(record.journey, record.case);
    assert.equal(record.namespace, journey.namespace);
    if (['pageContext', 'extension'].includes(journey.namespace))
      assert.equal(record.layer, 'extension', 'Packaged lifecycle requires packaged evidence');
    for (const sample of record.interactions ?? [])
      assert.ok(
        model.interactions.some((item) => item.id === sample.id && item.journey === record.journey),
        'Unauthored interaction in journey',
      );
    const key = caseKey(record.journey, record.case);
    if (record.layer === 'web') assert.ok(authoredKeys.has(key), `Undeclared scenario ${key}`);
    assert.ok(
      ['web', 'extension'].includes(record.layer),
      'Contract tests cannot certify user journeys',
    );
    assert.ok(['passed', 'failed', 'incomplete'].includes(record.status));
    const observed = new Set(record.checkpoints.map((item) => item.id));
    assert.equal(observed.size, record.checkpoints.length, 'Duplicate checkpoint evidence');
    for (const id of observed)
      assert.ok(variant.obligations.includes(id), `Unauthored obligation ${id}`);
    const missing = variant.obligations.filter((id) => !observed.has(id));
    const outcome = outcomes.get(
      `${record.layer}:${record.repetition}:${record.frameworkId ?? key}`,
    );
    const status =
      outcome === 'failed'
        ? 'failed'
        : outcome !== 'passed'
          ? 'incomplete'
          : record.status === 'passed' && !missing.length
            ? 'verified'
            : record.status === 'failed'
              ? 'failed'
              : 'incomplete';
    const previous = results.get(key) ?? [];
    previous.push({ status, missing, record });
    results.set(key, previous);
  }
  return results;
}

export async function generateReport() {
  const authored = await auditCatalog();
  const latest = await readOptional('reports/assurance/latest.json');
  const manifest = latest ? await readOptional(`${latest.directory}/run.json`) : null;
  const currentSource = await sourceFingerprint();
  const stale =
    manifest && (manifest.sourceHash !== currentSource || manifest.modelHash !== modelHash);
  const records = [];
  if (manifest && !stale) {
    for (const file of await readdir(latest.directory))
      if (file.endsWith('.evidence.json'))
        records.push(await readOptional(`${latest.directory}/${file}`));
  }
  const outcomes = new Map();
  if (manifest && !stale) {
    for (const file of await readdir(latest.directory)) {
      if (cucumberReportName.test(file)) {
        const repetition = Number(file.match(repetitionDigits)[0]);
        for (const feature of await readOptional(`${latest.directory}/${file}`))
          for (const scenario of feature.elements ?? []) {
            if (scenario.type !== 'scenario') continue;
            const tag = (prefix) =>
              scenario.tags.find((item) => item.name.startsWith(prefix))?.name.slice(prefix.length);
            const key = caseKey(tag('@journey:'), tag('@case:'));
            const statuses = [
              ...(scenario.before ?? []),
              ...(scenario.steps ?? []),
              ...(scenario.after ?? []),
            ].map((item) => item.result?.status);
            const status = statuses.includes('failed')
              ? 'failed'
              : statuses.length && statuses.every((item) => item === 'passed')
                ? 'passed'
                : 'incomplete';
            outcomes.set(`web:${repetition}:${key}`, status);
            if (
              !records.some(
                (record) =>
                  record.layer === 'web' &&
                  record.repetition === repetition &&
                  caseKey(record.journey, record.case) === key,
              )
            ) {
              const { journey } = findCase(tag('@journey:'), tag('@case:'));
              records.push({
                runId: manifest.id,
                modelHash,
                sourceHash: manifest.sourceHash,
                journey: journey.id,
                case: tag('@case:'),
                namespace: journey.namespace,
                layer: 'web',
                repetition,
                status: status === 'failed' ? 'failed' : 'incomplete',
                checkpoints: [],
                interactions: [],
                trace: `${latest.directory}/${file}`,
              });
            }
          }
      }
    }
    for (const file of await readdir(latest.directory)) {
      const match = file.match(extensionReportName);
      if (!match) continue;
      const repetition = Number(match[1] ?? 1);
      assert.ok(
        repetition >= 1 && repetition <= manifest.repeat,
        'Unexpected extension repetition',
      );
      collectExtensionOutcomes(
        await readOptional(`${latest.directory}/${file}`),
        repetition,
        outcomes,
      );
    }
    for (const record of records) if (record.trace) await readFile(record.trace);
  }
  const results =
    manifest && !stale ? auditEvidence(records, manifest, authored, outcomes) : new Map();
  const rows = model.journeys.flatMap((journey) =>
    journey.cases.map((variant) => {
      const key = caseKey(journey.id, variant.id);
      const evidence = results.get(key) ?? [];
      const status = !evidence.length
        ? 'missing'
        : evidence.every((item) => item.status === 'verified')
          ? 'verified'
          : evidence.some((item) => item.status === 'failed')
            ? 'failed'
            : 'incomplete';
      const missing =
        status === 'verified'
          ? []
          : variant.obligations.filter(
              (id) =>
                !evidence.some(
                  (item) =>
                    item.status === 'verified' &&
                    item.record.checkpoints.some((checkpoint) => checkpoint.id === id),
                ),
            );
      return { journey, variant, key, status, missing, evidence };
    }),
  );
  const savedBaseline = await readOptional('tools/assurance/baseline.json');
  const baseline = savedBaseline?.provenance.modelHash === modelHash ? savedBaseline : null;
  const measurementFailures = records.flatMap((record) => {
    const { variant } = findCase(record.journey, record.case);
    return (variant.interactions ?? [])
      .filter(
        (id) =>
          !record.interactions?.some(
            (sample) =>
              sample.id === id &&
              sample.status === 'observed' &&
              Number.isFinite(sample.durationMs) &&
              sample.durationMs >= 0,
          ),
      )
      .map(
        (id) => `${caseKey(record.journey, record.case)} / ${id} / attempt ${record.repetition}`,
      );
  });
  const certified = [...results.values()]
    .flat()
    .filter((item) => item.status === 'verified')
    .map((item) => item.record);
  const performanceRecords = records.map((record) => ({
    ...record,
    status: certified.includes(record) ? 'passed' : 'failed',
  }));
  const groups = performanceGroups(performanceRecords).map((group) => ({
    ...group,
    comparison: compareBaseline(group, baseline),
  }));
  if (process.env.ASSURANCE_REQUIRE_PERFORMANCE === '1')
    assertReleaseSamples(
      groups,
      model.interactions.map((interaction) => interaction.id),
    );
  const verified = rows.filter((row) => row.status === 'verified').length;
  const lines = [
    '# Product assurance',
    '',
    'Generated from the independently authored [product model](./tools/assurance/model.mjs). Test discovery supplies evidence, never the denominator. See the [assurance contract](./tools/assurance/README.md).',
    '',
    `Model: \`${modelHash.slice(0, 12)}\`. Source: \`${currentSource.slice(0, 12)}\`. Evidence: ${stale ? '**STALE — source/model changed; none credited**' : manifest ? `run \`${manifest.id}\`` : '**not run**'}.`,
    '',
    `${verified}/${rows.length} authored lifecycle cases verified. This counts explicit lifecycle cases, not product safety or an exhaustive Cartesian state space.`,
    '',
    '## Journey and lifecycle/state fusion',
    '',
    'A case is verified only when every authored checkpoint was asserted in the same successful journey attempt. Tags, isolated checks and suite pass counts are insufficient. Failed repetitions remain visible.',
    '',
    '| Risk | Journey / case | Lifecycle links | Joint state obligations | Evidence |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const traces = row.evidence
      .map((item) => `[${item.record.layer}](${item.record.trace})`)
      .join(', ');
    lines.push(
      `| ${row.journey.priority} | ${row.key} | ${row.variant.lifecycle.join(' → ')} | ${row.variant.states.join('; ')} | ${row.status}${traces ? `: ${traces}` : ''} |`,
    );
  }
  lines.push(
    '',
    '## Architecture links and state owners',
    '',
    '| Owner | State and authority | Durability / invalidation | Source |',
    '| --- | --- | --- | --- |',
  );
  for (const [name, owner] of Object.entries(model.owners))
    lines.push(
      `| ${name} | ${owner.state} | ${owner.persistence} ${owner.lifetime} | ${owner.source.map((file) => `[code](./${file})`).join(', ')} |`,
    );
  lines.push(
    '',
    '## Namespace disposition',
    '',
    '| Namespace | Disposition | Owners | Architectural reason |',
    '| --- | --- | --- | --- |',
  );
  for (const [namespace, entry] of Object.entries(model.namespaces))
    lines.push(
      `| ${namespace} | ${entry.disposition} | ${entry.owners.join(', ')} | ${entry.reason} |`,
    );
  lines.push(
    '',
    '## Risk-prioritized missing journeys',
    '',
    '| Risk | Case | Missing assurance obligations | Product chain |',
    '| --- | --- | --- | --- |',
  );
  for (const row of rows
    .filter((item) => item.status !== 'verified')
    .toSorted((a, b) => a.journey.priority.localeCompare(b.journey.priority)))
    lines.push(
      `| ${row.journey.priority} | ${row.key} (${row.status}) | ${row.missing.join('; ')} | ${row.journey.chain.join(' → ')} |`,
    );
  lines.push(
    '',
    '## User action → observable response',
    '',
    'The browser captures the trusted action event before its handler and samples the authored DOM outcome at animation frames. This measures visible DOM presentation opportunity, not physical display paint, INP or request duration. Hidden pages, failed journeys, missing events and timeouts cannot enter successful latency distributions.',
    '',
    '| Boundary | Authored start | Observable end | Samples / excluded | Median / p95 | Baseline |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const interaction of model.interactions) {
    const matching = groups.filter((group) => group.id === interaction.id);
    if (!matching.length)
      lines.push(
        `| ${interaction.id} | ${interaction.start} | ${interaction.end} | not measured | — | no baseline evidence |`,
      );
    for (const group of matching)
      lines.push(
        `| ${interaction.id} | ${interaction.start} | ${interaction.end} | ${group.values.length} / ${group.excluded} | ${group.medianMs?.toFixed(1) ?? '—'} / ${group.p95Ms?.toFixed(1) ?? '—'} ms | ${group.comparison.status} |`,
      );
  }
  lines.push(
    '',
    `Required measurements missing/invalid: ${measurementFailures.length ? measurementFailures.join('; ') : 'none in executed cases'}.`,
    '',
    'Per-action samples retain environment/workload keys, same-clock resource and long-task overlap, and traces. Overlapping intervals are not added to fabricate a critical path. Unattributed time includes storage, decoding, sync scheduling, remote execution and rendering. Controlled fixture latency is not production latency.',
    '',
    'Baseline promotion requires five successful comparable samples per measured boundary. Comparison requires matching browser/version, OS/architecture, viewport, motion policy, surface, workload and measurement version; p95 must exceed both the 25% relative and 50 ms absolute noise allowance. Small samples stay provisional. Baselines are explicitly promoted, never rewritten by tests.',
    '',
    '## Verification layers and limits',
    '',
    'SDK/Node and Vitest Browser Mode verify non-component contracts; Storybook verifies component states; Playwright/Cucumber execute authored user journeys; axe checks rendered accessibility within journeys. Counts and code percentages are not assurance coverage. Packaged observations require extension-layer receipts. Controlled HTTP/Streams evidence does not prove a deployed agent, native permission-dialog approval or production latency.',
    '',
    `Artifacts: ${latest ? `[run manifest](./${latest.directory}/run.json), [machine-readable audit](./${latest.directory}/audit.json)` : 'no current run'}. Source drift invalidates credit; missing runs remain missing.`,
    '',
  );
  await writeFile('COVERAGE.md', lines.join('\n'));
  const audit = {
    layerFailures: Object.entries(manifest?.layers ?? {})
      .filter(([, result]) => result.exitCode !== 0)
      .map(([name]) => name),
    modelHash,
    finished: Boolean(manifest?.finishedAt),
    sourceHash: currentSource,
    stale: Boolean(stale),
    runId: manifest?.id ?? null,
    cases: rows.map(({ journey, variant, key, status, missing }) => ({
      key,
      priority: journey.priority,
      states: variant.states,
      lifecycle: variant.lifecycle,
      status,
      missing,
    })),
    performance: groups,
    measurementFailures,
  };
  if (latest) await writeFile(`${latest.directory}/audit.json`, JSON.stringify(audit, null, 2));
  process.stdout.write(
    `Product assurance: ${verified}/${rows.length} lifecycle cases verified${stale ? ' (stale evidence rejected)' : ''}.\n`,
  );
  return audit;
}
