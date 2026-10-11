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

## Evidence from this checkout

On 2026-10-10, Node v26.10.0 ran the four Node tooling tests successfully.
These tests exercise mutation anchoring and fail-closed report validation; they are not component tests or browser evidence.

`node tools/autonomy/probes.mjs --extension` returned `accepted: false` with zero completed phases: `vendor/lody/packages/ui/node_modules` was missing.
Both UI and Runeicons submodules were initially uninitialized.
The retained result was under `/var/folders/31/jk1r8d715bjcf9kyt520z98r0000gn/T/lody-autonomy-fbANV2/result.json`.

`pnpm check` began dependency resolution and was interrupted to avoid installation or lockfile changes.
The chained `pnpm test:extension` therefore did not execute.
A direct Playwright persistence-test collection attempt (`node --import tsx node_modules/@playwright/test/cli.js test tests/extension/persistence.spec.ts --list`) failed because `@lody-mobile/sdk/dist/index.js` was absent.
No browser mutation kill, restored pass, packaged extension pass or full repository check is claimed.
Supply the missing prepared dependencies/submodules and rerun the commands above to obtain behavioral acceptance evidence.

After workspace dependencies/submodules changed during concurrent work, the final rerun again returned `accepted: false`, zero completed phases, with `Snapshot requires regular files: vendor/lody/packages/acp-extension-claude` (a nested submodule entry).
Evidence: `/var/folders/31/jk1r8d715bjcf9kyt520z98r0000gn/T/lody-autonomy-VfSCCc/result.json`.
All four tooling tests passed again after the final code change.
The snapshot deliberately rejects unresolved submodule directories rather than silently omitting trusted inputs.

## UI evidence integration

The programmatic export `verifyProbeUiEvidence(manifest, body, expected, readPublishedScreenshot)` consumes the UI owner's schemaVersion 1 screenshot manifest and calls `validateInlineScreenshotEvidence`.
Trusted orchestration must supply `expected.beforeSha`, `expected.candidateSha`, `expected.fixtureHash`, and `expected.allowedOrigins` independently of the candidate artifact.
Missing expectations fail closed.
This contract requires published HTTPS image URLs and exact inline Markdown images in the PR body.

The required asynchronous `readPublishedScreenshot(url)` callback must retrieve the actual published bytes from the validated URL.
It must reject failed responses and redirects outside the trusted origin, use bounded time and response sizes, and return a Buffer or Uint8Array.
It belongs to trusted orchestration; it is not supplied by candidate JSON.
The verifier recomputes SHA-256 for every nonempty returned image and compares it to the capture's contentHash.
A receipt records the manifest hash, fixture hash, revisions, URLs and content hashes.
Successful retrieval establishes byte integrity at verification time; the configured publisher remains responsible for URL durability.
This module does not publish images or modify a PR body.

`run({ candidate, extension, uiEvidence })` optionally takes `{ manifest, body, expected, readPublishedScreenshot }` as `uiEvidence`.
When supplied, UI validation must succeed before behavioral preparation, and its receipt is retained in result.json.
UI validation alone never makes the overall probe result accepted.
Trusted orchestration can call `verifyProbeUiEvidence` separately without launching browsers.
The existing CLI remains limited to `--candidate` and `--extension`; there is no CLI JSON option that can authorize origins, choose revision expectations or provide executable callbacks.
The separately owned general evidence/merge gate must explicitly invoke this interface when UI evidence is required; this change does not wire that gate automatically.

Coordinated validation after this integration: `node --test tools/autonomy/probes.test.mjs tools/autonomy/screenshot-manifest.test.mjs tools/autonomy/capture-ui.test.mjs` passed all 9 tests (5 probe, 2 screenshot-manifest, 2 capture infrastructure).
No browser was launched. `pnpm check` passed model validation (21 journeys, 33 cases), all 5 assurance-tool tests and all 3 release tests; SDK typechecking and WXT preparation completed, then application typechecking failed with the two missing `./generated` icon imports in Icon.tsx and agent-identity.ts.
Later lint/format/knip stages did not run through that command.

### Coordinated check and capture attempt

A subsequent requested coordinated run reproduced the two missing generated-icon errors in `pnpm check`, after assurance and release stages passed. `pnpm exec vite build --config vite.config.ts` also failed on those missing imports.
Initializing the pinned Runeicons submodule with `git submodule update --init vendor/runeicons` failed both Git retries with credential/access transport errors; no replacement glyphs or remote-main synchronization were used.

