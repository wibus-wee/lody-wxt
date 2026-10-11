import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

import { model } from '../assurance/model.mjs';
import { requestDecision } from './acceptance.mjs';
import { readArchive } from './archive.mjs';
import { capturePlanHash, computeTrustedFixtureHash, validateCapturePlans } from './capture-ui.mjs';
import { boundedJSON, digest, parsePolicy, shaPattern } from './common.mjs';
import { resolveIntent, validateChange } from './contract.mjs';
import { verifyEvidence } from './evidence.mjs';
import { GitHub } from './github.mjs';
import { classifyImpact } from './impact.mjs';
import { loadImpactGraph } from './impact-graph.mjs';
import { publishAcceptance } from './merge-gate.mjs';
import { createReviewPacket, renderReviewPacket } from './review-packet.mjs';
import { scanDiffSecrets } from './secrets.mjs';
import { markUiStale } from './ui-evidence.mjs';

const whitespace = /\s+/g;
const contextsMarker = /<!-- contexts:([a-f0-9,]+) -->/;
const marker = '<!-- autonomous-acceptance:v1 -->';
const captureWorkflow = '.github/workflows/pr-evidence.yml';
const captureArtifactName = /^autonomy-ui-([a-f0-9]{40})-([1-9]\d*)-([1-9]\d*)-([1-9]\d*)$/;

export async function resolveAcceptanceRuns(github, env, policy) {
  if (env.AUTONOMY_CAPTURE_RUN_ID) {
    const captureId = Number(env.AUTONOMY_CAPTURE_RUN_ID);
    assert.ok(Number.isSafeInteger(captureId) && captureId > 0);
    const captureRun = await github.api(`/actions/runs/${captureId}`);
    assert.equal(captureRun.id, captureId);
    assert.equal(captureRun.path, captureWorkflow, 'Untrusted UI capture workflow');
    assert.equal(captureRun.name, 'PR UI Evidence');
    assert.equal(captureRun.event, 'workflow_run');
    assert.equal(captureRun.repository.full_name, policy.repository);
    const artifacts = await github.pages(`/actions/runs/${captureId}/artifacts`, 'artifacts');
    const matching = artifacts.filter((artifact) => {
      const match = artifact.name.match(captureArtifactName);
      return !artifact.expired && match && Number(match[4]) === captureRun.run_attempt;
    });
    assert.equal(matching.length, 1, 'Exact separate UI artifact required');
    const captureArtifact = matching[0];
    assert.equal(captureArtifact.workflow_run?.id, captureId);
    const match = captureArtifact.name.match(captureArtifactName);
    const run = await github.api(`/actions/runs/${match[2]}`);
    assert.equal(run.run_attempt, Number(match[3]), 'UI capture belongs to an old source attempt');
    assert.equal(run.head_sha, match[1], 'UI artifact candidate differs from source run');
    if (env.AUTONOMY_RUN_ID) assert.equal(run.id, Number(env.AUTONOMY_RUN_ID));
    return { run, captureRun, captureArtifact };
  }
  const runId = Number(env.AUTONOMY_RUN_ID);
  assert.ok(Number.isSafeInteger(runId) && runId > 0);
  return { run: await github.api(`/actions/runs/${runId}`) };
}

function assertExtensionEntries(plans, requiredEntries) {
  for (const entry of requiredEntries)
    assert.ok(
      plans.some((plan) => plan.surface === 'extension' && plan.entry === entry),
      `Implicit affected extension entry omitted: ${entry}`,
    );
}
export function validateImpactCapturePlans(change, impact) {
  const requiredSurfaces = [
    ...new Set([
      ...(impact.requiredUiSurfaces ?? []),
      ...change.surfaces.filter((surface) => ['web', 'extension'].includes(surface)),
    ]),
  ];
  const planOptions = {
    requiredSurfaces,
    changedPaths: impact.paths,
    requiredPaths: impact.paths.filter((file) => file !== change.capture_plan),
  };
  const capturePlans = validateCapturePlans(change.evidence.screenshots, planOptions);
  assertExtensionEntries(capturePlans, impact.requiredExtensionEntries ?? []);
  return { capturePlans, planOptions };
}

