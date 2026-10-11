import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

import { model } from '../assurance/model.mjs';
import { parsePolicy, shaPattern } from './common.mjs';
import { parseIntent, resolveIntent } from './contract.mjs';
import { GitHub } from './github.mjs';
import { classifyImpact } from './impact.mjs';
import { loadImpactGraph } from './impact-graph.mjs';

// Executed only from the authenticated protected checkout. The downloaded intent
// supplies data paths, never a module, command or executable expression.
async function main() {
  const intent = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const policy = parsePolicy(await readFile('.github/autonomous-maintenance-policy.yml', 'utf8'));
  const impact = classifyImpact(intent.files, policy, model, await loadImpactGraph());
  const needed = impact.ui;
  await appendFile(process.env.GITHUB_OUTPUT, `needed=${needed ? 'true' : 'false'}\n`);
  if (needed) {
    const declared = parseIntent(intent.body);
    if (declared.capture_plan) {
      if (!shaPattern.test(process.env.CANDIDATE_SHA ?? ''))
        throw new Error('Candidate commit required for capture plan');
      const github = new GitHub(process.env.GH_TOKEN, process.env.GITHUB_REPOSITORY);
      await resolveIntent(intent.body, async (file) => {
        intent.capturePlanPath = file;
        intent.capturePlanText = await github.content(file, process.env.CANDIDATE_SHA);
        return intent.capturePlanText;
      });
      await writeFile(process.argv[2], JSON.stringify(intent));
    }
  }
  if (!needed) {
    await mkdir('reports/autonomy/screenshots', { recursive: true });
    await writeFile(
      'reports/autonomy/screenshots/not-applicable.json',
      `${JSON.stringify(
        {
          schemaVersion: 1,
          applicable: false,
          reason: impact.reason,
          sourceRunId: process.env.SOURCE_RUN_ID,
          sourceRunAttempt: process.env.SOURCE_RUN_ATTEMPT,
        },
        null,
        2,
      )}\n`,
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