Chromium launched successfully.
The capture CLI was invoked using HEAD `53b7caaec7ef5e0d68ede424edb6a29cd2fed7ae` and a detached parent checkout `c226b933e945ad2e5730f8b2ee3dccd93b3686e5` as a local smoke-test pair (not an asserted PR base/head pair).
It loaded the candidate fixtures and launched Chromium, then rejected the absent before `dist/web` directory.
No paired screenshots, capture manifest or publication evidence was produced.
The candidate build was also unavailable because icon generation prerequisites were missing.
The temporary before worktree was removed after verification.

The workflow's exact evidence command, `node tools/autonomy/cli.mjs evidence --output reports/autonomy/evidence.json`, was attempted and failed with MODULE_NOT_FOUND: tools/autonomy/cli.mjs is absent in this coordinated checkout.
That separately owned orchestration entrypoint remains an integration requirement; probes.mjs does not implement the workflow evidence CLI.
No external image publication or PR writes were attempted.

### Strict publisher-receipt API

The adapter also supports the updated strict screenshot contract.
Supply `headSha`, `baseSha`, `fixtureHash`, `impact`, `policy`, synchronous `readArtifact`, and `publishedAssets` in `expected`.
The adapter passes these, together with the actual PR body, to `validateScreenshotManifest`.
The shared validator checks trusted revisions, the UI-impact boolean, configured themes/viewports and image-host allowlist, captured-byte hashes, exact upload receipt path/URL/hash matches, and inline image references.
This strict mode accepts trusted UUID upload URLs without requiring a hash in the URL path.

In strict mode the fourth `readPublishedScreenshot` argument is optional: publication verification rests on the trusted publisher's upload receipts, and captured bytes are recomputed through `readArtifact`.
If supplied, the asynchronous reader additionally verifies downloaded bytes.
Receipts record `publicationVerification: 'trusted-upload-receipts'`; this identifies the trust source and does not claim an independent network download.
Earlier `beforeSha`/`candidateSha` mode still requires the published-byte reader and content-addressed URLs, recording `publicationVerification: 'published-byte-reader'`.
Trusted orchestration must never accept publisher receipts from candidate-provided JSON without independently establishing their origin.

The updated combined Node command passed 11 tests (6 probes, 3 manifest, 2 capture infrastructure); targeted ESLint passed.
The strict adapter tests include UUID URLs and reject missing/forged receipts, tampered captured or downloaded bytes, asynchronous artifact readers, missing impact, stale revisions, absent inline images and incomplete policy theme coverage.
No browser or publication operations ran for this API update.
Earlier coordinated build/check/capture blockers remain unresolved.

### Functional governance handoff

After ownership of contract.mjs, evidence.mjs, orchestrate.mjs and cli.mjs transferred, the intent parser was replaced with bounded delimiter scanning.
The complete body is limited to 60,000 bytes before scanning, and duplicate or dangling intent markers are rejected.
The 32,000-character malformed-whitespace case measured 0.28 ms after the fix, compared with 267.89 ms in the earlier regex reproduction; these are local observations, not performance guarantees.

Production acceptance now supplies the trusted assurance model to evidence verification.
Evidence must match its model hash, complete case denominator and priorities; strict P0 requirements derive from that trusted model.
Merge-group evidence uses PR sentinel zero while still binding the synthetic candidate SHA, run attempt and commit tree.
Evidence creation verifies that checkout HEAD equals the candidate SHA, and the CLI restricts output to a safe reports path.
Acceptance rechecks the PR body and queue integration before publishing authority, and checks the body again before permitting merge.
These changes do not authorize protected release/version changes or establish external approval configuration.

No live GitHub writes or browsers ran for this functional handoff.

### Surface and workflow-link integration

Orchestration passes the exact declared change.surfaces list and authenticated run.html_url into validateUiEvidence.
The UI integration requires explicit nonempty surfaces and a workflow run URL, validates surface coverage before uploading, and passes both through the shared body renderer and final strict validator.
A web capture cannot certify declared extension coverage.
The integration test uses in-memory publication responses and verifies missing extension evidence blocks before upload, while valid web evidence preserves author text and renders the workflow link, surface and full candidate SHA.
The capture owner unified desktop/mobile scenario IDs, resolving the previously reported per-scenario viewport matrix mismatch.