export async function authenticateCapture(
  github,
  {
    captureRun,
    captureArtifact,
    sourceRun,
    sourceArtifact,
    baseSha,
    sourceTrees,
    policy,
    capturePlans,
    changedPaths,
    requiredPaths,
    requiredSurfaces,
    requiredExtensionEntries = [],
  },
) {
  assertExtensionEntries(capturePlans ?? [], requiredExtensionEntries);
  const planHash = capturePlanHash(capturePlans, { requiredSurfaces, changedPaths, requiredPaths });
  assert.equal(captureRun.status, 'completed');
  assert.equal(captureRun.conclusion, 'success', 'Trusted UI capture failed');
  assert.equal(captureRun.path, captureWorkflow);
  assert.equal(captureRun.name, 'PR UI Evidence');
  assert.equal(captureRun.event, 'workflow_run');
  assert.equal(captureRun.repository.full_name, policy.repository);
  assert.ok(shaPattern.test(captureRun.head_sha));
  assert.notEqual(captureRun.id, sourceRun.id);
  assert.equal(captureArtifact.workflow_run?.id, captureRun.id);
  assert.equal(captureArtifact.expired, false);
  assert.equal(
    captureArtifact.name,
    `autonomy-ui-${sourceRun.head_sha}-${sourceRun.id}-${sourceRun.run_attempt}-${captureRun.run_attempt}`,
  );
  assert.ok(captureArtifact.size_in_bytes > 0 && captureArtifact.size_in_bytes <= 200_000_000);
  const [definition, protectedDefinition, ancestry, jobs] = await Promise.all([
    github.content(captureWorkflow, captureRun.head_sha),
    github.content(captureWorkflow, baseSha),
    github.api(`/compare/${captureRun.head_sha}...${baseSha}`),
    github.pages(`/actions/runs/${captureRun.id}/attempts/${captureRun.run_attempt}/jobs`, 'jobs'),
  ]);
  assert.equal(definition, protectedDefinition, 'Capture workflow differs from protected base');
  assert.ok(
    ['ahead', 'identical'].includes(ancestry.status),
    'Capture workflow source is outside protected base history',
  );
  const captureJobs = jobs.filter((job) => job.name === 'capture');
  assert.equal(captureJobs.length, 1, 'Exact capture job required');
  assert.equal(captureJobs[0].conclusion, 'success');
  const fixtureHash = await computeTrustedFixtureHash(sourceTrees.before, (file) =>
    github.content(file, baseSha),
  );
  return {
    fixtureHash,
    planHash,
    controllerSha: baseSha,
    sourceRunId: sourceRun.id,
    sourceRunAttempt: sourceRun.run_attempt,
    captureRunId: captureRun.id,
    captureRunAttempt: captureRun.run_attempt,
    sourceArtifactId: sourceArtifact.id,
    candidateTreeSha: sourceTrees.candidate,
    baseTreeSha: sourceTrees.before,
  };
}

export async function resolveRunPullRequest(github, run, policy) {
  assert.ok(['pull_request', 'merge_group'].includes(run.event));
  assert.ok(shaPattern.test(run.head_sha));
  let candidates = run.pull_requests ?? [];
  assert.ok(Array.isArray(candidates), 'Invalid authenticated PR association');
  if (!candidates.length) candidates = await github.pages(`/commits/${run.head_sha}/pulls`);
  assert.ok(
    candidates.length > 0 && candidates.length <= 20,
    'No bounded authoritative PR association; merge blocked',
  );
  if (run.event === 'merge_group')
    assert.equal(candidates.length, 1, 'Queue requires a single associated PR');
  const current = await Promise.all(
    candidates.map((candidate) => {
      assert.ok(
        Number.isSafeInteger(candidate.number) && candidate.number > 0,
        'Invalid associated PR number',
      );
      return github.api(`/pulls/${candidate.number}`);
    }),
  );
  const eligible = current.filter(
    (pr) =>
      pr.state === 'open' &&
      pr.base?.ref === policy.baseBranch &&
      pr.base?.repo?.full_name === policy.repository &&
      (run.event === 'merge_group' || pr.head?.sha === run.head_sha),
  );
  assert.equal(eligible.length, 1, 'No unambiguous current PR association; merge blocked');
  return eligible[0];
}

