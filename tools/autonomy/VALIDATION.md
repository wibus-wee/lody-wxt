> Review architecture update: the owner clarified that Dots is the connected assistant.
> The separate endpoint/signature/App design described in older entries below is superseded.
> Historical failures are retained; they are not instructions to deploy those services.
> Current operation is described in RUNBOOK.md.

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
The earlier missing-navigation failures were tests for intentionally disabled surfaces, not a requirement to restore the old UI.
On the owner's clarification, six model cases and their scenarios were retired together: advanced management/archive, sidebar management, advanced delete/fork, advanced steer recovery and unreachable sharing.
Current compact-chat editing/forking remains required.
The namespace registry is regenerated from the model; the historical 19/44 result above remains a failed observation under its original model, not a result for the revised scope.
Active chat, identity, scrolling and extension tests no longer use the removed history button as setup.
Existing-conversation fixtures explicitly seed per-surface selection before the behavior under test; reload assertions then use production restoration without reseeding.
Profile restart verifies the durable new-chat draft and identity, rather than promising cross-profile history navigation.
Settings synchronization uses the current ambient preference, with the removed display-name editor assertions retired.
The local retirement check passed 112 autonomy, five assurance-tool and three release tests before stopping on the two unavailable generated-icon imports ([check](../../reports/autonomy/retire-disabled-check.log)).
The attempted browser assurance and packaged extension build are also blocked by the unavailable pinned Runeicons checkout; no revised browser or coverage pass is claimed.
Fresh CI must establish results for the revised model.

CI run [38122249433](https://github.com/wibus-wee/lody-wxt/actions/runs/38122249433), at `f023575`, passed check/SDK/package/browser infrastructure and recorded 18 passing web scenarios, one touch-scroll failure and eight skipped scenarios; extension execution recorded 12 passes, one HTTP-capture timeout and three not run.
Its generated `COVERAGE.md` was copied unchanged from the authenticated artifact: 26/38 model cases verified under source hash `067ab9a970b5`, with failures and missing evidence retained.
That observation does not certify later source edits.
Native-touch diagnostics against the unmodified CI-built extension verified both scroll directions; the new frame-paced native touch helper also passed against that extension and a minimal headless-shell fixture.
Initial local capture reproduction passed both origins; repeated foreground audits exposed insufficient contrast in the waiting status, which now uses the existing primary text token.
The long capture lifecycle has a bounded 60-second overall deadline, preserves per-assertion limits and foregrounds the panel for visual/axe checks.
The extension input is the original CI artifact, not a local rebuild; the new status style still requires a fresh candidate build and rendered verification.
Draft #6's shortcut-loading waits are included in the same CI repair so authorized shared entries cannot be omitted by an early snapshot.
Local check again passed the tooling suites and stopped at the missing real generated-icon imports ([log](../../reports/autonomy/current-ci-repair-check.log)); full source execution remains unavailable locally.
Run [38124944460](https://github.com/wibus-wee/lody-wxt/actions/runs/38124944460) at `d5ed425` passed the complete workflow: 27 web scenarios, four repeated performance scenarios in each of four additional repetitions, 16 extension tests, 38/38 model cases, all builds and React Doctor.
The following run at `8bcc636` passed web journeys but timed out in packaged capture, so the earlier success is not treated as proof of stability.
The checked-in coverage snapshot is now that run's unmodified report: 34/38 verified under source hash `18c54b24ca20`; failed/missing outcomes remain visible.
A three-repeat local capture run reproduced a disabled Send button after filling the composer before restored history was ready; five runs passed and one failed with a retained navigation/operation trace.
The test now waits for restored configuration, original question and completed response before entering the continuation, then asserts its value and exact same-session delivery.
After that synchronization change, all six HTTP/HTTPS repetitions passed against the unchanged `d5ed425` CI-built extension ([log](../../reports/autonomy/capture-ready-repeat.log)); this is test validation against authenticated build bytes, not a local source rebuild or a current-head CI pass.

No protected-capture pilot, adversarial acceptance result, release publication or incident recovery is claimed.
The observed manual CLI image upload validates native GitHub publication and the public download, not the deployed CI publisher.
[RUNBOOK](./RUNBOOK.md) owns configuration and recovery; [GOVERNANCE](./GOVERNANCE.md) and [UI](./UI.md) retain freshness and native-fidelity limits.
This documentation consolidation changes no runtime behavior, so browser/UI evidence is inapplicable to its diff; that does not waive the implementation's outstanding obligations.