After this integration, pnpm test:autonomy passed all 44 tests with no failures or skips.
The log is reports/autonomy/local-functional-autonomy.log.
No actual browser capture, external upload or GitHub mutation ran in this validation.

### Captured-build receipt acceptance

Trusted orchestration now obtains the base and candidate commit trees from authenticated GitHub commit responses and passes them to UI verification.
Before uploading any image, verifyUiBuildReceipts requires both referenced build receipts, recomputes their hashes, checks revision and tree identities, and validates bounded inventories with unique safe paths and an index.html entry.
The verified receipt and inventory hashes remain in the acceptance context.
Missing receipts, substituted receipt bytes and incorrect authenticated trees fail before publication.
These receipts establish consistency of declared build inputs and inventory, not independent proof that protected pipeline code executed the build or that every inventory byte was served.
Trusted pipeline execution and independent source-input review remain required.

The focused probe/capture/manifest/UI Node suite passed all 20 tests with no failures or skips; its log is reports/autonomy/local-ui-receipts-tests.log.
The full autonomy run was interrupted after the newly added impact graph caused governance tests to spin: optional graph lookup skipped queue.shift when graph was undefined, so affectedImporters never drained its queue.
The graph owner must dequeue before the optional lookup.
The import regex also showed approximately quadratic malformed-input timing and missed a valid compact import with no spaces; neither issue is resolved by a lint annotation.
No impact-graph edits, browser runs or external publication were made in this receipt integration.

For standalone capture, each exact checkout must first complete its actual pnpm build:web, then record that checkout's build with node tools/autonomy/capture-ui.mjs --record-build DIRECTORY FULL_SHA.
Run this once for the before checkout and once for the candidate checkout before invoking the paired capture CLI.
Recording inventories an existing dist/web; it does not execute a build, and must never substitute for the build command.
Capture requires these receipts and revalidates source cleanliness and the complete build inventory before and after capture.
The receipt remains a consistency record; protected execution and independent sourceInputsVerified review supply the separate execution/source trust boundary.

### Trusted capture workflow separation

UI publication now consumes a separate PR UI Evidence artifact, never screenshots or fixture hashes from the candidate PR Quality artifact.
PR Quality remains the source of hashed build/assurance evidence.
Independent Acceptance subscribes to both workflow completions: a successful source run requiring UI evidence stays pending until PR UI Evidence completes, then acceptance resolves the original source run from the authenticated capture artifact identity.
Manual re-evaluation can provide the optional capture_run_id together with the required source run_id.

The orchestrator authenticates the capture workflow path/name, repository, successful run and capture job, current attempt and separate artifact identity.
It compares the capture workflow definition against protected base content and requires its source revision to be in protected base history.
Expected fixtureHash is recomputed with computeTrustedFixtureHash from the authenticated base tree and GitHub content reads at the exact base commit.
The expected capture context independently binds controller revision, both run IDs/attempts, original source artifact ID and both authenticated source trees.
Only the separate capture artifact reader reaches UI publication, and run links identify the capture run.
The signed uiCaptureVerified adequacy requirement remains independent of these metadata and content checks.

After integration, pnpm test:autonomy passed 64 tests with no failures or skips.
Tests reject wrong capture workflows/events/repositories, changed definitions, foreign source ancestry, substituted artifacts and stale source attempts.
The log is reports/autonomy/local-trusted-capture-tests.log.
No live workflow dispatch, GitHub writes, image publication or browser execution was performed for this integration.

### Performance-specific admission

A perf change requires signed adequacy.performanceReviewed=true in addition to the general ACCEPT requirements.
Its performance.sample_size must be a safe integer at least five, and each observed audit.performance group selected by performance.interaction must contain at least that many finite nonnegative duration values.
The interaction must be authored in the trusted assurance model.
Missing groups, unknown interactions, incomplete environment metadata, duplicate environments, incorrect median/p95 statistics and insufficient samples are rejected.

The authored performance.baseline must identify tools/assurance/baseline.json.
Trusted orchestration reads that protected file into context.performanceBaseline={path,documentHash,document}; the hash covers the canonical parsed document.
The baseline must be version one with modelHash matching audit.modelHash, a sourceHash, runId and a finite nonfuture createdAt timestamp in provenance.
Each selected environment must match one baseline group exactly, including measurement, browser, platform, architecture, viewport, reducedMotion, surface, fixture and workload.
Baseline groups need five finite nonnegative values and correct summary statistics.
Both the reported comparison.status and independently recomputed comparison must be within baseline, with matching deltaMs and toleranceMs.
No comparable baseline, insufficient baseline observations or a regression cannot establish perf acceptance.

