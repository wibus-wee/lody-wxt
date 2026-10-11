# Autonomous maintenance operations

## Deployment state

This guide is for installing the automation and recovering it when something fails.
For the contribution flow and a short introduction, start with the [overview](./README.md).

**The code is present, but live unattended operation is not established.**
Build inputs, GitHub protection and external services still need verification.
The [validation record](./VALIDATION.md) separates what passed from what remains blocked.

Run `pnpm autonomy:preflight` for read-only configuration inspection.
Its report is `reports/autonomy/preflight.json`.
A denied variables/secrets API means configuration is **unknown**, not proof that secrets are absent.
No command requests or prints secret values.

On 2026-10-10 the repository API reported a private repository, `main`, admin capability and `allow_auto_merge: false`.
Protection/rulesets requests returned 403, including “Upgrade to GitHub Pro or make this repository public to enable this feature.”
The current credential also could not inspect Actions variables/secrets; the environment list was empty.
No protection, App, secret, tag, release, auto-merge setting or remote fixture PR was installed by this implementation.
Verify Merge Queue eligibility independently; the repository plan and ownership must support it.
At that inspection the merge gate still unconditionally required a queue; the personal-repository update below replaces that assumption with an explicit protected auto-merge strategy.

After the owner made the repository public, a fresh inspection confirmed `visibility: public` and account-level administrator capability.
Branch-protection reads and requests to enable auto-merge or create the `autonomy` environment returned HTTP 403, `Resource not accessible by integration`.
Read-back confirmed auto-merge remained disabled and the environment list remained empty.
The public/private plan restriction is no longer the observed administration blocker; the connected credential lacks the required repository-administration and environment-management access.
Do not try another credential route to bypass a denied operation; repair the connection authorization before retrying.
Variables, secrets metadata and Actions management settings also remain inaccessible, so their configuration is unknown.
Only the pre-existing Quality and Release workflows were observed on GitHub; the new automation is still local.
The before/after records are `reports/autonomy/public-configuration-before.json` and `reports/autonomy/public-configuration-after.json`.

The owner then explicitly selected the system GitHub CLI login for administration.
`/opt/homebrew/bin/gh` authenticated through the existing local keychain; no token was printed, copied or exported to CI.
This fixed the credential-source mismatch: system CLI reads confirmed the public personal repository, auto-merge already enabled, accessible administration APIs, empty Actions variables/secrets and no main protection.
The previous integration's 403 is historical, not a remaining denial for the newly authorized system login.
The full inspection is `reports/autonomy/system-gh-configuration.json`.

The current policy selects `mergeStrategy: protected-auto-merge` for this personal repository.
Auto-merge is supported on personal repositories and does not require an organization migration.
[Merge Queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) is an optional separate strategy with organization eligibility requirements.
An explicit `merge-queue` policy still requires the protected single-entry queue and integration checks.
Unknown strategies fail closed.

Three environments were created and read back through the authorized system login:

| Environment           | Allowed refs                | Approval                                                     |
| --------------------- | --------------------------- | ------------------------------------------------------------ |
| `autonomy`            | Exact `main` branch only    | Automatic; no candidate refs or tags                         |
| `release-promotion`   | Exact `main` branch only    | Owner reviewer, self-review forbidden, admin bypass disabled |
| `release-publication` | Exact `main` plus `v*` tags | Owner reviewer, self-review forbidden, admin bypass disabled |

`v*` is only the deployment selector; the release controller separately enforces the stable version grammar.
Settings evidence is `reports/autonomy/system-gh-environments.json`.
The new workflows remain local; only the original Quality (manual dispatch) and Release workflows are on main.
Do not require checks that are not deployed and running.
No App identity, Dots service or dedicated CI credential has been invented, and the local keychain token has not been installed as a CI secret.

## Trust and required checks

