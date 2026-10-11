# Behavioral autonomy probes

Run from a trusted checkout with initialized submodules, installed pnpm dependencies and Playwright Chromium:

```sh
node --test tools/autonomy/probes.test.mjs
node tools/autonomy/probes.mjs
node tools/autonomy/probes.mjs --candidate /absolute/path/controller.ts --extension
```

The candidate file replaces only `src/features/account/controller.ts` in a temporary snapshot.
Without a candidate, the last phase restores the baseline controller.
No candidate command, shell fragment, package script, test, configuration or report path is accepted.
Unknown arguments fail.
Candidate code and the baseline checkout must be trusted for execution: this is filesystem isolation, **not a security sandbox**.
Use a disposable container or VM without secrets and with network restrictions for adversarial candidate code.
Environment inheritance is restricted, but HOME, PATH and the local dependency installation are trusted capabilities.

## Existing assurance audit

`tools/assurance/model.mjs` owns the coverage denominator and obligations. `catalog.mjs` binds authored cases and fingerprints sources. `run.mjs` builds SDK/UI, launches Vite on port 4173, selects Cucumber tags, writes run manifests, and invokes aggregate reporting; `--extension` also builds and executes packaged Playwright tests.
Aggregate assurance can reject incomplete coverage outside a selected case, so this narrowly scoped acceptance probe invokes the existing Cucumber configuration directly and validates its report and JourneyEvidence against the selected model case.
It does not update baseline.json, COVERAGE.md or the assurance latest pointer.

The real journey is `change-identity-during-work / token-expiry` in `tests/e2e/features/identity-recovery.feature`.
Existing steps authorize a device, retain a draft, start streaming, advance the browser clock through expiry, deliver a late reply, and authorize again.
HTTP/Streams boundaries are controlled fixtures; the application, browser rendering, account controller and document behavior are real.
Its obligations are `expiry-revokes-composer`, `late-response-rejected`, and `fresh-login-required`.

The extension persistence spec verifies actual MV3 service-worker transport, restricted storage access, extension reload, persistent browser-profile restart, conversation/draft continuity and durable logout.
It uses a local HTTPS protocol server and real Chromium extension loading.
Other extension specs cover network routing, page context, updates, notifications and shortcuts.
Vitest Browser Mode is infrastructure coverage, not a replacement for these journeys.
The reader-scroll journey additionally runs axe; this expiry probe does not claim accessibility or Storybook coverage.

## Acceptance protocol

1. Copy tracked working-tree files and initialized submodule files into a new OS temporary directory.
   Dereference file symlinks only when their resolved target stays inside the checkout; reject other nonregular tracked entries.
   Untracked candidate changes outside the single supplied controller are excluded.
   Link trusted installed dependencies, redirecting root SDK/UI workspace links into the copy.
2. Run the unmodified baseline journey; require exit zero, exactly one named scenario, all steps passed, all authored obligations exactly once, matching run/model/controller hashes and a nonempty trace.
3. Insert an early return at the unique `armExpiry` timer assignment.
   This preserves login/streaming but prevents timer-driven revocation.
   Require exit one and failure at the first obligation assertion after the expiry action successfully completes.
   Setup errors, skipped setup, unrelated error signatures and already-recorded checkpoints do not count as mutation detection.
4. Replace the mutant with the candidate (or baseline restoration) and require the complete passing journey again.
   This is the controlled fail-before/pass-after pair, preceded by a healthy baseline control.
5. With `--extension`, build the candidate package using fixed `pnpm exec wxt build` and run the existing persistence spec.
   Require one expected result and zero unexpected, skipped or flaky results.

SDK/UI builds run before each browser phase.
Processes have bounded execution time, and process groups are killed on timeout or preview cleanup.
An occupied port is rejected.
There is no installation, UI synchronization, submodule update, arbitrary command hook, retry-to-green or manufactured fallback success.
Any exception leaves `accepted: false` and exits nonzero.
Logs, unique manifests, controller hashes, Cucumber JSON, obligation evidence and traces remain in the printed temporary directory; `result.json` records completed phases and blockers.
Keep that directory as the review artifact and remove it manually when no longer needed.

## Practical limits

This is one specific regression probe, not general autonomy certification.
It does not accept arbitrary patches or prove a candidate fixes other behaviors.
Its `sourceHash` is the exact controller hash, not the aggregate assurance source fingerprint; manifests must not be mixed with aggregate assurance reports.
Other tracked sources come from the trusted working tree.
Shared installed dependencies and caches are not hermetic.
Do not run concurrently against port 4173, and keep the trusted checkout stable while snapshotting.
The failure signature is an assertion-family check tied to the exact journey step and checkpoint boundary, not semantic proof of every possible failure cause.
Candidate code can forge results if malicious; use external sandboxing and a separate trusted verifier for that threat model.

The optional extension pass is candidate regression coverage, not an extension mutation kill.
Its existing spec disables the default trace and explicitly captures its lifecycle traces.
This tool does not run the full extension suite, React Doctor, Storybook or axe, nor does it replace `pnpm check` and `pnpm test:extension` for repository acceptance.

## Programmatic UI evidence adapter

`verifyProbeUiEvidence(manifest, body, expected, readPublishedScreenshot)` validates a schemaVersion 1 screenshot manifest before behavioral preparation.
Expectations and readers must come from trusted orchestration, never candidate JSON.

| Mode   | Required trusted inputs                                                                                                      | Publication verification                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Strict | `headSha`, `baseSha`, `fixtureHash`, `impact`, `policy`, synchronous `readArtifact`, `publishedAssets`, actual PR body       | Shared `validateScreenshotManifest` verifies captured bytes and exact trusted path/URL/hash receipts, including UUID attachment URLs |
| Legacy | `beforeSha`, `candidateSha`, `fixtureHash`, `allowedOrigins`, actual PR body and asynchronous `readPublishedScreenshot(url)` | `validateInlineScreenshotEvidence` requires content-addressed HTTPS URLs and inline images; downloaded bytes must match hashes       |

Strict mode may additionally supply the asynchronous published-byte reader.
The reader must return nonempty Buffer/Uint8Array bytes, reject failed responses and redirects outside the trusted origin, and bound response sizes and time.
Strict receipt provenance must be established independently; candidate-supplied receipts cannot authorize publication.
The return receipt records schema version, passed status, fixture/manifest hashes, capture identities and `publicationVerification` (`trusted-upload-receipts` or `published-byte-reader`).
Receipt mode does not claim an independent network download when no reader was supplied.
URL durability remains the publisher's responsibility.

`run({ candidate, extension, uiEvidence })` accepts optional `{ manifest, body, expected, readPublishedScreenshot }` UI evidence and retains its receipt in `result.json`.
UI validation alone never makes the probe accepted.
The CLI supports only `--candidate` and `--extension`; it cannot authorize origins, revisions or callbacks through JSON.
This adapter neither publishes images nor edits PRs, and does not automatically wire a general merge gate.
See [UI](./UI.md) for capture/manifest contracts and [RUNBOOK](./RUNBOOK.md) for publication and service setup.

Contract implementation and negative fixtures: [probes.mjs](./probes.mjs), [probes.test.mjs](./probes.test.mjs), [screenshot-manifest.test.mjs](./screenshot-manifest.test.mjs).
Observed failures and raw report locations remain in [VALIDATION](./VALIDATION.md); no successful browser mutation/restoration or installed-extension pass is claimed.
