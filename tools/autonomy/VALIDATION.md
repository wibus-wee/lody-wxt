# Implementation validation — 2026-10-10

The implementation is in the `autonomous-maintenance` worktree branch.
Local tooling validation is not remote GitHub enforcement or product acceptance.
The original local-validation snapshot installed no protected configuration, GitHub App, Dots service, durable image host, remote fixture PR, tag or release.
Later sections record the owner's switch to the system GitHub CLI, verified auto-merge setting and the three environments actually created; those settings do not establish full unattended readiness.

| Check                                  | Observed result                                                                                                                                                          | Evidence                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `pnpm test:autonomy`                   | 83 tooling tests passed; zero failures/skips                                                                                                                             | `reports/autonomy/final-autonomy.log`         |
| `pnpm check`                           | Autonomy, assurance-tool and release-tool tests passed; SDK typecheck and WXT preparation completed; application TypeScript failed on two missing generated-icon imports | `reports/autonomy/final-check.log`            |
| `pnpm lint`                            | Passed with seven warnings in unchanged application files                                                                                                                | `reports/autonomy/final-lint.log`             |
| `pnpm format:check`                    | Passed                                                                                                                                                                   | `reports/autonomy/final-format.log`           |
| `actionlint`                           | Passed for all repository workflows                                                                                                                                      | `reports/autonomy/final-workflows.log`        |
| `git diff --check`                     | Passed                                                                                                                                                                   | `reports/autonomy/final-diff.log`             |
| Lockfile preservation                  | `git diff --exit-code -- pnpm-lock.yaml` passed                                                                                                                          | `reports/autonomy/final-lockfile.log`         |
| `pnpm knip`                            | Failed: missing generated-icon imports; unused `react-hook-form`; unused `exportConversation` and `searchConversations` exports in unchanged application code            | `reports/autonomy/final-knip.log`             |
| `pnpm test:browser`                    | Chromium ran 156 infrastructure tests successfully; two suites failed to import, so the command failed overall                                                           | `reports/autonomy/local-browser.log`          |
| `LODY_UI_PINNED=1 pnpm test:extension` | Failed during preparation because Runeicons is missing; no packaged journey pass established                                                                             | `reports/autonomy/local-extension-pinned.log` |
| `LODY_UI_PINNED=1 pnpm test:assurance` | Failed before complete real journey execution because the pinned glyph source is unavailable                                                                             | `reports/autonomy/local-assurance-pinned.log` |
| `pnpm autonomy:preflight`              | Failed closed; external configuration and protected deployment are not established                                                                                       | `reports/autonomy/preflight.json`             |

A late historical delegated report also describes an earlier failed browser run: 59 tests passed, six suites failed to import, and one iframe timeout occurred.
That timeout remains unexplained; the later 156-test result does not establish that it was fixed.
The report is retained separately at `reports/autonomy/historical-browser-report.txt`.
Its original run identity and raw framework logs have not been recovered, so it is a reported unresolved failure rather than independently verified execution evidence.
These runs must not be combined.

## Readable PR template update

PR authors now use normal Markdown sections and checkboxes.
The nine new parser/metadata tests pass; the current complete autonomy suite passes 92 tests with no failures or skips (`reports/autonomy/markdown-autonomy.log`).
Whole-repository lint, formatting, workflow syntax and whitespace checks also pass; results are in `reports/autonomy/markdown-validation.json`.
This is a later tooling snapshot, not additional product-coverage credit on top of the original 83-test run.

The latest `pnpm check` remains failed (`reports/autonomy/markdown-check.log`).
It reports the two missing generated-icon imports plus three `MachineInfo.status` type errors in the application adapter and its browser fixtures.
Those application and SDK source files were not changed by the PR-template update.
The new type diagnostics are retained separately; no successful full check or browser run is claimed for this update.

## Screenshot storage update