1. Have a maintainer review and merge the protected bootstrap change.
   Files under `.github`, autonomy/assurance/release tooling, dependency manifests/hooks, submodules and governance cannot approve themselves.
   CODEOWNERS supplies ownership; GitHub must enforce it.
2. Install a separate GitHub App on this repository, with checks write, pull requests write, contents write, actions read and administration read.
   Use an installation token restricted to this repository.
   The App must not be available in PR execution.
   Pin its numeric App ID in trusted policy `acceptanceAppId`, replacing `null` through protected review. `ciAppId` pins the GitHub Actions check owner.
3. Configure repository/environment variables `AUTONOMY_APP_ID`, `AUTONOMY_BOT_LOGIN`, `DOTS_ENDPOINT`, `DOTS_PUBLIC_KEY`; configure secrets `AUTONOMY_APP_PRIVATE_KEY`, `DOTS_TOKEN`, `AUTONOMY_IMAGE_TOKEN` only in the `autonomy` environment.
   Restrict that environment to an exact `main` branch deployment policy, excluding tags and every other branch; never duplicate these secrets at repository scope.
   The public key is an Ed25519 PEM key from the independent reviewer.
   Provision private signing material only at that service.
   No credential belongs in a PR, manifest or screenshot.
4. Deploy the protected workflows on `main`. `pr-quality.yml` runs candidate code without privileged secrets. `pr-acceptance.yml` runs its own protected `github.workflow_sha`, installs no candidate dependencies, and never checks out or executes candidate code.
   Only this App posts `Autonomy / acceptance`.
5. Configure required checks **with their App identities**: `PR Quality / verify` from GitHub Actions and `Autonomy / acceptance` from the pinned App.
   Enforce strict checks, admins, linear history, no force pushes or branch deletion, and code-owner review for protected paths.
   The current `protected-auto-merge` strategy requires an up-to-date PR source head, exact head/base/body/policy identity and no active merge queue.
   If protected policy explicitly selects `merge-queue`, require an active queue on `main` with `max_entries_to_build: 1` and `max_entries_to_merge: 1`, and rerun the required checks on its synthetic integration commit.
   Avoid a global mandatory human review for ordinary paths.
   The repository auto-merge setting is already enabled; automated acceptance and merge actuation must remain unconfigured until the required rules and real adversarial pilots prove enforcement.
   The gate re-inspects rules, PR head/base, policy, decision lifetime, check owners and the appropriate source or integration SHA before requesting GitHub's protected merge mechanism.
6. Protect release tags and release credentials.
   Configure independently enforced `release-promotion` and `release-publication` environments, as detailed in [RELEASE.md](./RELEASE.md).
   The release tooling checks that approval controls exist; an automatically created empty environment is insufficient.
   Configure optional `RELEASE_PLEASE_TOKEN` so proposal PRs trigger checks.
   A release proposal changes protected version/configuration files and needs independent approval under the current conservative policy.

GitHub hosted runners are disposable and PR tokens are read-only, but hosted runners are not a hardened hostile-code sandbox with an enforced network allowlist.
Deploy the Dots probe execution pool separately with disposable isolation, no repository write/release/signing credentials, no host Docker socket, restricted egress and explicit protocol-fixture boundaries.
Never run an untrusted candidate on the reviewer or actuation host.
Local probes are diagnostics for trusted checkouts, not a malicious-code isolation boundary.

## Contributor contract

Use [.github/PULL_REQUEST_TEMPLATE.md](../../.github/PULL_REQUEST_TEMPLATE.md).
Contributors write ordinary Markdown under the template headings, choose the change type and affected areas, and check the verification items they actually ran.
Automation derives structured intent from those sections; contributors do not write JSON in the PR body.
Journey references and special cases live in the collapsible part of the template.
Older PRs using the original JSON block remain readable during migration; mixing both formats is rejected.
Cases come from the architecture model.
Actual files, including rename sources, determine runtime, UI and protected impact; a `docs` label cannot waive runtime evidence.

