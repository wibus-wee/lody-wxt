# Product assurance contract

The authored [model](./model.mjs) defines product obligations. [COVERAGE.md](../../COVERAGE.md) joins that model to fresh execution evidence.
Tests and framework counts never define the denominator.

## Derivation and ownership

Derive a journey by following an actual mounted surface through its state owners, durable writes, remote effects and user-visible return path.
Read the implementation before choosing a fixture or inspecting existing tests.
Include failure, identity invalidation and restart boundaries.
Each lifecycle case names a joint state obligation, rather than multiplying independent state flags into an artificial Cartesian matrix.

| Product chain                                                                     | Authoritative implementation                                                                                                                                                                                                                                                           | Assurance consequence                                                                                                                                 |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device authorization → validation → workspace → chat → reload                     | [account controller](../../src/features/account/controller.ts), [trusted storage](../../src/features/account/storage.ts), [client lifecycle](../../src/features/connection/use-client.ts)                                                                                              | Cancel rejects late token success; outages retain credentials; logout and identity changes fence old runtimes.                                        |
| Draft → reservation → admission → history write → metadata publication → response | [quick chat](../../src/features/chat/ConnectedChat.tsx), [real client](../../src/features/connection/real-client.ts), [session flows](../../src/features/conversations/session-flows.ts), [repository](../../packages/lody-sdk/src/sessions/infrastructure/loro-session-repository.ts) | Keep the immutable request and draft through ambiguity. Confirm history and metadata before clearing recovery state. A flush is not agent completion. |
| Advanced route → independent controller → journal → machine command → reread      | [workspace](../../src/features/conversations/WorkspacePage.tsx), [controller](../../src/features/conversations/runtime-controller.ts), [Machine Flock](../../packages/lody-sdk/src/sessions/infrastructure/machine-flock.ts)                                                           | Quick-chat evidence cannot certify advanced queue/steer/edit/fork/delete. A synchronized deletion command cannot certify deletion.                    |
| Active tab → explicit grant → extraction → preview/removal → durable draft → send | [capture](../../src/features/page-context/capture.ts), [context projection](../../src/features/chat/real-adapter.ts)                                                                                                                                                                   | Assert sanitized untrusted data and the exact retained references in the remote turn. Web preview cannot establish this boundary.                     |
| Preference save → durable store → other surface → reload → continued work         | [preferences](../../src/features/preferences/use-preferences.ts), [storage](../../src/shared/storage.ts), [shell](../../src/app/App.tsx)                                                                                                                                               | Verify propagation, draft continuity and system Reduce Motion together.                                                                               |
| Extension worker request → interruption → trusted state → profile restart         | [transport](../../src/features/network/background.ts), [entrypoints](../../src/entrypoints), [manifest](../../wxt.config.ts)                                                                                                                                                           | Isolated CSP/storage checks support this journey but do not establish end-to-end recovery.                                                            |

The model was established from these chains before consulting the former scenario suite.
Reused HTTP/Streams fixtures are evidence mechanisms: they import real browser CRDT writes and return real remote updates.
Fixtures do not declare obligations.
Namespace disposition is authored in the model; `tests/e2e/namespaces.json` is its checked registry, regenerated with `node tools/assurance/cli.mjs namespaces`.

P0 lifecycle cases include simultaneous admission across surfaces, workspace switching during active work, expiry, destructive fork/delete, queued steering recovery, denied capture permission and extension/profile restart with retained work. `COVERAGE.md` reports their current evidence and any unverified obligations; this contract does not duplicate run status.
Attachment configuration lacks `attachmentOrigin`; the HTTP submission controller is not mounted by application routes.
Their SDK tests remain supporting contracts rather than working product journeys.

## Executable evidence

An assurance scenario contains a sequence of user decisions and consequences across several product links.
Authored scenarios live in [feature files](../../tests/e2e/features), with implementation in [journey steps](../../tests/e2e/journey-steps).
A visible page or an isolated click is insufficient.
Each scenario declares one existing model case, its namespace, joint state tags and consecutive lifecycle transitions.
Tags declare intent; assertions produce evidence.