Screenshot PNGs remain temporary CI outputs and are published as GitHub attachments embedded in the PR body; they must never be committed to Git.
Capture-plan files contain instructions only.
Ignore rules prevent accidental additions; trusted diff classification rejects committed evidence directories and binary capture files even when force-added.
The publisher and final evidence validator reject repository image URLs and require GitHub attachments.
At this snapshot publication still used an unconnected external endpoint; the later CLI update below removes that requirement.

`LODY_UI_PINNED=1 pnpm check` passed all 94 autonomy tests, then failed on the same five generated-icon and `MachineInfo.status` type diagnostics (`reports/autonomy/no-git-screenshots-check.log`).
Targeted lint, formatting and `git diff --check` passed.
This changes evidence storage policy and tooling only, so application browser journeys are inapplicable to this update; actual capture/upload execution remains unverified.

## Direct GitHub CLI attachment update

The [official `gh pr edit` manual](https://cli.github.com/manual/gh_pr_edit) documents `--attach`, repeated attachments, local-reference rewriting with `--body-file`, and partial failures that can still update the PR body.
The installed CLI is v2.100.0 and its help exposes `--attach`; the latest official release inspected was v2.102.0.
This corrects the earlier assumption that a separate HTTP image service was necessary.

The direct adapter now calls `gh pr edit --attach` with verified PNGs and a body file in an automatically cleaned system temporary directory outside the checkout.
It batches at most 50 files, authenticates PR head/base/body freshness, verifies exact reference rewrites and downloaded image hashes, and rejects partial failures without automatic retries.
Merge-queue candidate SHA and PR source-head SHA remain distinct.
`AUTONOMY_IMAGE_ENDPOINT` is removed from workflow and preflight configuration.
Attachment commands use the separate environment-only `AUTONOMY_IMAGE_TOKEN`; acceptance checks retain their pinned App identity.
The [official attachment client](https://raw.githubusercontent.com/cli/cli/trunk/internal/attachments/client.go) currently rejects installation tokens for uploads.

`LODY_UI_PINNED=1 pnpm check` passes all 101 autonomy tests, then fails on the same five generated-icon and `MachineInfo.status` type errors.
Final validation is retained at `reports/autonomy/gh-attachments-check-final.log`.
Targeted lint, formatting, workflow syntax and whitespace checks pass.
No remote PR attachment upload was performed; local CLI help and isolated tooling tests do not prove remote credential permissions or publication.
This changes evidence publication tooling only, so product browser journeys are inapplicable to this update.

## Public repository configuration follow-up

Fresh GitHub reads confirm `visibility: public`, account-level administrator capability, empty ruleset and ruleset-derived main-rule lists, only the existing Quality/Release workflows, and no open PRs.
Branch-protection inspection, Actions management settings and variables/secrets metadata returned integration-permission 403; missing access is not evidence that those settings are absent.
The authorized auto-merge PATCH and `autonomy` environment PUT both returned `Resource not accessible by integration`.
Read-back confirmed auto-merge remained disabled and the environment list remained empty.
No remote setting change is claimed.
Read/write outcomes are retained in `reports/autonomy/public-configuration-before.json` and `reports/autonomy/public-configuration-after.json`; intended request bodies contain no credentials and remain in ignored reports.

The [official Merge Queue availability documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) requires organization ownership for public repositories.
GitHub reports the repository owner as a `User`.
Public visibility therefore removes the earlier private-plan restriction but does not establish queue eligibility or credential access.
No organization transfer, alternate credential route or policy relaxation was attempted.
This follow-up changes operational documentation only; browser/UI evidence is inapplicable.

## System GitHub CLI and personal auto-merge update

The owner explicitly selected the existing system GitHub CLI login after the session wrapper returned integration-permission errors.
`/opt/homebrew/bin/gh` uses the owner's existing local login; credentials were not printed, copied or installed in CI.
The system CLI confirmed the personal public repository already has auto-merge enabled, and repository administration, variables/secrets metadata and environment APIs are accessible.
Actions default token permissions are read-only and PR-review approval is disabled.
No main protection exists, Actions variables/secrets are empty, and the new workflows remain local.
Configuration inspection is retained at `reports/autonomy/system-gh-configuration.json`.

The `autonomy`, `release-promotion` and `release-publication` environments were actually created and read back.
Autonomy permits only the exact main branch.
Release promotion permits only main; publication permits main plus version tags, with stable-tag syntax additionally enforced by the release controller.
Both release environments require the owner reviewer, forbid self-review and disable administrator bypass.
The verified remote settings are retained in `reports/autonomy/system-gh-environments.json`.
No required checks were installed ahead of their workflow/App deployment, and no PR was merged or release published.

The protected local policy now explicitly selects personal-repository `protected-auto-merge`.
It retains strict required check identities and head/base/body/policy freshness, rejects an out-of-date PR, mismatched integration candidate or unexpected queue, and does not require an organization transfer.
An explicitly selected `merge-queue` strategy retains the single-entry queue requirements; missing or unknown strategies fail closed.
The earlier statement that migration was required for all automatic merging was incorrect: organization eligibility applies to Merge Queue, not auto-merge.

The system-login preflight is `reports/autonomy/system-gh-preflight.log` and `reports/autonomy/preflight.json`.
It still fails closed on missing main protection, undeployed policy/workflows, unconfigured acceptance App, independent reviewer and dedicated CI credentials.
This Node tooling/configuration change does not affect application UI; product browser journeys cannot prove its external enforcement.
Remote end-to-end adversarial pilots are still required before unattended readiness.

Before pushing this branch, `pnpm check` passed all 106 autonomy tests, then failed on the same five generated-icon and `MachineInfo.status` type diagnostics.
Whole-repository lint and formatting, workflow syntax and whitespace checks passed.
Logs are retained at `reports/autonomy/pre-push-check.log`, `reports/autonomy/pre-push-lint.log` and `reports/autonomy/pre-push-format.log`.
These are tooling results, not installed-product or live acceptance proof.

The two application type errors are the `./generated` imports in `src/shared/icons/Icon.tsx` and `src/shared/icons/agent-identity.ts`.
The Runeicons submodule fetch was rejected by the connected Git credential/access capability.
No alternate route, invented glyphs, mock generated source, skipped check or lockfile rewrite was used to turn this into a pass.
Lody's recorded UI gitlink was initialized and preserved; pinned verification now avoids refreshing it during measurement.
Normal development UI updates still track `main`.

The tooling tests exercise signed decisions, current context/SHA/policy/model binding, stale runner definitions and evidence deadlines, independent probe requirements, trusted capture/build/fixture/plan identity, missing or stale inline images, actual uploaded/downloaded-byte hashes, path traversal/symlinks, protected-area escalation, typed UI plans and installed-package inventories, performance baselines, deterministic gates before check publication, revocation, immutable partial-release recovery and incident closure.
These tests do not establish that Dots actually rejects a deceptive remote PR or that the unexecuted native capture code works in Chromium.

The supplied iOS verification article informed the compact machine-readable review packet and explicit distinction between interface exploration and authoritative business outcomes.
See [verification design](./VERIFICATION-DESIGN.md).
Original failures and raw reports remain retained; a later successful attempt cannot erase them.

Before operational acceptance, restore the authorized pinned build prerequisites, run complete real browser/extension/mutation/capture journeys, deploy the protected workflow and environment/App/service configuration, and execute the ten real adversarial pilot PRs plus merge→immutable-release→installed-monitor continuity in an isolated repository.
Examples and expected outcomes are in [examples](./examples/README.md); they are not fabricated remote PRs.
The asynchronous check-expiry/body-edit race and native browser fidelity limits are documented in [GOVERNANCE.md](./GOVERNANCE.md) and [UI.md](./UI.md).