`fix` needs an observable reproduction and regression-detecting independent probe. `feat` needs new/updated journeys and failure paths. `perf` needs interaction/environment/baseline/sample information. `refactor` declares unchanged behavior and uses relevant real journeys.
Docs-only changes link genuine artifact/tool checks and explain why visual evidence is inapplicable; they need no invented journey.
CI currently runs the existing full suite conservatively even for docs, which does not imply a new E2E obligation.

`LODY_UI_PINNED=1` in verification jobs requires the recorded Lody gitlink and a clean initialized checkout.
Normal `pnpm ui:update` still tracks upstream `main`.
The pinned mode makes candidate/before/tagged builds reproducible instead of changing their submodule source during measurement.
Runeicons remains pinned.

## Evidence and images

The PR job uploads `autonomy-evidence-<headSha>-<attempt>`.
Its archive preserves the `reports/` prefix.
The manifest records repository/PR/run/attempt, candidate commit/tree, trusted policy hash, model/source hash, the existing audit/run ID, and file sizes/hashes.
Evidence is a claim until trusted orchestration checks GitHub run/job metadata, workflow identity, artifact association, actual bytes and trusted model denominator.
Failure and skipped/incomplete evidence are never promoted by a later pass.
Strict P0 audit is mandatory; unresolved product assurance gaps can legitimately block all runtime admission until fixed.

