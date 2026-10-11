# Validation record

This is the latest retained evidence summary, not an installed-readiness claim.
Raw ignored logs remain under `reports/autonomy/`; links resolve in a workspace retaining those reports and are not a claim of public artifact availability.
Earlier failed attempts remain retained and must not be combined into a passing run.

| Check or state                           | Latest retained observation                                                                                                                                               | Raw evidence                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Initial PR #4 CI                         | Failed because SDK `dist` was not built before application typechecking                                                                                                   | [CI log](../../reports/autonomy/pr4-initial-ci-failure.log)                                                                    |
| SDK-fix CI                               | SDK/application typechecking passed; Knip rejected one unused dependency and two uncalled exports                                                                         | [CI log](../../reports/autonomy/pr4-sdk-fixed-ci-failure.log)                                                                  |
| Before redirect fix                      | 110 autonomy tests passed; full check stopped only on the two missing real generated-icon imports                                                                         | [Check log](../../reports/autonomy/ci-repair-check.log)                                                                        |
| Affected browser infrastructure          | Both files passed, seven tests total                                                                                                                                      | [Browser log](../../reports/autonomy/dead-code-browser-reconciled.log)                                                         |
| Documentation consolidation `pnpm check` | 106 autonomy, five assurance-tool and three release tests passed; SDK build and WXT preparation completed; typechecking stopped on the two missing generated-icon imports | [Check log](../../reports/autonomy/docs-consolidation-check.log)                                                               |
| Pre-push `pnpm check`                    | 106 autonomy tests, five assurance-tool tests and three release tests passed; application typechecking failed on generated-icon imports and `MachineInfo.status` mismatch | [Check log](../../reports/autonomy/pre-push-check.log)                                                                         |
| Pre-push lint / formatting               | Passed; no full-check success follows from these stages                                                                                                                   | [Lint](../../reports/autonomy/pre-push-lint.log), [format](../../reports/autonomy/pre-push-format.log)                         |
| Browser infrastructure                   | 156 tests passed, two suites failed to import; command failed overall                                                                                                     | [Browser log](../../reports/autonomy/local-browser.log)                                                                        |
| Packaged extension / assurance           | Preparation failed on pinned glyph prerequisites; no complete journey pass established                                                                                    | [Extension](../../reports/autonomy/local-extension-pinned.log), [assurance](../../reports/autonomy/local-assurance-pinned.log) |
| Preflight                                | Failed closed on missing protected deployment, main protection, App/reviewer and dedicated credentials                                                                    | [Preflight](../../reports/autonomy/preflight.json), [system-login log](../../reports/autonomy/system-gh-preflight.log)         |
| Authorized system GitHub login           | Public personal repository, auto-merge enabled, main unprotected, variables/secrets metadata empty                                                                        | [Configuration](../../reports/autonomy/system-gh-configuration.json)                                                           |
| Full product CI                          | Static checks, SDK/package and browser infrastructure passed; real journeys verified 19/44 cases, with 20 web scenarios and eight extension tests failing                 | [Run 38112352593](https://github.com/wibus-wee/lody-wxt/actions/runs/38112352593)                                              |
| Native image upload                      | Real CI screenshot uploaded inline to PR #6; public download hash matches; a GitHub-to-S3 302 was observed                                                                | [PR #6](https://github.com/wibus-wee/lody-wxt/pull/6), [receipt](../../reports/autonomy/manual-github-attachment-receipt.json) |
| Protected environments                   | `autonomy`, `release-promotion`, `release-publication` created and read back; does not establish full service deployment                                                  | [Environments](../../reports/autonomy/system-gh-environments.json)                                                             |

The CDN redirect fix passed all 112 autonomy tests: [test log](../../reports/autonomy/redirect-autonomy.log).
The final local full check passed those tooling suites and stopped only on the two unavailable generated-icon imports: [full check](../../reports/autonomy/final-redirect-check.log).
It permits bounded HTTPS downloads from protected allowlisted attachment hosts without credentials and rejects repository/foreign redirects.

The owner-authorized `/opt/homebrew/bin/gh` login has workflow scope.
Pushed commit `568c0f4` fixes SDK build order and bootstrap protected-policy absence; [CI run 38111097768](https://github.com/wibus-wee/lody-wxt/actions/runs/38111097768) confirmed typechecking passes and failed at Knip's unused dependency/exports checks.
New workflows remain on the PR branch, not main; App/Dots variables and secrets are absent.
A fresh reproduction starting without SDK dist confirms all SDK TS2307 and `MachineInfo.status` diagnostics are eliminated without application type edits.
The table preserves the original failures; the only remaining local type errors are missing real Runeicons-generated icons.
Runeicons clone remains explicitly denied; do not bypass that denial.
The unused `react-hook-form` dependency and uncalled `exportConversation`/`searchConversations` helpers were removed.
The pnpm lockfile change removes only 19 lines for that dependency; unrelated version updates were reverted, and frozen-lockfile installation passed.
No active UI behavior was removed; the affected existing browser tests passed.
Local Knip can still report missing real generated-icon imports; final GitHub CI must establish a complete pass.

Historical integration-permission denials and earlier configuration snapshots remain in [before](../../reports/autonomy/public-configuration-before.json) and [after](../../reports/autonomy/public-configuration-after.json) reports.
The system login subsequently enabled authorized administration; those earlier denials are not current system-login blockers.
A historical delegated browser report records 59 passed tests, six import failures and an unexplained iframe timeout: [report](../../reports/autonomy/historical-browser-report.txt).
Its original run identity/raw framework logs were not recovered; the later infrastructure run does not prove the timeout fixed.

Early real probe attempts completed zero phases: missing UI dependencies, then an unresolved nested submodule entry.
Retained temporary results were `/var/folders/31/jk1r8d715bjcf9kyt520z98r0000gn/T/lody-autonomy-fbANV2/result.json` and `/var/folders/31/jk1r8d715bjcf9kyt520z98r0000gn/T/lody-autonomy-VfSCCc/result.json`; their continued availability is not guaranteed.
A paired capture smoke attempt also lacked the before `dist/web` build; no paired captures or publication receipt was produced.
Early orchestration CLI absence was an integration-stage failure, not a claim that the current CLI is absent.
Intermediate Node integration logs, including `local-functional-autonomy.log`, `local-ui-receipts-tests.log`, `local-trusted-capture-tests.log` and `local-native-plan-integration-tests.log`, remain in ignored reports.
Those fixtures are not browser execution, downloaded-image publication, live signature verification or remote GitHub enforcement.

Before readiness, complete real browser/extension/mutation/capture runs, protected workflow deployment and App/Dots/attachment configuration, then all [ten isolated remote pilots](./examples/README.md) and merge→immutable-release→installed-monitor continuity.
Product gaps are tracked separately in [draft PR #6](https://github.com/wibus-wee/lody-wxt/pull/6), as requested by the owner; the simplified UI and all model obligations remain intact.
Missing historical-session access and unmounted workspace/conversation routes keep PR #4 blocked.
The full failed run and the later fast-failure run are retained; early stopping does not turn skipped obligations into verified cases.

No protected-capture pilot, adversarial acceptance result, release publication or incident recovery is claimed.
The observed manual CLI image upload validates native GitHub publication and the public download, not the deployed CI publisher.
[RUNBOOK](./RUNBOOK.md) owns configuration and recovery; [GOVERNANCE](./GOVERNANCE.md) and [UI](./UI.md) retain freshness and native-fidelity limits.
This documentation consolidation changes no runtime behavior, so browser/UI evidence is inapplicable to its diff; that does not waive the implementation's outstanding obligations.