export async function orchestrate(env = process.env) {
  const policy = parsePolicy(await readFile('.github/autonomous-maintenance-policy.yml', 'utf8'));
  assert.equal(env.GITHUB_REPOSITORY, policy.repository);
  const github = new GitHub(env.GH_TOKEN, policy.repository);
  const { run, captureRun, captureArtifact } = await resolveAcceptanceRuns(github, env, policy);
  const runId = run.id;
  assert.equal(run.path, policy.ciWorkflow);
  assert.ok(['pull_request', 'merge_group'].includes(run.event));
  assert.ok(shaPattern.test(run.head_sha));
  const associatedPr = await resolveRunPullRequest(github, run, policy);
  await evaluate(associatedPr.number);

  async function evaluate(number) {
    let check;
    let context;
    let result;
    const headSha = run.head_sha;
    try {
      const pr = await github.api(`/pulls/${number}`);
      assert.equal(pr.state, 'open');
      assert.equal(pr.base.ref, policy.baseBranch);
      assert.equal(pr.base.repo.full_name, policy.repository, 'PR base repository changed');
      if (run.event === 'pull_request')
        assert.equal(pr.head.sha, headSha, 'New push invalidated this CI run');
      else {
        assert.ok(
          run.head_branch?.startsWith(`gh-readonly-queue/${policy.baseBranch}/`),
          'Not a merge queue branch',
        );
        const branch = await github.api(`/git/ref/heads/${encodeURIComponent(run.head_branch)}`);
        assert.equal(branch.object.sha, headSha, 'Queue integration was replaced');
        // The integration candidate must contain the current PR head, checked by GitHub ancestry.
        const comparison = await github.api(`/compare/${pr.head.sha}...${headSha}`);
        assert.ok(
          ['ahead', 'identical'].includes(comparison.status),
          'Queue candidate omits current head',
        );
      }
      const checkData = {
        name: 'Autonomy / acceptance',
        head_sha: headSha,
        status: 'in_progress',
        external_id: `${runId}:${run.run_attempt}:${number}:${policy.version}`,
        output: {
          title: 'Independent acceptance in progress',
          summary: 'Validating intent, provenance, actual artifacts and protected policy.',
        },
      };
      check = await github.api('/check-runs', { method: 'POST', body: checkData });
      assert.equal(
        check.app.id,
        policy.acceptanceAppId,
        'Acceptance App identity is not pinned in trusted policy',
      );
      if (run.status !== 'completed') {
        const body = markUiStale(pr.body ?? '', headSha);
        if (body !== pr.body) {
          const current = await github.api(`/pulls/${number}`);
          assert.equal(current.head.sha, pr.head.sha);
          assert.equal(current.body, pr.body, 'PR body changed concurrently');
          await github.api(`/pulls/${number}`, { method: 'PATCH', body: { body } });
        }
        return;
      }
      const [files, jobs, artifacts, commit, currentPolicy, baseCommit] = await Promise.all([
        github.pages(`/pulls/${number}/files`),
        github.pages(`/actions/runs/${runId}/attempts/${run.run_attempt}/jobs`, 'jobs'),
        github.pages(`/actions/runs/${runId}/artifacts`, 'artifacts'),
        github.api(`/git/commits/${headSha}`),
        github.content('.github/autonomous-maintenance-policy.yml', pr.base.sha),
        github.api(`/git/commits/${pr.base.sha}`),
      ]);
      // High-confidence patterns supplement independent semantic data-safety
      // review; a clean scan is not proof that the diff contains no secrets.
      // Block before raw patches enter any external review/publication context.
      const secretFindings = scanDiffSecrets(files);
      if (secretFindings.length) {
        result = {
          decision: 'ESCALATE',
          blockingFindings: secretFindings.map(({ code, location, fingerprint }) => ({
            code,
            location,
            fingerprint,
            reason: `Potential credential material; fingerprint ${fingerprint}. Remove it and rotate any exposed credential before retrying.`,
          })),
          uncertainties: [],
        };
        throw new Error('Potential credential material requires independent remediation');
      }
      assert.equal(
        parsePolicy(currentPolicy).version,
        policy.version,
        'Trusted policy snapshot differs from current base',
      );
      const [candidateWorkflow, baseWorkflow] = await Promise.all([
        github.content(policy.ciWorkflow, run.head_sha),
        github.content(policy.ciWorkflow, pr.base.sha),
      ]);
      assert.ok(
        candidateWorkflow === baseWorkflow,
        `Candidate CI workflow differs from protected base; rebase onto current ${policy.baseBranch} and rerun PR Quality.`,
      );
      const trustedCheckout = execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim();
      assert.equal(
        trustedCheckout,
        pr.base.sha,
        'Trusted dependency graph snapshot differs from current base; rerun acceptance',
      );
      const impact = classifyImpact(files, policy, model, await loadImpactGraph());
      if (impact.risk !== 'normal') {
        result = {
          decision: 'ESCALATE',
          blockingFindings: [
            {
              code: 'PROTECTED_OR_ELEVATED_SCOPE',
              location: impact.protectedFiles.concat(impact.elevatedFiles).join(', ') || 'diff',
              reason:
                'Approval outside this change is required. Automatic merge is disabled for this scope.',
            },
          ],
          uncertainties: [],
        };
        throw new Error('Protected/elevated scope requires independent maintainer approval');
      }
      const change = await resolveIntent(pr.body, (file) => github.content(file, headSha));
      validateChange(change, impact, model);
      const job = jobs.find((item) => item.name === policy.ciJob);
      assert.ok(job, 'Required CI job missing');
      const matching = artifacts.filter(
        (item) => item.name === `autonomy-evidence-${headSha}-${run.run_attempt}` && !item.expired,
      );
      assert.equal(matching.length, 1, 'Missing or ambiguous immutable evidence artifact');
      const artifact = matching[0];
      assert.ok(artifact.size_in_bytes <= 200_000_000);
      const readArtifact = await readArchive(await github.artifact(artifact.id));
      const manifest = boundedJSON(readArtifact('reports/autonomy/evidence.json').toString('utf8'));
      const verified = verifyEvidence(
        manifest,
        {
          run,
          job,
          artifact,
          commit,
          policy,
          repo: policy.repository,
          pr: run.event === 'merge_group' ? 0 : number,
          headSha,
          trustedModel: model,
        },
        readArtifact,
      );
      // UI manifests are validated by the trusted screenshot implementation, never candidate code.
      let ui = { applicable: false, reason: impact.reason };
      if (impact.ui) {
        const { capturePlans, planOptions } = validateImpactCapturePlans(change, impact);
        if (!captureRun) {
          await github.api(`/check-runs/${check.id}`, {
            method: 'PATCH',
            body: {
              status: 'in_progress',
              output: {
                title: 'Awaiting trusted UI capture',
                summary:
                  'PR UI Evidence completion will re-evaluate this exact PR Quality run; candidate screenshots are not accepted.',
              },
            },
          });
          return;
        }
        const sourceTrees = { before: baseCommit.tree.sha, candidate: commit.tree.sha };
        const trustedCapture = await authenticateCapture(github, {
          captureRun,
          captureArtifact,
          sourceRun: run,
          sourceArtifact: artifact,
          baseSha: pr.base.sha,
          sourceTrees,
          policy,
          capturePlans,
          requiredExtensionEntries: impact.requiredExtensionEntries,
          ...planOptions,
        });
        const readCaptureArtifact = await readArchive(await github.artifact(captureArtifact.id));
        const captureManifest = boundedJSON(
          readCaptureArtifact('reports/autonomy/screenshots/manifest.json').toString('utf8'),
        );
        assert.equal(
          captureManifest.planHash,
          trustedCapture.planHash,
          'Captured plan hash differs from authenticated intent',
        );
        assert.equal(
          capturePlanHash(captureManifest.plans, planOptions),
          trustedCapture.planHash,
          'Captured plan data differs from authenticated intent',
        );
        const { validateUiEvidence } = await import('./ui-evidence.mjs');
        ui = await validateUiEvidence({
          readArtifact: readCaptureArtifact,
          github,
          pr,
          headSha,
          baseSha: pr.base.sha,
          policy,
          env,
          ...planOptions,
          capturePlans,
          runUrl: captureRun.html_url,
          sourceTrees,
          trustedCapture,
        });
      }
      const performanceBaseline =
        change.type === 'perf'
          ? boundedJSON(await readFile('tools/assurance/baseline.json', 'utf8'))
          : undefined;
      // Published captions must not introduce or change human-authored intent fields.
      const publishedIntent = await resolveIntent(pr.body, (file) => github.content(file, headSha));
      assert.equal(digest(publishedIntent), digest(change), 'UI publication changed the PR intent');
      context = {
        repository: policy.repository,
        pr: number,
        headSha,
        prHeadSha: pr.head.sha,
        baseSha: pr.base.sha,
        policyVersion: policy.version,
        policySnapshot: policy,
        ciDefinitionHash: digest(candidateWorkflow),
        assuranceModel: model,
        ...(performanceBaseline
          ? {
              performanceBaseline: {
                path: 'tools/assurance/baseline.json',
                documentHash: digest(performanceBaseline),
                document: performanceBaseline,
              },
            }
          : {}),
        change,
        impact,
        body: pr.body,
        diff: files,
        evidenceExpiresAt: new Date(
          Date.parse(run.updated_at) + policy.maxEvidenceAgeHours * 3600000,
        ).toISOString(),
        evidenceDigest: verified.digest,
        evidence: manifest,
        audit: verified.audit,
        ui,
        run: { id: runId, attempt: run.run_attempt, artifactId: artifact.id, url: run.html_url },
        instructionsVersion: 1,
      };
      const comments = await github.pages(`/issues/${number}/comments`);
      const previous = comments.find(
        (item) => item.user?.login === env.AUTONOMY_BOT_LOGIN && item.body.startsWith(marker),
      );
      const history = previous?.body.match(contextsMarker)?.[1].split(',') ?? [];
      const contextHash = digest(context);
      assert.ok(
        history.includes(contextHash) || history.length < policy.maxReviewCycles,
        'Review cycle limit reached; escalate to maintainer',
      );
      const answer = await requestDecision(context, {
        endpoint: env.DOTS_ENDPOINT,
        token: env.DOTS_TOKEN,
        publicKey: env.DOTS_PUBLIC_KEY,
        policy,
      });
      result = answer.decision;
      await mkdir('reports/autonomy', { recursive: true });
      await writeFile(
        `reports/autonomy/decision-${number}.json`,
        JSON.stringify(answer.envelope, null, 2),
      );
      // Diagnostic only: retain the signed decision and original evidence/attempts.
      // This packet does not replace any authorization or freshness gate below.
      const reviewPacket = createReviewPacket({ ...context, decision: result });
      await writeFile(
        `reports/autonomy/review-packet-${number}.json`,
        `${JSON.stringify(reviewPacket, null, 2)}\n`,
      );
      await writeFile(
        `reports/autonomy/review-packet-${number}.md`,
        renderReviewPacket(reviewPacket),
      );
      // Re-read immediately before publishing authority. A new head/base revokes this result.
      const fresh = await github.api(`/pulls/${number}`);
      assert.equal(fresh.head.sha, context.prHeadSha, 'Head changed during acceptance');
      assert.equal(fresh.base.sha, context.baseSha, 'Base changed during acceptance');
      assert.equal(fresh.body, context.body, 'PR body changed during acceptance');
      if (run.event === 'merge_group') {
        const queue = await github.api(`/git/ref/heads/${encodeURIComponent(run.head_branch)}`);
        assert.equal(queue.object.sha, headSha, 'Queue integration changed during acceptance');
      }
      assert.equal(
        parsePolicy(
          await github.content('.github/autonomous-maintenance-policy.yml', fresh.base.sha),
        ).version,
        policy.version,
      );
      await feedback(number, result, [...new Set([...history, contextHash])], previous);
      if (result.decision !== 'ACCEPT') {
        await github.api(`/check-runs/${check.id}`, {
          method: 'PATCH',
          body: {
            status: 'completed',
            conclusion: 'failure',
            output: { title: result.decision, summary: report(result) },
          },
        });
        return;
      }
      const [protection, ruleSummaries, checks] = await Promise.all([
        github.api(`/branches/${encodeURIComponent(policy.baseBranch)}/protection`),
        github.api(`/rules/branches/${encodeURIComponent(policy.baseBranch)}`),
        github.pages(`/commits/${headSha}/check-runs`, 'check_runs'),
      ]);
      const rulesets = [{ enforcement: 'active', rules: ruleSummaries }];
      await publishAcceptance({
        github,
        number,
        check,
        context,
        decision: result,
        policy,
        run,
        protection,
        rulesets,
        checks,
        summary: report(result),
      });
      if (run.event === 'pull_request')
        execFileSync(
          'gh',
          [
            'pr',
            'merge',
            String(number),
            '--repo',
            policy.repository,
            '--auto',
            '--squash',
            '--match-head-commit',
            context.prHeadSha,
            '--subject',
            `${change.type}${change.breaking ? '!' : ''}: ${change.summary.replace(whitespace, ' ').slice(0, 120)}`,
            '--body',
            `${change.release_note}${change.breaking ? `\n\nBREAKING CHANGE: ${change.user_impact}` : ''}`,
          ],
          { stdio: 'pipe', timeout: 30000, env },
        );
    } catch (error) {
      const failure =
        result?.decision !== 'ACCEPT' && result
          ? result
          : {
              decision: 'REVISE',
              blockingFindings: [
                { code: 'ACCEPTANCE_BLOCKED', location: 'automation', reason: error.message },
              ],
              uncertainties: [],
            };
      if (check)
        await github.api(`/check-runs/${check.id}`, {
          method: 'PATCH',
          body: {
            status: 'completed',
            conclusion: 'failure',
            output: { title: failure.decision, summary: report(failure) },
          },
        });
      await feedback(number, failure, context ? [digest(context)] : []);
      process.exitCode = 1;
    }
  }
  function report(decision) {
    return `${decision.decision}\n\n${decision.blockingFindings.map((item) => `- ${item.code} (${item.location}): ${item.reason}`).join('\n')}\n\nPush a revision or rerun the trusted acceptance workflow after resolving configuration/evidence failures.`.slice(
      0,
      60000,
    );
  }
  async function feedback(number, decision, contexts, existing) {
    assert.ok(env.AUTONOMY_BOT_LOGIN, 'Trusted bot login missing');
    const comments = existing ? [] : await github.pages(`/issues/${number}/comments`);
    const previous =
      existing ??
      comments.find(
        (item) => item.user?.login === env.AUTONOMY_BOT_LOGIN && item.body.startsWith(marker),
      );
    const prior = previous?.body.match(contextsMarker)?.[1].split(',') ?? [];
    const history = [...new Set([...prior, ...contexts])].slice(0, policy.maxReviewCycles);
    const body = `${marker}\n${report(decision)}\n\n<!-- contexts:${history.join(',')} -->`;
    if (previous?.body === body) return;
    await github.api(previous ? `/issues/comments/${previous.id}` : `/issues/${number}/comments`, {
      method: previous ? 'PATCH' : 'POST',
      body: { body },
    });
  }
}
