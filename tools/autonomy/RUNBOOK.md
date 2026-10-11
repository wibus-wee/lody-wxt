# Operating assistant review

## Responsibilities

The connected assistant observes PR events, personally reviews changes and evidence, and merges an accepted exact revision through its existing GitHub connection.
The repository does not implement or deploy a Dots service.
No new acceptance App, reviewer credential or signing material is required.
CI prepares verifiable inputs; it cannot make a semantic acceptance decision.

The owner configures the assistant subscription for new/ready/updated PRs.
The assistant follows each current CI run to completion and revisits new heads.
Repository workflows alone do not create that subscription.
Do not interpret missing events or unobserved CI completion as successful acceptance.

## Workflow migration

- Keep PR Quality and PR UI Evidence.
  They produce real journeys, builds, traces, screenshot manifests and hashed artifacts with read-only tokens.
- Replace Independent Acceptance with PR Review Context, a read-only preparation job.
  It checks out its own protected workflow SHA, installs no candidate dependencies, and writes only diagnostic artifacts with a PENDING decision.
- Remove acceptance revocation and merge-recheck workflows: there is no persistent synthetic acceptance check to expire or revoke.
- Do not manually mark old acceptance checks green.
  If a remote required check still names the removed acceptance service, obtain owner approval to migrate that exact branch rule.
  This change does not mutate repository settings.
- Keep the existing strict GitHub protection, required PR Quality identity, code-owner approval and no-force-push controls. `pnpm autonomy:preflight` only inspects them.
  A denied API means unknown configuration.
- Existing release-promotion/publication controls and release credentials are untouched.
  A release proposal is not an ordinary runtime PR and must follow [RELEASE.md](./RELEASE.md).

## Preserved runtime and evidence fixes

Node-only initialization sets `package-manager-cache: false`; jobs that explicitly cache pnpm install it first.
CI keeps separate runs per commit instead of cancelling earlier evidence.
`ASSURANCE_FAIL_FAST=1` stops later performance repetitions after a real web failure and stops the extension suite after its first failure; failures, skipped coverage and incomplete samples still block acceptance.
Successful runs retain the complete journey and five-sample requirements.
UI capture uses the real wall clock for installed extension pages because their RPC deadlines are checked by the service worker.
Web captures retain their controlled clock.
Failed matrix entries retain their identity, screenshot and trace when available, and still fail the run without producing a completed manifest.
Runeicons clone remains explicitly denied; do not bypass that denial or replace missing generated icons.

## Each review

Read the PR template and actual complete diff; labels and claimed scope cannot waive affected journeys.
Check renames, implicit state owners and production entrypoints.
`fix` needs a reproducer and a regression-detecting probe; `feat` needs user journeys and failure paths; `perf` needs comparable environments, a real baseline, at least five valid samples and independent review.
A setup failure is not a mutation kill.
Plain documentation changes explain why browser/UI evidence is inapplicable.
Executable MDX and build hooks are not plain documentation.

Read the original successful run/job for the exact head and attempt.
Authenticate artifact association, policy/model/source hashes and every referenced report byte.
Preserve original failed attempts; skipped or incomplete obligations are not passing coverage.
Review Context can prepare these inputs with `node tools/autonomy/cli.mjs review`, using the current authorized read-only connection and exact `AUTONOMY_RUN_ID` plus applicable `AUTONOMY_CAPTURE_RUN_ID`.
It never sends PR data to an external reviewer or writes remote state.
Protected/elevated changes can legitimately return a blocked packet; the assistant still reads original evidence and obtains the needed independent owner approval.
Do not forge a normal-risk decision.

Personally inspect the actual images and raw traces.
Compare screenshot bytes against the authenticated capture manifest, base/head, capture plan, viewport/theme matrix and affected web/installed-extension states.
Keep PNGs in artifacts, not Git.
Publish verified images inline in the PR body using an existing authorized connection, preserve the author's content and read back/hash the published bytes. `github-attachments.mjs` remains an optional explicit CLI adapter; it takes an already authorized token from its caller, never a new CI secret or candidate input.
Feature-check attachment support and fail closed if unavailable.
Do not silently substitute an artifact link for inspected/published UI evidence.
Native browser chrome, permission dialogs and animation perception may need direct inspection beyond captured extension documents.

Record reasoning, blockers, evidence links and the exact reviewed commit.
A review JSON is a diagnostic record, not proof of identity or authority.
Immediately before merge, recheck PR state, source/base/body/policy, latest required checks and unresolved review findings.
Use the expected-head guard and GitHub protection.
Do not leave an accepted PR armed for later unreviewed auto-merge.

## Recovery and limits

Failed CI: inspect original logs/artifacts and repair through an authorized change.
Do not loosen assertions, relabel, fabricate icons or discard failing attempts.
Missing UI: repair capture inputs, then obtain fresh matching evidence.
Verify partial attachment uploads before retrying.
New head/base/body/policy: discard the previous review and re-evaluate.
Repeated unchanged blockers do not need repeated messages.
A read-only preparation job failing does not mean a dedicated reviewer service should be installed.

`pnpm test:autonomy` verifies tooling, not product correctness or remote protection enforcement.
Complete `pnpm check` and applicable real browser/extension journeys before reporting a full pass.
Preserve unavailable prerequisites as blockers.
The historical [validation record](./VALIDATION.md) is evidence about those runs only, not current environment state.
Never assume temporary files, sessions or credentials persist across environments.