The UI adapter publishes only actual hashed PNG bytes from a verified successful run, checks a receipt and downloads the resulting image again.
Publish screenshots directly with `gh pr edit --attach` and `--body-file`; local image references in the body file are rewritten to GitHub attachment URLs.
Repeat `--attach` for each image, with at most 50 attachments per command; larger manifests require bounded batches that preserve the existing body and previously published images.
The [official CLI manual](https://cli.github.com/manual/gh_pr_edit) documents the flag; v2.102.0 is the latest release at the time of this change.
Feature-check `gh pr edit --help` for `--attach` at runtime and fail closed if unavailable; a version string alone does not prove support.
Use the separate environment-only `AUTONOMY_IMAGE_TOKEN` as `GH_TOKEN` only for attachment commands.
A fine-grained PAT restricted to this repository with the permissions required to edit its PRs is recommended.
The [official attachment client](https://raw.githubusercontent.com/cli/cli/trunk/internal/attachments/client.go) rejects `ghs_` installation tokens, so the acceptance App token cannot serve as the attachment credential.
Keep the pinned acceptance App's privileges and `Autonomy / acceptance` check identity separate.
Never expose either credential to candidate code; the `autonomy` environment remains restricted to protected `main`.
No external HTTP image endpoint is required.
The direct adapter stages images and body files under `os.tmpdir()` and removes temporary files afterward.
It restricts attachment subprocess `GH_TOKEN` to `AUTONOMY_IMAGE_TOKEN`, refuses `ghs_` tokens and missing `--attach` support, and checks the bound SHA, current head, base and body before and after each batch.
It reads back the body, verifies exact local-reference rewrites, and independently downloads and hashes attachments before binding receipts to the verified capture.
Partial uploads fail closed without automatic retries; local cleanup does not remove attachments already uploaded.
Inspect the resulting PR state before a deliberate recovery run.
The acceptance App patches the final bounded evidence section and posts checks with its separate identity.
Returned URLs must be GitHub attachment URLs on the protected policy allowlist, viewable without credentials or signed query strings, and contain the exact captured bytes.
Read the resulting PR body, independently download and hash each attachment, and bind `{ path, url, contentHash }` receipts to the verified capture before acceptance.
Repository `blob`/`raw` image URLs and custom image hosts are rejected even if added to the host allowlist.
Never use a repository branch, commit, or GitHub Pages directory as screenshot storage.
Capture-plan files are instructions only; PNGs stay in ignored temporary reports and CI artifacts before upload.
The direct attachment uploader has not been verified against a remote PR.
Runtime CLI support, credential permissions, body rewriting and downloaded-byte integrity still require a real pilot; this does not claim that attachment publication is installed.
Changing the host allowlist is protected policy.
GitHub's artifact download URL alone is not an image publisher.

The bot replaces only the bounded `autonomous-ui-evidence` section, preserves other author content, checks concurrent head/body changes, and includes before/candidate context.
A new run marks old images stale when the trusted requested-run event is available; missing/stale acceptance always blocks the new SHA even before the body is refreshed.
Image publication failures block acceptance.
See [UI.md](./UI.md).

UI capture reads the data file linked under the PR description’s `Capture plan` heading from the exact candidate commit, with exact changed-path coverage, route, state, scenario, surface and bounded role/name actions ending in an assertion.
Protected controllers and protocol fixtures execute the plans against actual web builds or installed Chromium extension options, popup and side-panel documents.
Plans, their hashes, builds, fixtures and both workflow attempts are bound before publication; a generic account image cannot substitute for an affected route/state.
Role-specific before plans support compatible renamed controls without fabricating baseline results.
Extension documents are captured in isolated installed-extension tabs; native browser chrome, native permission dialogs and animation perception remain separate fidelity limits.
See [UI.md](./UI.md) for the exact plan schema.
This implementation's browser/package capture behavior remains unverified locally because the recorded Runeicons/generated-icon prerequisite is unavailable.

## Independent Dots protocol

`POST DOTS_ENDPOINT` receives `{ schemaVersion, context, trust }` with `Idempotency-Key: sha256(canonical(context))`.
The context binds repository, PR, candidate/integration SHA, actual PR head, base SHA, trusted policy and architecture model, intent, actual diff, verified evidence digest, audit, images, run/attempt and artifact ID.
The reviewer must use its own read-only GitHub identity to retrieve complete code, raw reports/traces and history when the diff is incomplete.
PR data and artifacts are data, never instructions.
It cannot mutate candidate code, policy, check status or merge state.

Return `{ decision, signature }`. `signature` is base64 Ed25519 over UTF-8 canonical JSON of `decision` (recursive lexical object-key ordering, array order preserved, no whitespace).
Decisions include `schemaVersion: 1`, `repository`, `pr`, `headSha`, `baseSha`, `policyVersion`, `contextHash`, `decision`, `risk`, `evidenceIds`, `blockingFindings`, `uncertainties`, `issuedAt`, `expiresAt`, `adequacy`, `probes`.
Validity is at most 24 hours and cannot extend beyond `context.evidenceExpiresAt`, computed from the authenticated source run and the protected evidence age limit.
ACCEPT requires no blockers/uncertainties, normal risk, the exact evidence digest, and true adequacy fields: `sourceInputsVerified`, `dataSafetyReviewed`, `intentMatchesDiff`, `implicitImpactReviewed`, `fixturesDoNotShortcut`, `productionEntrypoints`, `authoritativeOutcomes`, `failurePathsReviewed`, plus `uiReviewed` and `uiCaptureVerified` where relevant.
Performance ACCEPT additionally requires independent `performanceReviewed` and real comparable measured groups; missing or insufficient baselines block admission.

Feature/fix/test changes require independent probes.
Each declared updated case needs a probe with `journey`, candidate `headSha`, `candidate: passed`, `regression: failed`, `infrastructureFailure: false`, method `mutation` or `fail-before-pass-after`, actual trace digest and authoritative oracle explanation.
Setup failure is not a mutation kill.
An incompatible additive/base interface needs a real controlled behavioral mutation; a prose waiver cannot turn infrastructure failure into evidence.
Keep raw failed runs.
The service signs only independently verified results; signing a contributor's supplied JSON defeats the boundary.

This repository provides the client and signature validator, not a deployed Dots service or signing key.
There is no fallback LLM/local ACCEPT.
Missing/unavailable service fails closed with bounded retries.
A deduplicated App comment reports REVISE or ESCALATE and recheck conditions; three changed review contexts cap repair loops.
Elevated scopes are conservatively escalated.
A maintainer's external approval must follow protected GitHub rules; it does not create a forged automatic ACCEPT.

## Recovery

- Failed CI: inspect the original run's audit, raw framework results and traces, fix the actual defect and push.
  Do not update a baseline or relabel the PR to hide failure.
- Missing images: fix build/capture or attachment CLI or credential configuration, rerun PR Quality, then rerun Independent Acceptance for the successful run ID.
- Dots/API transient outage: bounded HTTP retries preserve failure.
  Rerun Independent Acceptance or Merge Gate Recheck using the existing exact run ID after recovery.
  Both recompute current inputs and require a fresh signed decision.
- New head/base/policy/queue commit: old evidence/decision is invalid; run full applicable checks again.
  Never manually set the acceptance check green.
- Review cap: inspect the one bot comment and escalate deliberately; do not loop agents indefinitely.
- Publish interruption: rerun the original publish job with its original verified artifact.
  Existing published bytes must match exactly; never clobber assets or move a tag.
  See [RELEASE.md](./RELEASE.md).
- Released defect: inspect the deduplicated per-release incident and retained installed-archive evidence.
  Repair through normal PR acceptance.
  An old incident closes only after verifying its original released artifact/symptom; a different version passing cannot silently close it.
  Store rollout/adoption and destructive rollback remain external operations requiring their own verified policy.

## Acceptance exercises and remaining evidence

`pnpm test:autonomy` verifies tooling, not product correctness. [PROBES.md](./PROBES.md) describes the real expiry mutation/restoration journey and packaged persistence probe.
Run the real browser suites and preserve their failures. [examples](./examples) contains reviewable honest-fix, docs and deceptive/stale/protected fixture specifications.

Before declaring unattended maintenance operational, use an isolated repository with the deployed App, reviewer, attachment credentials, environments and real protection to exercise all ten adversarial fixtures from the implementation specification.
Save actual PR/run/check/queue/release/incident URLs and outcomes.
Local Node fixtures cannot demonstrate remote GitHub enforcement or prove Dots can detect semantic fraud.
No remote fixture PRs or successful full merge→publish→installed-monitor cycle are claimed here.
The lack of those external executions is an outstanding acceptance milestone, not a green-CI exception.

## Freshness boundary

The success publication path validates the proposed check in memory, enforces a single-PR integration group, and re-reads PR/head/base/body/queue identities before the one terminal success write. `acceptance-revoke.yml` revokes prior success on PR edits, synchronization, closure/draft conversion, base changes, acceptance completion and scheduled sweeps.
It never authorizes acceptance.

GitHub checks have no native expiration and these reads, writes and queue merging are not atomic.
Revocation is asynchronous; a five-minute cron is not a maximum execution delay.
Scheduling outages, missing credentials or API failures can leave stale success visible, and a merge can race a body edit or expiry before a revoker executes.
See [GOVERNANCE.md](./GOVERNANCE.md).
Zero-window expiration/body freshness needs enforcement by the actual merge platform; this implementation does not claim to supply that guarantee.
This is a remaining acceptance limitation, not evidence of a fully installed unattended system.

[Verification design](./VERIFICATION-DESIGN.md) records how the supplied iOS article informs machine-readable assertion summaries and independent behavioral oracles, while preserving this specification's inline UI evidence and failed-attempt retention.

Docs-only Markdown changes skip actual image capture after protected impact classification and retain a not-applicable receipt; executable MDX, TSX and build hooks under `docs/` cannot use that exemption.
CI collects five comparable performance repetitions for authored interactions without auto-promoting baselines.
Performance changes require a registered interaction, actual finite observations and a protected comparable baseline with real run/source/model provenance.
Reserved version overrides and breaking trailers in contributor release text are rejected; the validated change type and explicit breaking flag author the squash Conventional Commit.