PR Quality must produce repeated observations through ASSURANCE_REPEAT=5 and ASSURANCE_BENCHMARK_AFTER_FIRST=1, or an equivalent trusted impact-selected configuration.
That workflow configuration belongs to the UI owner.
This admission code only reads baseline evidence; it never promotes or rewrites it.
Controlled fixture observations remain distinct from production latency and do not prove an improvement by themselves.

### Authored native capture plans

Orchestration derives capturePlans from authenticated Markdown intent and its commit-bound capture file (or legacy inline intent) and validates them against change.surfaces and impact.paths.
Both changedPaths and requiredPaths are the complete computed impact.paths list; there is no implicit account-plan fallback.
Authentication computes the expected capturePlanHash, retains it with trusted capture identity, and rejects a separate artifact whose manifest planHash or copied plan data differs before publication.
The UI validator receives the same expected plans and path constraints and enforces the per-plan surface, entry, route, scenario, state and theme/viewport matrix.
The protected controller interprets bounded typed actions with a terminal assertion; plan data does not authorize arbitrary candidate commands or scripts.
Native extension execution remains a separate real browser requirement and cannot be certified by a web plan or these Node tests.

The updated probe fixture includes plans, planHash and state, and tests reject altered authored states and omitted affected paths before uploads.
The current complete autonomy suite passed 74 tests with no failures or skips; its log is reports/autonomy/local-native-plan-integration-tests.log.
No browser capture or extension installation was executed during this integration.

### Candidate CI workflow definition binding

Before consuming evidence, trusted orchestration reads policy.ciWorkflow at the authenticated candidate run SHA and the current protected PR base SHA and requires exact definition equality.
Matching workflow paths and job names alone cannot satisfy this check.
A stale definition fails with an actionable rebase-and-rerun message without echoing workflow contents.
The authenticated definition hash is retained in the signed review context.
An orchestration test proves a mismatch blocks evidence download, Dots transport, UI publication and successful check publication.

### Evidence-bounded acceptance lifetime

The signed source context includes evidenceExpiresAt, computed from the authenticated source run.updated_at plus policy.maxEvidenceAgeHours.
Decision validation requires a finite future evidence deadline and decision.expiresAt no later than that deadline.
A nearly expired source run cannot obtain a fresh full-day acceptance lifetime.
Existing trusted acceptance metadata copies the validated decision expiry, so the revoker inherits the same upper bound.
Tests cover exact-deadline acceptance, one-millisecond and longer extensions, invalid or expired deadlines, and revocation at the bound.
This enforces the policy age limit; it does not make the final freshness check and GitHub merge operation atomic or eliminate the documented native race.

### Trusted UI surface and native-entry scope

The protected import graph includes web sources and derives impact.requiredUiSurfaces from reachability to web/main.tsx and the popup, sidepanel and options entrypoints.
Impact also records requiredExtensionEntries and uiScopeUnresolved in the signed review context.
Every changed source path is checked for entrypoint reachability so a resolved path cannot hide another unresolved source change.
Unresolved src or web UI scope conservatively requires both product surfaces and all three extension entries, and elevates the change for independent review.

Contract validation rejects authored surface lists omitting a trusted required surface.
Capture requirements combine those trusted surfaces with authored web/extension declarations; docs and SDK labels never become unsupported capture surfaces.
Plans must explicitly cover every reached extension entry before capture authentication or publication.
Tests cover shared UI reaching all product entrypoints, missing implicit extension declarations, omitted options evidence, precise web-only/options-only reachability, unresolved scope escalation and the actual web graph input.
Existing executable-MDX and release-trailer rejection tests remain unchanged.

### Authoritative fork-run association

When the authenticated source run has no PR association, both pull_request and merge_group events query GitHub's commit-to-PR API for that exact run head SHA.
Pull-request acceptance requires exactly one current open PR with the matching head, configured base branch and root repository; the head repository may be a fork.
Association never uses a candidate manifest PR number.
Ambiguous associations fail closed, and queues retain their single-PR requirement plus existing current-integration and ancestry checks.
Tests cover a valid empty-list fork association and rejection of stale heads, closed PRs, foreign bases and ambiguity.