`JourneyEvidence.check` writes a checkpoint only after its assertions succeed.
Every obligation must succeed in the same attempt.
The auditor joins receipts to raw Cucumber/Playwright outcomes, including hooks; missing results and partial attempts receive no credit.
Failures cannot be hidden by a later passing repetition.
Packaged cases require extension-layer evidence and traces.
Supporting SDK, Vitest Browser Mode, Storybook and axe checks remain verification layers.

| Command                         | Result                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm assurance:validate`       | Validate model sources, owners, namespaces and executable declarations.                     |
| `pnpm test:assurance:tools`     | Check evidence rejection, attempt isolation and performance comparison policy in Node.      |
| `pnpm test:e2e`                 | Own port 4173, execute web journeys, record traces and regenerate the audit.                |
| `pnpm test:assurance`           | Execute web journeys and built extension checks in one source-scoped run.                   |
| `pnpm test:extension`           | Run packaged checks independently; it does not attach results to a prior assurance run.     |
| `pnpm assurance:audit`          | Reject stale, failed, incomplete or regressed evidence. Missing cases remain explicit gaps. |
| `pnpm assurance:audit --strict` | Also fail for any unverified P0 case.                                                       |

Each run has a unique directory under `reports/assurance`, a manifest, raw framework results, checkpoint receipts, interaction samples and traces. `latest.json` selects one run; the auditor never combines unrelated runs.
The runner prepares SDK/UI outputs and, for packaged runs, builds the extension before freezing the source snapshot.
A Lody `main` refresh therefore completes before measurement; packaged tests use that same prepared build.
Source fingerprints cover product/SDK code, fixtures, assurance tools, build configuration, lockfile, relevant upstream UI/shared sources and both submodule revisions.
Source or model drift invalidates credit.
Baseline data and generated reports are excluded from the source fingerprint.
CI runs the combined runner and audits again even after failures; its normal gate does not imply the P0 backlog is complete.

## Action-to-response observability

Interactions are independently authored in the model.
Each defines a trusted user action, observable response, workload and relevant attribution domains.
Arm a probe on the intended control before acting.
Browser capture listeners timestamp the trusted click/Enter before application handlers.
Animation-frame sampling ends at the declared visible DOM outcome; an already satisfied outcome fails instrumentation.
Hidden pages, missing events, timeout and failed/incomplete journeys are excluded from successful distributions.

This is event-to-visible-DOM presentation opportunity, not physical paint, INP, request duration or production service latency.
Probes retain browser/version, operating system, CPU architecture, viewport, Reduce Motion, packaged/web surface, fixture/workload and measurement version.
Resource intervals use the same browser clock and sanitized service families.
A buffered `PerformanceObserver` records long tasks when supported; absence of support is explicit.
Overlapping intervals are observations, not additive critical-path attribution.
The probe enlarges and clears the page resource timing buffer before arming so development module imports do not consume the default buffer.
Completed page resources cannot describe still-open streams or background-worker requests; traces retain those boundaries.
Storage, decoding, remote execution and scheduling remain unallocated without additional instrumentation.
The controlled remote actor is driven by the test harness; its pacing is included in response measurements.

`stop-observed` ends on terminal execution reflected by ready Send, rather than command acknowledgement. `recovery-confirmed` requires the recovered turn and disappearance of uncertainty.
Capture timing remains unmeasured where the headless packaged test uses a background extension tab; that cannot establish visible native side-panel timing or permission-dialog latency.

Collect a candidate with repeated comparable runs:

```sh
ASSURANCE_REPEAT=5 ASSURANCE_BENCHMARK_AFTER_FIRST=1 pnpm test:assurance
pnpm assurance:baseline
pnpm assurance:audit
```

With `ASSURANCE_BENCHMARK_AFTER_FIRST=1`, the first repetition executes all web journeys and subsequent repetitions select their authored `@performance` cases; packaged checks execute once per repetition with separate framework reports, receipts and trace directories.
Ordinary PRs use one repetition; release uses five.
This retains complete lifecycle evidence in the same run while repeating only measured workloads.
A targeted investigation can use `ASSURANCE_TAGS='@performance' pnpm test:e2e`; its report represents only that run and will show other obligations as missing.
Promotion is explicit and requires at least five successful comparable samples for every observed group.
Baselines contain observed values and run/source/model provenance.
Tests never rewrite them.
Different environments or workloads have no comparable baseline.
Five samples are provisional, not statistically reliable production percentiles; gather more samples before interpreting small differences.

A comparable p95 regresses only beyond the greater of 25% and 50 ms over its baseline.
Investigate the authored outcome first, then compare raw samples and fixture/environment keys, inspect `pnpm exec playwright show-trace <trace.zip>`, and correlate browser resource/long-task intervals.
Reproduce with the same workload before attributing a change to transport, document synchronization or rendering.
Do not subtract overlapping requests to invent agent/CPU time, or promote a baseline to hide an unexplained regression.

## Investigation example: stopping a streamed turn

An initial controlled sample measured 5,182.5 ms from Stop to a ready Send control.
Its trace showed the cancel POST completing in about 2.5 ms and the response-stream read in about 153 ms, followed by a 4,996 ms gap between document SSE requests before terminal history appeared.
The pinned `@loro-dev/streams-crdt` 0.16.0 read loop applies a five-second minimum successful-SSE lifetime after a stream closes quickly; the [fixture](../../tests/e2e/support/runtime-boundary.ts) closes each response after 150 ms.
This supports attributing the large delay to fixture-induced reconnect pacing rather than the cancel request duration.
It does not establish production stop latency or a rendering regression.
The raw resource overlap alone cannot account for the idle gap; the network trace and installed transport implementation explain it.
Keep this workload explicit in the baseline, and investigate a sustained-stream deployment separately instead of removing the observed wait from the measurement.

## Fidelity limits

Packaged capture uses actual tabs, extraction and extension controls.
The permission-denied case observes Chrome rejecting a screenshot without `activeTab`, preserves the draft, invokes the real toolbar action through CDP and retries the capture.
Optional-host native permission dialogs remain outside this evidence; other capture fixtures grant only their specific origin through Chromium extension settings.
The profile-restart case carries a streaming conversation and an unsent follow-up through extension reload and a persistent-profile browser restart, reopens the same history, then checks logout across another restart.
Its separate browser contexts retain individual traces.
Conversation selection is per surface; the durable draft belongs to its account, workspace and conversation.
Controlled protocol fixtures prove neither a deployed agent nor production authorization. axe checks rendered accessibility within a journey and Storybook explores component states; neither changes lifecycle coverage.

## PR latency and release sampling

PR Quality runs independent read-only lanes: checks/builds, three web lifecycle shards (two workers each), and packaged extension journeys (three workers).
A stable partition assigns each authored web case exactly once.
The aggregator checks each shard’s raw framework cases against its assigned partition before combining them; missing or duplicated cases fail closed.
Each scenario keeps its own browser context/profile and protocol boundary.
The aggregator retains the existing `PR Quality / verify` check and exact-head artifact interface.
It requires every lane to succeed, matching run/attempt/commit/model/source identities, both raw framework reports and the complete lifecycle audit.
Missing, duplicate, failed or foreign lanes cannot certify acceptance.
Raw failures remain in their lane artifacts.

Ordinary PRs execute every functional journey once, including interruption/recovery and authored interaction outcomes.
Their single interaction observations are provisional diagnostics, not a five-sample performance comparison.
Release packaging executes the full functional run plus four additional authored performance rounds, serially, and explicitly requires five comparable successful samples for every measurement before publishing.
Release sampling does not authorize publication or alter baseline promotion.

Only dependencies/browser binaries are cached by pinned inputs; candidate test results are never reused across commits.
Built Chrome/web bytes are transferred within the same run and validated against their exact-source build receipt, not reconstructed in the aggregation job.
New PR commits cancel superseded runs; incomplete runs never pass the aggregate gate.

Compare cold/warm setup, each lane and aggregate wall time against the original serial run before claiming a speedup.
Worker counts trade runner resources for latency and must be checked for fixture isolation and resource contention.
Keep release performance workers at one.
No performance threshold, timeout, retry policy or functional obligation is relaxed by this split.
